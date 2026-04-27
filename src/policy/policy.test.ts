import { describe, expect, it } from "vitest";
import type { Occurrence } from "../types.js";
import type { MetadataAccessor, PolicyOptions } from "./policy.js";
import { runPolicy } from "./policy.js";

const NOW = new Date("2024-06-01T00:00:00Z");

function msAgo(days: number): number {
  return NOW.getTime() - days * 86_400_000;
}

function makeOccurrence(
  overrides: Partial<Occurrence> &
    Pick<Occurrence, "group" | "artifact" | "currentRaw"> & { dependencyKey?: string },
): Occurrence {
  const byteEnd = overrides.currentRaw.length;
  const dependencyKey =
    overrides.dependencyKey ?? `${overrides.group}:${overrides.artifact}`;
  return {
    file: "build.gradle",
    byteStart: 0,
    byteEnd,
    fileType: "groovy-dsl",
    shape: "exact",
    dependencyKey,
    via: undefined,
    ...overrides,
  };
}

function makeMetadata(
  versions: string[],
  publishedAt: Record<string, number> = {},
): MetadataAccessor {
  return {
    getVersions: () => versions,
    getPublishedAt: (_group, _artifact, version) => publishedAt[version],
  };
}

function noConfig(): PolicyOptions {
  return {};
}

describe("runPolicy", () => {
  describe("Test 1: basic upgrade", () => {
    it("picks the highest candidate above current", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const metadata = makeMetadata(["1.0.0", "2.0.0"]);
      const [decision] = runPolicy([occurrence], metadata, noConfig, NOW);

      expect(decision?.status).toBe("upgrade");
      expect(decision?.newVersion).toBe("2.0.0");
    });
  });

  describe("Test 2: no-change when already at highest", () => {
    it("emits no-change when current is the highest candidate", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "2.0.0",
      });
      const metadata = makeMetadata(["1.0.0", "2.0.0"]);
      const [decision] = runPolicy([occurrence], metadata, noConfig, NOW);

      expect(decision?.status).toBe("no-change");
    });
  });

  describe("Test 3: report-only for ineligible shapes", () => {
    it("emits report-only for snapshot shape", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0-SNAPSHOT",
        shape: "snapshot",
      });
      const metadata = makeMetadata(["1.0.0-SNAPSHOT", "2.0.0-SNAPSHOT"]);
      const [decision] = runPolicy([occurrence], metadata, noConfig, NOW);

      expect(decision?.status).toBe("report-only");
    });

    it("emits report-only for latestQualifier shape", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "latest.release",
        shape: "latestQualifier",
      });
      const metadata = makeMetadata(["latest.release"]);
      const [decision] = runPolicy([occurrence], metadata, noConfig, NOW);

      expect(decision?.status).toBe("report-only");
    });
  });

  describe("Test 4: cooldown blocks latest, picks older stable", () => {
    it("selects the most recent candidate outside the cooldown window", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const publishedAt = {
        "2.0.0": msAgo(2), // inside 7-day window → blocked
        "1.5.0": msAgo(10), // outside 7-day window → allowed
        "1.0.0": msAgo(60),
      };
      const metadata = makeMetadata(["1.0.0", "1.5.0", "2.0.0"], publishedAt);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ cooldownDays: 7 }),
        NOW,
      );

      expect(decision?.status).toBe("upgrade");
      expect(decision?.newVersion).toBe("1.5.0");
    });
  });

  describe("Test 5: cooldown-blocked when all candidates inside window", () => {
    it("emits cooldown-blocked when all candidates are inside the cooldown window", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const publishedAt = {
        "2.0.0": msAgo(2), // inside 7-day window → blocked
        "1.5.0": msAgo(3), // inside 7-day window → blocked
      };
      const metadata = makeMetadata(["1.0.0", "1.5.0", "2.0.0"], publishedAt);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ cooldownDays: 7 }),
        NOW,
      );

      expect(decision?.status).toBe("cooldown-blocked");
    });
  });

  describe("cooldown with no upgrades at all (not cooldown-blocked)", () => {
    it("emits no-change (not cooldown-blocked) when there are no upgrade candidates at all", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "2.0.0",
      });
      // Only current version exists — no upgrades at all; current is old (outside window)
      const publishedAt = { "2.0.0": msAgo(60) };
      const metadata = makeMetadata(["2.0.0"], publishedAt);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ cooldownDays: 7 }),
        NOW,
      );

      expect(decision?.status).toBe("no-change");
    });
  });

  describe("Test 6: allow-downgrade when current is inside cooldown", () => {
    it("picks highest soaked version below current when allow-downgrade + cooldown enabled", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "2.0.21",
      });
      const publishedAt = {
        "2.0.21": msAgo(3), // current inside 7-day window
        "2.0.20": msAgo(10), // soaked (outside window)
        "2.0.10": msAgo(40), // soaked (outside window)
      };
      const metadata = makeMetadata(["2.0.10", "2.0.20", "2.0.21"], publishedAt);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ cooldownDays: 7, allowDowngrade: true }),
        NOW,
      );

      expect(decision?.status).toBe("upgrade");
      expect(decision?.newVersion).toBe("2.0.20");
      expect(decision?.direction).toBe("down");
    });
  });

  describe("Test 7: target ceiling", () => {
    it("does not propose a major bump when target is minor", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const metadata = makeMetadata(["1.0.0", "1.1.0", "2.0.0"]);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ target: "minor" }),
        NOW,
      );

      expect(decision?.status).toBe("upgrade");
      expect(decision?.newVersion).toBe("1.1.0");
    });

    it("emits no-change when target is patch and only minor/major candidates exist", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const metadata = makeMetadata(["1.0.0", "1.1.0", "2.0.0"]);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ target: "patch" }),
        NOW,
      );

      expect(decision?.status).toBe("no-change");
    });
  });

  describe("Test 8: rich-block coherence", () => {
    it("aligns all siblings in a rich block to the governing winner", () => {
      const strictlyOccurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
        shape: "richStrictly",
        dependencyKey: "com.example:foo@blockA",
        byteStart: 0,
        byteEnd: 5,
      });
      const requireOccurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
        shape: "richRequire",
        dependencyKey: "com.example:foo@blockA",
        byteStart: 10,
        byteEnd: 15,
      });
      const metadata = makeMetadata(["1.0.0", "2.0.0", "3.0.0"]);

      const decisions = runPolicy(
        [strictlyOccurrence, requireOccurrence],
        metadata,
        noConfig,
        NOW,
      );

      expect(decisions).toHaveLength(2);
      const strictlyDecision = decisions.find(
        (decision) => decision.occurrence === strictlyOccurrence,
      );
      const requireDecision = decisions.find(
        (decision) => decision.occurrence === requireOccurrence,
      );

      // Both should be aligned to the same winner (governed by richStrictly)
      expect(strictlyDecision?.status).toBe("upgrade");
      expect(requireDecision?.status).toBe("upgrade");
      expect(strictlyDecision?.newVersion).toBe(requireDecision?.newVersion);
    });

    it("emits conflict when a reject sibling matches the proposed winner", () => {
      const requireOccurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
        shape: "richRequire",
        dependencyKey: "com.example:foo@blockB",
        byteStart: 0,
        byteEnd: 5,
      });
      const rejectOccurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "2.0.0",
        shape: "richReject",
        dependencyKey: "com.example:foo@blockB",
        byteStart: 10,
        byteEnd: 15,
      });
      // richReject is ineligible for upgrade, so we use only 2.0.0 as the candidate
      const metadata = makeMetadata(["1.0.0", "2.0.0"]);

      const decisions = runPolicy(
        [requireOccurrence, rejectOccurrence],
        metadata,
        noConfig,
        NOW,
      );

      const requireDecision = decisions.find(
        (decision) => decision.occurrence === requireOccurrence,
      );
      expect(requireDecision?.status).toBe("conflict");
    });
  });

  describe("Test 9: shared-variable disagreement", () => {
    it("applies the lowest proposed winner when occurrences share an edit site", () => {
      // Two occurrences referencing the exact same (file, byteStart) → shared variable
      const occurrenceAlpha = makeOccurrence({
        group: "com.example",
        artifact: "alpha",
        currentRaw: "1.0.0",
        file: "build.gradle",
        byteStart: 100,
        byteEnd: 105,
        dependencyKey: "com.example:alpha",
      });
      const occurrenceBeta = makeOccurrence({
        group: "com.example",
        artifact: "beta",
        currentRaw: "1.0.0",
        file: "build.gradle",
        byteStart: 100,
        byteEnd: 105,
        dependencyKey: "com.example:beta",
      });

      // alpha can go to 3.0.0, beta can go to 2.0.0 — shared var should resolve to 2.0.0
      const metadata: MetadataAccessor = {
        getVersions: (_group, artifact) => {
          if (artifact === "alpha") return ["1.0.0", "2.0.0", "3.0.0"];
          return ["1.0.0", "2.0.0"];
        },
        getPublishedAt: () => undefined,
      };

      const decisions = runPolicy(
        [occurrenceAlpha, occurrenceBeta],
        metadata,
        noConfig,
        NOW,
      );

      expect(decisions).toHaveLength(2);
      const alphaDecision = decisions.find(
        (decision) => decision.occurrence === occurrenceAlpha,
      );
      const betaDecision = decisions.find(
        (decision) => decision.occurrence === occurrenceBeta,
      );

      // The shared variable must be constrained to the lower of the two winners
      expect(alphaDecision?.newVersion).toBe("2.0.0");
      expect(betaDecision?.newVersion).toBe("2.0.0");
    });
  });

  describe("latestAvailable field", () => {
    it("reports the highest candidate >= current regardless of other filters", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const publishedAt = {
        "3.0.0": msAgo(1), // blocked by cooldown
        "2.0.0": msAgo(30), // soaked
      };
      const metadata = makeMetadata(["1.0.0", "2.0.0", "3.0.0"], publishedAt);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ cooldownDays: 7 }),
        NOW,
      );

      // Picks 2.0.0 after cooldown, but latestAvailable should be 3.0.0
      expect(decision?.newVersion).toBe("2.0.0");
      expect(decision?.latestAvailable).toBe("3.0.0");
    });
  });

  describe("held-by-target status", () => {
    it("emits held-by-target when target ceiling holds all candidates above current", () => {
      // Current version is not returned by the registry; only minor/major upgrades exist.
      // With target:patch, all upgrades are above the ceiling → postTargetCandidates is empty.
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      const metadata = makeMetadata(["1.1.0", "2.0.0"]);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ target: "patch" }),
        NOW,
      );

      expect(decision?.status).toBe("held-by-target");
      expect(decision?.newVersion).toBeUndefined();
    });

    it("emits no-change (not held-by-target) when no candidates exist at all", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "foo",
        currentRaw: "1.0.0",
      });
      // No candidates — nothing was held by target, nothing was available
      const metadata = makeMetadata([]);
      const [decision] = runPolicy(
        [occurrence],
        metadata,
        () => ({ target: "patch" }),
        NOW,
      );

      expect(decision?.status).toBe("no-change");
    });
  });

  describe("direction preservation across shared-var resolution", () => {
    it("preserves direction: 'down' when allow-downgrade fires for a shared-var occurrence", () => {
      // Two occurrences at the same edit site. One (alpha) has allow-downgrade active and
      // current inside the cooldown window; the other (beta) proposes the same version normally.
      // After shared-var resolution the direction: "down" from alpha should survive.
      const sharedByteStart = 200;

      const occurrenceAlpha = makeOccurrence({
        group: "com.example",
        artifact: "alpha",
        currentRaw: "2.0.0",
        file: "build.gradle",
        byteStart: sharedByteStart,
        byteEnd: sharedByteStart + 5,
        dependencyKey: "com.example:alpha",
      });
      const occurrenceBeta = makeOccurrence({
        group: "com.example",
        artifact: "beta",
        currentRaw: "2.0.0",
        file: "build.gradle",
        byteStart: sharedByteStart,
        byteEnd: sharedByteStart + 5,
        dependencyKey: "com.example:beta",
      });

      // alpha: current (2.0.0) is inside cooldown, 1.9.0 is soaked → allow-downgrade picks 1.9.0
      // beta:  current is old (60 days), 1.9.0 is the only candidate above → normal upgrade
      const publishedAt: Record<string, number> = {
        "2.0.0": msAgo(3), // inside 7-day window
        "1.9.0": msAgo(20), // soaked
        "1.0.0": msAgo(90), // old
      };

      const metadata: MetadataAccessor = {
        getVersions: () => ["1.0.0", "1.9.0", "2.0.0"],
        getPublishedAt: (_group, _artifact, version) => publishedAt[version],
      };

      const decisions = runPolicy(
        [occurrenceAlpha, occurrenceBeta],
        metadata,
        () => ({ cooldownDays: 7, allowDowngrade: true }),
        NOW,
      );

      const alphaDecision = decisions.find(
        (decision) => decision.occurrence === occurrenceAlpha,
      );
      const betaDecision = decisions.find(
        (decision) => decision.occurrence === occurrenceBeta,
      );

      // Both share the edit site — shared-var resolves to 1.9.0 for both
      expect(alphaDecision?.newVersion).toBe("1.9.0");
      expect(betaDecision?.newVersion).toBe("1.9.0");
      // both had direction: "down" before shared-var; it should be preserved since the winner matches
      expect(alphaDecision?.direction).toBe("down");
      expect(betaDecision?.direction).toBe("down");
    });
  });

  describe("include/exclude filter", () => {
    it("skips excluded dependency keys", () => {
      const includedOccurrence = makeOccurrence({
        group: "com.example",
        artifact: "included",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:included",
      });
      const excludedOccurrence = makeOccurrence({
        group: "com.example",
        artifact: "excluded",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:excluded",
      });
      const metadata = makeMetadata(["1.0.0", "2.0.0"]);

      const decisions = runPolicy(
        [includedOccurrence, excludedOccurrence],
        metadata,
        (occurrence) => ({
          excludes:
            occurrence.dependencyKey === "com.example:excluded"
              ? ["com.example:excluded"]
              : [],
        }),
        NOW,
      );

      const includedDecision = decisions.find(
        (decision) => decision.occurrence === includedOccurrence,
      );
      const excludedDecision = decisions.find(
        (decision) => decision.occurrence === excludedOccurrence,
      );

      expect(includedDecision?.status).toBe("upgrade");
      expect(excludedDecision?.status).toBe("no-change");
      expect(excludedDecision?.reason).toBe("excluded");
    });

    it("stamped reason does not bleed onto included deps", () => {
      const occurrence = makeOccurrence({
        group: "com.example",
        artifact: "lib",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:lib",
      });
      const metadata = makeMetadata(["1.0.0", "2.0.0"]);

      const decisions = runPolicy([occurrence], metadata, () => ({}), NOW);

      expect(decisions[0]?.status).toBe("upgrade");
      expect(decisions[0]?.reason).toBeUndefined();
    });

    it("excluded dep retains latestAvailable for informational purposes", () => {
      const occurrence = makeOccurrence({
        group: "tools.jackson",
        artifact: "jackson-bom",
        currentRaw: "3.0.0",
        dependencyKey: "tools.jackson:jackson-bom",
      });
      const metadata = makeMetadata(["3.0.0", "3.1.2"]);

      const decisions = runPolicy(
        [occurrence],
        metadata,
        () => ({ excludes: ["tools.**"] }),
        NOW,
      );

      expect(decisions[0]?.status).toBe("no-change");
      expect(decisions[0]?.reason).toBe("excluded");
      expect(decisions[0]?.latestAvailable).toBe("3.1.2");
    });
  });
});
