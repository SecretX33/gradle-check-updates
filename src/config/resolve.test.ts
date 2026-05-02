import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigResolver } from "./resolve.js";

const FIXTURES_ROOT = join(
  import.meta.dirname,
  "../../test/fixtures/projects/multi-config/resolver",
);

describe("ConfigResolver — root-only", () => {
  const fixtureDir = join(FIXTURES_ROOT, "root-only");

  it("resolves app/build.gradle.kts to the root config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "app/build.gradle.kts"),
    );
    expect(resolved).toMatchObject({ target: "minor" });
  });

  it("resolves build.gradle.kts at root to the root config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(resolved).toMatchObject({ target: "minor" });
  });
});

describe("ConfigResolver — submodule-override", () => {
  const fixtureDir = join(FIXTURES_ROOT, "submodule-override");

  it("resolves submodule/build.gradle.kts to the submodule config (patch)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    expect(resolved).toMatchObject({ target: "patch" });
  });

  it("resolves root build.gradle.kts to the root config (major)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(resolved).toMatchObject({ target: "major" });
  });
});

describe("ConfigResolver — properties-at-root", () => {
  const fixtureDir = join(FIXTURES_ROOT, "properties-at-root");

  it("resolves gradle.properties (edit site at root) to root config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "gradle.properties"));
    expect(resolved).toMatchObject({ target: "minor" });
  });
});

describe("ConfigResolver — catalog-adjacent", () => {
  const fixtureDir = join(FIXTURES_ROOT, "catalog-adjacent");

  it("resolves gradle/libs.versions.toml with isCatalogToml=true to root config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "gradle/libs.versions.toml"),
      true,
    );
    expect(resolved).toMatchObject({ target: "patch" });
  });

  it("resolves gradle/libs.versions.toml without isCatalogToml (starts from gradle/) to root config (since .gcu.json is at root adjacent to gradle/)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    // Without the flag, the walk starts from gradle/ dir, then goes up to the project root
    // The .gcu.json is at the root (adjacent to gradle/), so it should still be found
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "gradle/libs.versions.toml"),
      false,
    );
    expect(resolved).toMatchObject({ target: "patch" });
  });
});

describe("ConfigResolver — chained inheritance", () => {
  const fixtureDir = join(FIXTURES_ROOT, "chain-inherit");

  it("submodule file inherits parent fields not overridden by the inner config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    // root sets target:minor and pre:true; submodule sets only cooldown:7
    expect(resolved.target).toBe("minor");
    expect(resolved.pre).toBe(true);
    expect(resolved.cooldown).toBe(7);
  });

  it("root file only sees the root config (submodule config is not in its walk path)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(resolved.target).toBe("minor");
    expect(resolved.pre).toBe(true);
    expect(resolved.cooldown).toBeUndefined();
  });

  it("inner config overrides a field set by the outer config", async () => {
    // submodule-override: root={target:major}, submodule={target:patch}
    const submoduleOverrideDir = join(FIXTURES_ROOT, "submodule-override");
    const resolver = new ConfigResolver(submoduleOverrideDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(submoduleOverrideDir, "submodule/build.gradle.kts"),
    );
    expect(resolved.target).toBe("patch");
  });
});

describe("ConfigResolver — memoization", () => {
  const fixtureDir = join(FIXTURES_ROOT, "root-only");

  it("memoizes directory lookups — second file in same subdirectory gets same config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);

    const result1 = await resolver.resolveForFile(
      join(fixtureDir, "app/build.gradle.kts"),
    );
    const readsAfterFirst = resolver.fileReadCount;

    const result2 = await resolver.resolveForFile(
      join(fixtureDir, "app/settings.gradle.kts"),
    );
    const readsAfterSecond = resolver.fileReadCount;

    // The second resolve for the same directory should not trigger any additional disk reads
    expect(readsAfterSecond).toBe(readsAfterFirst);
    // Both results must return the root config, not an empty object
    expect(result1).toEqual({ target: "minor" });
    expect(result2).toEqual({ target: "minor" });
  });
});

describe("ConfigResolver — userConfig merging", () => {
  const fixtureDir = join(FIXTURES_ROOT, "root-only");

  it("merges userConfig with project config, project config wins on conflict", async () => {
    const userConfig = { target: "major" as const, noCache: true };
    const resolver = new ConfigResolver(fixtureDir, userConfig);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "app/build.gradle.kts"),
    );
    // Project config has target: "minor" which overrides user's "major"
    expect(resolved.target).toBe("minor");
    // noCache comes from userConfig since project config doesn't set it
    expect(resolved.noCache).toBe(true);
  });

  it("uses userConfig when no project config is found", async () => {
    // stopAt is "/" and the file is directly under "/" — no .gcu.json can be found,
    // so the resolved config must equal exactly the userConfig.
    const resolver = new ConfigResolver("/", { target: "patch" as const });
    const resolved = await resolver.resolveForFile("/some-build.gradle.kts");
    expect(resolved.target).toBe("patch");
  });

  it("project config { noCache: true } + userConfig { target: major } produces merged result", async () => {
    // Use submodule-override: submodule config has { target: "patch" }
    const submoduleFixture = join(FIXTURES_ROOT, "submodule-override");
    const userConfig = { noCache: true };
    const resolver = new ConfigResolver(submoduleFixture, userConfig);
    const resolved = await resolver.resolveForFile(
      join(submoduleFixture, "submodule/build.gradle.kts"),
    );
    expect(resolved.target).toBe("patch");
    expect(resolved.noCache).toBe(true);
  });
});

// ── Deep chain (3+ levels) ────────────────────────────────────────────────────

describe("ConfigResolver — deep-chain (4 levels)", () => {
  // Layout:
  //   .gcu.json            { target:major, pre:true }
  //   a/.gcu.json          { target:minor, cooldown:5 }
  //   a/b/.gcu.json        { target:patch, exclude:["org.bad.*"] }
  //   a/b/c/.gcu.json      { cooldown:10 }
  const fixtureDir = join(FIXTURES_ROOT, "deep-chain");

  it("leaf file (depth 4) merges all four layers field-by-field", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "a/b/c/build.gradle.kts"),
    );
    expect(resolved).toEqual({
      target: "patch", // overridden at depth 2 (a/b)
      pre: true, // inherited from root
      cooldown: 10, // overridden at depth 3 (a/b/c)
      exclude: ["org.bad.*"], // inherited from depth 2
    });
  });

  it("innermost target (patch) wins over middle (minor) wins over root (major)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "a/b/c/build.gradle.kts"),
    );
    expect(resolved.target).toBe("patch");
  });

  it("a/b file sees cooldown:5 from a/, not the deeper cooldown:10 from a/b/c", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "a/b/build.gradle.kts"),
    );
    expect(resolved.cooldown).toBe(5);
    expect(resolved.target).toBe("patch");
  });

  it("a/ file does not see fields set in a/b or a/b/c", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "a/build.gradle.kts"),
    );
    expect(resolved.target).toBe("minor");
    expect(resolved.cooldown).toBe(5);
    expect(resolved.exclude).toBeUndefined();
  });

  it("root file sees only the root config — no inner layers leak upward", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(resolved).toEqual({ target: "major", pre: true });
  });
});

// ── Array fields (include / exclude) ──────────────────────────────────────────

describe("ConfigResolver — array fields", () => {
  const fixtureDir = join(FIXTURES_ROOT, "array-replace");

  it("inner include replaces outer include (no concatenation)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    expect(resolved.include).toEqual(["com.google.*"]);
  });

  it("inner config without exclude inherits outer exclude", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    expect(resolved.exclude).toEqual(["legacy.*"]);
  });

  it("root file sees the root arrays unchanged", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(resolved.include).toEqual(["org.spring.*"]);
    expect(resolved.exclude).toEqual(["legacy.*"]);
  });
});

// ── Empty intermediate config ─────────────────────────────────────────────────

describe("ConfigResolver — empty intermediate config", () => {
  const fixtureDir = join(FIXTURES_ROOT, "empty-middle");

  it("empty {} at mid level is a transparent no-op", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "mid/leaf/build.gradle.kts"),
    );
    expect(resolved).toEqual({ target: "minor", pre: true, cooldown: 3 });
  });

  it("file at the empty-config directory itself sees only the outer fields", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "mid/build.gradle.kts"),
    );
    expect(resolved).toEqual({ target: "minor", pre: true });
  });
});

// ── All 8 fields covered in inheritance ───────────────────────────────────────

describe("ConfigResolver — all-fields inheritance", () => {
  // Root .gcu.json sets: target, pre, cooldown, allowDowngrade
  // Sub  .gcu.json sets: include, exclude
  // userConfig (user-only fields): cacheDir, noCache
  const fixtureDir = join(FIXTURES_ROOT, "all-fields-chain");

  it("submodule file sees every field from both layers merged together", async () => {
    const userConfig = { cacheDir: "/tmp/gcu-cache", noCache: true };
    const resolver = new ConfigResolver(fixtureDir, userConfig);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "sub/build.gradle.kts"),
    );
    expect(resolved).toEqual({
      target: "minor",
      pre: true,
      cooldown: 5,
      allowDowngrade: true,
      include: ["org.example.*"],
      exclude: ["legacy.*"],
      cacheDir: "/tmp/gcu-cache",
      noCache: true,
    });
  });

  it("root file sees only the root-set fields plus userConfig user-only fields, not the submodule ones", async () => {
    const userConfig = { cacheDir: "/tmp/gcu-cache", noCache: true };
    const resolver = new ConfigResolver(fixtureDir, userConfig);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(resolved).toEqual({
      target: "minor",
      pre: true,
      cooldown: 5,
      allowDowngrade: true,
      cacheDir: "/tmp/gcu-cache",
      noCache: true,
    });
  });
});

// ── Sibling submodules ────────────────────────────────────────────────────────

describe("ConfigResolver — siblings", () => {
  // Layout: root sets pre:true; mod-a sets target:patch; mod-b sets target:major
  const fixtureDir = join(FIXTURES_ROOT, "siblings");

  it("mod-a file resolves to root + mod-a config", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "mod-a/build.gradle.kts"),
    );
    expect(resolved).toEqual({ pre: true, target: "patch" });
  });

  it("mod-b file resolves to root + mod-b config (independent of mod-a)", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "mod-b/build.gradle.kts"),
    );
    expect(resolved).toEqual({ pre: true, target: "major" });
  });

  it("resolving mod-a then mod-b in same resolver does not pollute mod-b's result", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolvedA = await resolver.resolveForFile(
      join(fixtureDir, "mod-a/build.gradle.kts"),
    );
    const resolvedB = await resolver.resolveForFile(
      join(fixtureDir, "mod-b/build.gradle.kts"),
    );
    expect(resolvedA.target).toBe("patch");
    expect(resolvedB.target).toBe("major");
  });

  it("memoization: root .gcu.json is read at most once across two sibling resolutions", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    await resolver.resolveForFile(join(fixtureDir, "mod-a/build.gradle.kts"));
    await resolver.resolveForFile(join(fixtureDir, "mod-b/build.gradle.kts"));
    // mod-a walk reads root/.gcu.json (1) + mod-a/.gcu.json (1) = 2 and caches both dirs.
    // mod-b walk reuses the cached root entry as its base, then reads mod-b/.gcu.json (1).
    // Total: 3 reads — root is read exactly once.
    expect(resolver.fileReadCount).toBe(3);
  });
});

// ── Catalog edge cases ────────────────────────────────────────────────────────

describe("ConfigResolver — catalog edge cases", () => {
  it("`.gcu.json` inside `gradle/` is ignored when isCatalogToml=true (walk starts at gradle/'s parent)", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "catalog-inside-gradle");
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "gradle/libs.versions.toml"),
      true,
    );
    // root sets target:minor; gradle/.gcu.json sets target:patch but is OUTSIDE the walk path
    expect(resolved.target).toBe("minor");
  });

  it("catalog walk reaches a config many levels above gradle/", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "catalog-deep");
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "sub/gradle/libs.versions.toml"),
      true,
    );
    // No .gcu.json adjacent to gradle/; walk continues up to root and finds target:patch
    expect(resolved.target).toBe("patch");
  });

  it("non-catalog mode walks from gradle/ itself, so gradle/.gcu.json IS in chain", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "catalog-inside-gradle");
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "gradle/libs.versions.toml"),
      false,
    );
    // Walk: gradle/ (target:patch wins) ← root (target:minor)
    expect(resolved.target).toBe("patch");
  });
});

// ── Submodule isolation (cardinal rule) ───────────────────────────────────────

describe("ConfigResolver — submodule isolation", () => {
  // Layout:
  //   .gcu.json                  { target: major }
  //   submodule/.gcu.json        { target: patch }    ← contradictory
  const fixtureDir = join(FIXTURES_ROOT, "submodule-isolated");

  it("root gradle.properties is governed only by root config — submodule's contradictory target has zero effect", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(join(fixtureDir, "gradle.properties"));
    expect(resolved.target).toBe("major");
  });

  it("file inside submodule sees the submodule override", async () => {
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    expect(resolved.target).toBe("patch");
  });
});

// ── userConfig field-by-field merge ───────────────────────────────────────────

describe("ConfigResolver — userConfig field-by-field", () => {
  it("partial overlap: project wins for shared fields, user supplies disjoint fields", async () => {
    // submodule-override project sets target:patch on submodule. We supply user config
    // that overlaps on target and adds cooldown.
    const fixtureDir = join(FIXTURES_ROOT, "submodule-override");
    const userConfig = { target: "major" as const, cooldown: 14 };
    const resolver = new ConfigResolver(fixtureDir, userConfig);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    // project's target (patch) wins; cooldown comes from user (no project override)
    expect(resolved.target).toBe("patch");
    expect(resolved.cooldown).toBe(14);
  });

  it("user config fields survive across a multi-layer chain when no project layer overrides them", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "deep-chain");
    const userConfig = { cacheDir: "/from-user-config" };
    const resolver = new ConfigResolver(fixtureDir, userConfig);
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "a/b/c/build.gradle.kts"),
    );
    // No layer in the chain sets cacheDir — user value flows all the way through.
    expect(resolved.cacheDir).toBe("/from-user-config");
  });
});

// ── Robustness ────────────────────────────────────────────────────────────────

describe("ConfigResolver — robustness", () => {
  it("malformed JSON at a mid-chain dir: error callback fires, walk continues, outer + leaf merge", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "malformed-middle");
    const errors: { path: string; error: Error }[] = [];
    const resolver = new ConfigResolver(fixtureDir, undefined, undefined, (path, error) =>
      errors.push({ path, error }),
    );
    const resolved = await resolver.resolveForFile(
      join(fixtureDir, "bad/leaf/build.gradle.kts"),
    );
    // Outer .gcu.json (target:minor) merges with leaf .gcu.json (cooldown:1).
    // Middle .gcu.json is malformed and silently skipped.
    expect(resolved).toEqual({ target: "minor", cooldown: 1 });
    // Exactly one error reported, and it points at the bad file.
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toContain("bad");
    expect(errors[0]!.path).toContain(".gcu.json");
    expect(errors[0]!.error).toBeInstanceOf(SyntaxError);
  });

  it("walk stops at projectRoot — a `.gcu.json` higher up is never read", async () => {
    // Use submodule-override but pass projectRoot=submodule. The root .gcu.json is now
    // OUTSIDE projectRoot and must not be loaded.
    const realRoot = join(FIXTURES_ROOT, "submodule-override");
    const projectRoot = join(realRoot, "submodule");
    const resolver = new ConfigResolver(projectRoot, undefined);
    const resolved = await resolver.resolveForFile(join(projectRoot, "build.gradle.kts"));
    // Only the submodule .gcu.json (target:patch) is in the chain.
    expect(resolved).toEqual({ target: "patch" });
    // Exactly one disk read — the submodule's .gcu.json. The root one is above projectRoot.
    expect(resolver.fileReadCount).toBe(1);
  });

  it("onConfigLoaded callback fires for every config successfully read in the chain", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "deep-chain");
    const loaded: string[] = [];
    const resolver = new ConfigResolver(fixtureDir, undefined, (path) =>
      loaded.push(path),
    );
    await resolver.resolveForFile(join(fixtureDir, "a/b/c/build.gradle.kts"));
    expect(loaded).toHaveLength(4);
    expect(loaded.every((path) => path.endsWith(".gcu.json"))).toBe(true);
    // Outermost loaded first
    expect(loaded[0]).toBe(join(fixtureDir, ".gcu.json"));
    expect(loaded[3]).toBe(join(fixtureDir, "a", "b", "c", ".gcu.json"));
  });
});

// ── Cache correctness across siblings / ancestors ─────────────────────────────

describe("ConfigResolver — cache correctness", () => {
  it("resolving an inner file then an outer file does not let the inner's fields leak into the outer's result", async () => {
    // Reuses submodule-override: root sets target:major, submodule sets target:patch.
    // The hazard: resolving the submodule first populates the cache for *every* dir in the
    // chain (including projectRoot) with the FULL merged result. A naive cache lookup at
    // projectRoot would then return the submodule's target:patch when asked for a file at
    // root — violating the unidirectional walk rule.
    const fixtureDir = join(FIXTURES_ROOT, "submodule-override");
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const inner = await resolver.resolveForFile(
      join(fixtureDir, "submodule/build.gradle.kts"),
    );
    expect(inner.target).toBe("patch");
    const outer = await resolver.resolveForFile(join(fixtureDir, "build.gradle.kts"));
    expect(outer.target).toBe("major");
  });

  it("resolving deep file then mid-chain file does not let the deep override leak upward", async () => {
    // deep-chain: root target:major, a/ target:minor, a/b/ target:patch, a/b/c/ cooldown:10.
    // After resolving a/b/c, asking for a/b must still yield target:patch (its own depth),
    // not the same merged result that a/b/c saw.
    const fixtureDir = join(FIXTURES_ROOT, "deep-chain");
    const resolver = new ConfigResolver(fixtureDir, undefined);
    const deep = await resolver.resolveForFile(
      join(fixtureDir, "a/b/c/build.gradle.kts"),
    );
    expect(deep.cooldown).toBe(10);
    const mid = await resolver.resolveForFile(join(fixtureDir, "a/b/build.gradle.kts"));
    // Without the deeper layer, cooldown must come from a/, not from a/b/c/.
    expect(mid.cooldown).toBe(5);
  });
});
