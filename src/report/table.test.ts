import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderTable } from "./table";
import type { Decision, Occurrence } from "../types";

function makeOccurrence(
  overrides: Partial<Occurrence> & {
    group: string;
    artifact: string;
    currentRaw: string;
    file: string;
  },
): Occurrence {
  return {
    byteStart: 0,
    byteEnd: overrides.currentRaw.length,
    fileType: "kotlin-dsl",
    shape: "exact",
    dependencyKey: `${overrides.group}:${overrides.artifact}`,
    ...overrides,
  };
}

function makeUpgrade(
  group: string,
  artifact: string,
  currentRaw: string,
  newVersion: string,
  file: string,
  extra: Partial<Decision> = {},
): Decision {
  return {
    occurrence: makeOccurrence({ group, artifact, currentRaw, file }),
    status: "upgrade",
    newVersion,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal("process", {
    ...process,
    stdout: { ...process.stdout, isTTY: true },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderTable", () => {
  describe("flat entry format", () => {
    it("renders every dep as group:artifact regardless of how many share a group", () => {
      const decisions: Decision[] = [
        makeUpgrade(
          "org.springframework.boot",
          "spring-boot-starter",
          "3.2.0",
          "3.2.5",
          "build.gradle.kts",
        ),
        makeUpgrade(
          "org.springframework.boot",
          "spring-boot-starter-web",
          "3.2.0",
          "3.2.5",
          "build.gradle.kts",
        ),
        makeUpgrade("io.ktor", "ktor-server-core", "2.3.5", "3.0.1", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).toContain("org.springframework.boot:spring-boot-starter");
      expect(output).toContain("org.springframework.boot:spring-boot-starter-web");
      expect(output).toContain("io.ktor:ktor-server-core");
      // No tree glyphs
      expect(output).not.toContain("├──");
      expect(output).not.toContain("└──");
    });

    it("shows just the plugin id when artifact is <group>.gradle.plugin", () => {
      const decisions: Decision[] = [
        makeUpgrade(
          "org.gradle.toolchains.foojay-resolver-convention",
          "org.gradle.toolchains.foojay-resolver-convention.gradle.plugin",
          "0.8.0",
          "1.0.0",
          "settings.gradle.kts",
        ),
      ];

      const output = renderTable(decisions);

      expect(output).toContain("org.gradle.toolchains.foojay-resolver-convention");
      expect(output).not.toContain(
        "org.gradle.toolchains.foojay-resolver-convention:org.gradle.toolchains.foojay-resolver-convention.gradle.plugin",
      );
    });

    it("sorts all entries alphabetically by group:artifact", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "zebra", "1.0.0", "1.1.0", "build.gradle.kts"),
        makeUpgrade("com.example", "alpha", "1.0.0", "1.1.0", "build.gradle.kts"),
        makeUpgrade("aaa.group", "middle", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      const aaaPos = output.indexOf("aaa.group:middle");
      const alphaPos = output.indexOf("com.example:alpha");
      const zebraPos = output.indexOf("com.example:zebra");

      expect(aaaPos).toBeLessThan(alphaPos);
      expect(alphaPos).toBeLessThan(zebraPos);
    });

    it("right-aligns current version column so all arrows are in the same position", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "short", "1.0", "2.0", "build.gradle.kts"),
        makeUpgrade("com.example", "longer", "10.20.30", "10.20.31", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);
      const lines = output.split("\n").filter((l) => l.includes("→"));

      // Arrow column should be at the same position in each line (ignoring ANSI)
      // Strip ANSI codes for positional comparison
      const stripped = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
      const arrowPositions = stripped.map((l) => l.indexOf("→"));

      expect(arrowPositions[0]).toBe(arrowPositions[1]);
    });
  });

  describe("file header", () => {
    it("emits a 'Checking <path>' header for each file section", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "gradle/libs.versions.toml"),
      ];

      const output = renderTable(decisions);

      expect(output).toContain("Checking gradle/libs.versions.toml");
    });

    it("uses relative path when rootDir is provided", () => {
      const decisions: Decision[] = [
        makeUpgrade(
          "com.example",
          "lib",
          "1.0.0",
          "1.1.0",
          "/projects/myapp/gradle/libs.versions.toml",
        ),
      ];

      const output = renderTable(decisions, 0, "/projects/myapp");

      expect(output).toContain("Checking gradle/libs.versions.toml");
      expect(output).not.toContain("/projects/myapp");
    });

    it("emits separate headers for each file in discovery order", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "alpha", "1.0.0", "1.1.0", "app/build.gradle.kts"),
        makeUpgrade("com.other", "beta", "2.0.0", "3.0.0", "gradle/libs.versions.toml"),
      ];

      const output = renderTable(decisions);

      const file1Pos = output.indexOf("app/build.gradle.kts");
      const file2Pos = output.indexOf("gradle/libs.versions.toml");

      expect(file1Pos).toBeGreaterThan(-1);
      expect(file2Pos).toBeGreaterThan(-1);
      expect(file1Pos).toBeLessThan(file2Pos);
    });
  });

  describe("severity coloring", () => {
    it("applies green color to patch upgrade new version", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "3.2.0", "3.2.5", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      // Green ANSI code (32m) applied to new version
      expect(output).toMatch(/\x1b\[32m.*3\.2\.5/);
    });

    it("applies cyan color to minor upgrade new version", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "4.11.0", "4.12.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).toMatch(/\x1b\[36m.*4\.12\.0/);
    });

    it("applies red color to major upgrade new version", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "2.3.5", "3.0.1", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).toMatch(/\x1b\[31m.*3\.0\.1/);
    });
  });

  describe("annotations", () => {
    it("hides severity annotation by default", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "3.2.0", "3.2.5", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).not.toContain("(patch)");
      expect(output).not.toContain("(minor)");
      expect(output).not.toContain("(major)");
    });

    it("shows patch annotation with verbose=true", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "3.2.0", "3.2.5", "build.gradle.kts"),
      ];

      expect(renderTable(decisions, 1)).toContain("(patch)");
    });

    it("shows minor annotation with verbose=true", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "4.11.0", "4.12.0", "build.gradle.kts"),
      ];

      expect(renderTable(decisions, 1)).toContain("(minor)");
    });

    it("shows major annotation with verbose=true", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "2.3.5", "3.0.1", "build.gradle.kts"),
      ];

      expect(renderTable(decisions, 1)).toContain("(major)");
    });
  });

  describe("held-by-target", () => {
    it("shows held-by-target rows with latestAvailable and annotation when verbose=true", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "io.ktor",
            artifact: "ktor-server-core",
            currentRaw: "2.3.5",
            file: "build.gradle.kts",
          }),
          status: "held-by-target",
          latestAvailable: "3.0.1",
          reason: "--target=minor",
          newVersion: "2.3.12",
        },
      ];

      const output = renderTable(decisions, 1);

      expect(output).toContain("io.ktor:ktor-server-core");
      expect(output).toContain("held by --target");
      expect(output).toContain("3.0.1");
    });

    it("shows held-by-target rows even without verbose flag", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "io.ktor",
            artifact: "ktor-server-core",
            currentRaw: "2.3.5",
            file: "build.gradle.kts",
          }),
          status: "held-by-target",
          latestAvailable: "3.0.1",
          reason: "--target=minor",
          newVersion: "2.3.12",
        },
      ];

      const output = renderTable(decisions, 1);

      expect(output).toContain("io.ktor:ktor-server-core");
      expect(output).toContain("3.0.1");
      expect(output).toContain("1 held by --target");
      expect(output).not.toContain("use --verbose to see");
    });

    it("includes held-by-target count alongside upgrade count in summary", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
        {
          occurrence: makeOccurrence({
            group: "io.ktor",
            artifact: "ktor",
            currentRaw: "2.3.5",
            file: "build.gradle.kts",
          }),
          status: "held-by-target",
          latestAvailable: "3.0.1",
        },
      ];

      const output = renderTable(decisions, 1);

      expect(output).toContain("1 upgrade available");
      expect(output).toContain("1 held by --target");
    });

    it("sorts held-by-target rows after upgrades, before cooldown-blocked (verbose)", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "zzz.last",
            artifact: "upgrade",
            currentRaw: "1.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "2.0.0",
        },
        {
          occurrence: makeOccurrence({
            group: "aaa.first",
            artifact: "held",
            currentRaw: "1.0.0",
            file: "build.gradle.kts",
          }),
          status: "held-by-target",
          latestAvailable: "2.0.0",
        },
        {
          occurrence: makeOccurrence({
            group: "mmm.middle",
            artifact: "cooldown",
            currentRaw: "1.0.0",
            file: "build.gradle.kts",
          }),
          status: "cooldown-blocked",
          latestAvailable: "1.1.0",
        },
      ];

      const output = renderTable(decisions, 1);
      const upgradePos = output.indexOf("zzz.last");
      const heldPos = output.indexOf("aaa.first");
      const cooldownPos = output.indexOf("mmm.middle");

      expect(upgradePos).toBeLessThan(heldPos);
      expect(heldPos).toBeLessThan(cooldownPos);
    });

    it("shows per-row annotation (held by --target) only when verbose=true", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "lib",
            currentRaw: "1.0.0",
            file: "build.gradle.kts",
          }),
          status: "held-by-target",
          latestAvailable: "2.0.0",
        },
      ];

      // In non-verbose mode: the row is visible but no per-row annotation
      expect(renderTable(decisions, 0)).not.toContain("(held by --target)");
      // In verbose mode: per-row annotation appears in parentheses
      expect(renderTable(decisions, 1)).toContain("(held by --target)");
    });
  });

  describe("downgrade row", () => {
    it("renders downgrade with down arrow and magenta color in TTY mode", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "flaky",
            currentRaw: "2.0.21",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "2.0.20",
          direction: "down",
        },
      ];

      const output = renderTable(decisions);

      expect(output).toContain("↓");
      expect(output).toContain("2.0.20");
      // Magenta color (35m) applied to new version
      expect(output).toMatch(/\x1b\[35m.*2\.0\.20/);
      expect(output).toContain("1 downgrade");
    });

    it("uses ASCII down arrow v in non-TTY mode", () => {
      vi.stubGlobal("process", {
        ...process,
        stdout: { ...process.stdout, isTTY: false },
      });

      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "flaky",
            currentRaw: "2.0.21",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "2.0.20",
          direction: "down",
        },
      ];

      const output = renderTable(decisions);

      expect(output).toContain("v");
      expect(output).not.toContain("↓");
    });
  });

  describe("non-TTY ASCII mode", () => {
    beforeEach(() => {
      vi.stubGlobal("process", {
        ...process,
        stdout: { ...process.stdout, isTTY: false },
      });
    });

    it("uses ASCII arrow -> instead of Unicode → in non-TTY mode", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).toContain("->");
      expect(output).not.toContain("→");
    });

    it("produces no ANSI escape codes in non-TTY mode", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "alpha", "1.0.0", "1.1.0", "build.gradle.kts"),
        makeUpgrade("com.example", "beta", "1.0.0", "1.2.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).not.toMatch(/\x1b\[/);
    });
  });

  describe("TTY color mode", () => {
    it("produces ANSI color codes for upgrade versions in TTY mode", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).toMatch(/\x1b\[/);
    });

    it("uses Unicode arrow → in TTY mode", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions);

      expect(output).toContain("→");
    });
  });

  describe("summary line", () => {
    it("renders summary with correct upgrade count", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "alpha", "1.0.0", "1.1.0", "build.gradle.kts"),
        makeUpgrade("com.example", "beta", "1.0.0", "2.0.0", "build.gradle.kts"),
        makeUpgrade("io.ktor", "ktor", "2.0.0", "3.0.0", "build.gradle.kts"),
      ];

      expect(renderTable(decisions)).toContain("3 upgrades available");
    });

    it("renders summary with cooldown-blocked count", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
        {
          occurrence: makeOccurrence({
            group: "com.blocked",
            artifact: "dep",
            currentRaw: "2.0.0",
            file: "build.gradle.kts",
          }),
          status: "cooldown-blocked",
        },
      ];

      expect(renderTable(decisions, 1)).toContain("1 held by cooldown");
    });

    it("includes 'Run with -u to apply.' when there are upgrades", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      expect(renderTable(decisions)).toMatch(
        /Run with (?:\x1b\[[^m]*m)?-u(?:\x1b\[[^m]*m)? to apply\./u,
      );
    });

    it("omits 'Run with -u to apply.' when upgrade=true and shows 'applied'", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions, 0, undefined, true);
      expect(output).not.toContain("Run with");
      expect(output).toContain("1 upgrade applied");
    });

    it("uses 'applied' verb and omits hint for multiple upgrades when upgrade=true", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
        makeUpgrade("com.example", "other", "2.0.0", "3.0.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions, 0, undefined, true);
      expect(output).not.toContain("Run with");
      expect(output).toContain("2 upgrades applied");
    });

    it("still shows 'available' and the hint when upgrade=false", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      const output = renderTable(decisions, 0, undefined, false);
      expect(output).toContain("1 upgrade available");
      expect(output).toMatch(/Run with (?:\x1b\[[^m]*m)?-u(?:\x1b\[[^m]*m)? to apply\./u);
    });

    it("shows only downgrade count when all changes are downgrades", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "a",
            currentRaw: "2.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "1.9.0",
          direction: "down",
        },
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "b",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "2.9.0",
          direction: "down",
        },
      ];

      const output = renderTable(decisions);
      expect(output).toContain("2 downgrades available");
      expect(output).not.toContain("upgrade");
    });

    it("separates upgrades and downgrades in the summary when mixed", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "2.0.0", "build.gradle.kts"),
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "legacy",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "2.9.0",
          direction: "down",
        },
      ];

      const output = renderTable(decisions);
      expect(output).toContain("1 upgrade, 1 downgrade available");
      expect(output).not.toContain("2 upgrades");
    });

    it("shows 'X downgrades applied' when upgrade=true and all changes are downgrades", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "a",
            currentRaw: "2.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "1.9.0",
          direction: "down",
        },
      ];

      const output = renderTable(decisions, 0, undefined, true);
      expect(output).toContain("1 downgrade applied");
      expect(output).not.toContain("Run with");
    });

    it("shows 'X upgrades applied, Y downgrades applied' when upgrade=true and mixed", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "2.0.0", "build.gradle.kts"),
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "legacy",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "2.9.0",
          direction: "down",
        },
      ];

      const output = renderTable(decisions, 0, undefined, true);
      expect(output).toContain("1 upgrade, 1 downgrade applied");
      expect(output).not.toContain("Run with");
    });

    it("shows 'Run with -u to apply.' when there are only downgrades", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "a",
            currentRaw: "2.0.0",
            file: "build.gradle.kts",
          }),
          status: "upgrade",
          newVersion: "1.9.0",
          direction: "down",
        },
      ];

      const output = renderTable(decisions);
      expect(output).toMatch(/Run with (?:\x1b\[[^m]*m)?-u(?:\x1b\[[^m]*m)? to apply\./u);
    });

    it("omits 'Run with -u to apply.' when there are no upgrades", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "lib",
            currentRaw: "1.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
        },
      ];

      expect(renderTable(decisions)).not.toContain("Run with -u to apply.");
    });

    it("renders singular upgrade count correctly", () => {
      const decisions: Decision[] = [
        makeUpgrade("com.example", "lib", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];

      expect(renderTable(decisions)).toContain("1 upgrade available");
    });
  });

  describe("empty decisions", () => {
    it("renders summary with zero upgrades when no decisions", () => {
      const output = renderTable([]);

      expect(output).toContain("0 upgrades available");
      expect(output).not.toContain("Run with -u to apply.");
    });

    it("renders only no-change decisions with zero upgrades summary", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "lib",
            currentRaw: "1.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
        },
      ];

      expect(renderTable(decisions)).toContain("0 upgrades available");
    });
  });

  describe("verbose level 2 (super verbose)", () => {
    function makeNoChange(
      group: string,
      artifact: string,
      currentRaw: string,
      file: string,
    ): Decision {
      return {
        occurrence: makeOccurrence({ group, artifact, currentRaw, file }),
        status: "no-change",
      };
    }

    it("hides no-change rows at level 0 and level 1", () => {
      const decisions: Decision[] = [
        makeNoChange("tools.jackson", "jackson-bom", "3.0.0", "build.gradle.kts"),
      ];
      expect(renderTable(decisions, 0)).not.toContain("jackson-bom");
      expect(renderTable(decisions, 1)).not.toContain("jackson-bom");
    });

    it("shows no-change rows at level 2 with current version on both sides", () => {
      const decisions: Decision[] = [
        makeNoChange("tools.jackson", "jackson-bom", "3.0.0", "build.gradle.kts"),
      ];
      const output = renderTable(decisions, 2);
      expect(output).toContain("tools.jackson:jackson-bom");
      expect(output).toContain("(up to date)");
      // Both columns show 3.0.0 (one current, one new) — count occurrences.
      const matches = output.match(/3\.0\.0/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("shows report-only rows at level 2 with annotation", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "com.example",
            artifact: "snap-lib",
            currentRaw: "1.0.0-SNAPSHOT",
            file: "build.gradle.kts",
            shape: "snapshot",
          }),
          status: "report-only",
        },
      ];
      expect(renderTable(decisions, 1)).not.toContain("snap-lib");
      const output = renderTable(decisions, 2);
      expect(output).toContain("snap-lib");
      expect(output).toContain("(report-only)");
    });

    it("includes 'up to date' summary count at level 2 only", () => {
      const decisions: Decision[] = [
        makeNoChange("a", "b", "1.0.0", "build.gradle.kts"),
        makeNoChange("c", "d", "2.0.0", "build.gradle.kts"),
      ];
      expect(renderTable(decisions, 0)).not.toContain("up to date");
      expect(renderTable(decisions, 1)).not.toContain("up to date");
      expect(renderTable(decisions, 2)).toContain("2 up to date");
    });

    it("excluded rows are hidden at level 0", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "tools.jackson",
            artifact: "jackson-bom",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
          reason: "excluded",
          latestAvailable: "3.1.2",
        },
      ];
      expect(renderTable(decisions, 0)).not.toContain("jackson-bom");
    });

    it("excluded rows are visible at level 1", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "tools.jackson",
            artifact: "jackson-bom",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
          reason: "excluded",
          latestAvailable: "3.1.2",
        },
      ];
      const output = renderTable(decisions, 1);
      expect(output).toContain("tools.jackson:jackson-bom");
    });

    it("excluded rows show currentRaw on both sides (not latestAvailable)", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "tools.jackson",
            artifact: "jackson-bom",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
          reason: "excluded",
          latestAvailable: "3.1.2",
        },
      ];
      const output = renderTable(decisions, 1);
      // Left column: 3.0.0; right column must NOT show 3.1.2
      expect(output).not.toContain("3.1.2");
      const matches = output.match(/3\.0\.0/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("excluded rows show (excluded) annotation, not (up to date)", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "tools.jackson",
            artifact: "jackson-bom",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
          reason: "excluded",
          latestAvailable: "3.1.2",
        },
      ];
      const output = renderTable(decisions, 1);
      expect(output).toContain("(excluded)");
      expect(output).not.toContain("(up to date)");
    });

    it("excluded count appears in summary at level 1, up-to-date only at level 2", () => {
      const decisions: Decision[] = [
        {
          occurrence: makeOccurrence({
            group: "tools.jackson",
            artifact: "jackson-bom",
            currentRaw: "3.0.0",
            file: "build.gradle.kts",
          }),
          status: "no-change",
          reason: "excluded",
          latestAvailable: "3.1.2",
        },
        makeNoChange("com.example", "up-to-date-lib", "1.0.0", "build.gradle.kts"),
      ];
      expect(renderTable(decisions, 0)).not.toContain("excluded");
      expect(renderTable(decisions, 1)).toContain("1 excluded");
      expect(renderTable(decisions, 1)).not.toContain("up to date");
      expect(renderTable(decisions, 2)).toContain("1 excluded");
      expect(renderTable(decisions, 2)).toContain("1 up to date");
    });

    it("orders no-change rows after upgrades within a file section", () => {
      const decisions: Decision[] = [
        makeNoChange("z.holder", "held-bom", "3.0.0", "build.gradle.kts"),
        makeUpgrade("a.lib", "active", "1.0.0", "1.1.0", "build.gradle.kts"),
      ];
      const output = renderTable(decisions, 2);
      const upgradeIndex = output.indexOf("a.lib:active");
      const heldIndex = output.indexOf("z.holder:held-bom");
      expect(upgradeIndex).toBeGreaterThan(-1);
      expect(heldIndex).toBeGreaterThan(upgradeIndex);
    });
  });
});
