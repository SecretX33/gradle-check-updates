import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigResolver } from "./resolve.js";

const FIXTURES_ROOT = join(
  import.meta.dirname,
  "../../test/fixtures/projects/multi-config",
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
