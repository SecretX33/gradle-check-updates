// src/discover/walk.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, sep, resolve } from "node:path";
import { tmpdir } from "node:os";
import { walk } from "./walk.js";

const temporaryRoots: string[] = [];

async function makeTree(files: Record<string, string>): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "gcu-walk-"));
  temporaryRoots.push(rootDir);
  for (const [relativePath, contents] of Object.entries(files)) {
    // Normalize forward-slash input to the OS-native separator so mkdir/writeFile work on Windows
    const normalizedRelativePath = relativePath.split("/").join(sep);
    const fullPath = join(rootDir, normalizedRelativePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, contents, "utf8");
  }
  return rootDir;
}

/** Strips the rootDir prefix and normalizes OS separators to forward slashes for cross-platform assertions. */
function relativize(rootDir: string, absolutePath: string): string {
  return absolutePath.replace(rootDir, "").split(sep).join("/");
}

afterEach(async () => {
  for (const rootDir of temporaryRoots.splice(0)) {
    await rm(rootDir, { recursive: true, force: true });
  }
});

describe("walk", () => {
  it("finds known build files at root", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "settings.gradle": "x",
      "gradle.properties": "x",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle", "/gradle.properties", "/settings.gradle"]);
  });

  it("finds known build files in subdirectories", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": "x",
      "gradle.properties": "x",
      "gradle/libs.versions.toml": "x",
      "app/build.gradle": "x",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual([
      "/app/build.gradle",
      "/build.gradle.kts",
      "/gradle.properties",
      "/gradle/libs.versions.toml",
      "/settings.gradle.kts",
    ]);
  });

  it("prunes hardcoded skip list — build dir", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "build/build.gradle": "should-not-appear",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("prunes hardcoded skip list — .gradle dir", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      ".gradle/build.gradle": "should-not-appear",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("prunes hardcoded skip list — node_modules", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "node_modules/build.gradle": "should-not-appear",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("prunes hardcoded skip list — .git dir", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      ".git/build.gradle": "should-not-appear",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("prunes all remaining hardcoded dirs", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      ".idea/build.gradle": "hidden",
      ".vscode/build.gradle": "hidden",
      ".hg/build.gradle": "hidden",
      ".svn/build.gradle": "hidden",
      "out/build.gradle": "hidden",
      "target/build.gradle": "hidden",
      ".pnpm-store/build.gradle": "hidden",
      ".yarn/build.gradle": "hidden",
      ".gcu/build.gradle": "hidden",
      "__pycache__/build.gradle": "hidden",
      ".venv/build.gradle": "hidden",
      "venv/build.gradle": "hidden",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("prunes any dot-prefixed dir not on the allow-list", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      ".customhidden/build.gradle": "should-not-appear",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("does NOT collect *.versions.toml outside a 'gradle' parent dir", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "libs.versions.toml": "should-not-appear",
      "config/libs.versions.toml": "should-not-appear",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("collects multiple *.versions.toml files under a 'gradle' parent dir", async () => {
    const rootDir = await makeTree({
      "gradle/libs.versions.toml": "x",
      "gradle/my.versions.toml": "x",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/gradle/libs.versions.toml", "/gradle/my.versions.toml"]);
  });

  it("ignores unknown file types", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "README.md": "docs",
      "src/main/App.kt": "code",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/build.gradle"]);
  });

  it("returns sorted absolute paths", async () => {
    const rootDir = await makeTree({
      "z-module/build.gradle": "x",
      "a-module/build.gradle": "x",
      "build.gradle": "x",
    });
    const result = await walk(rootDir);
    const sortedFiles = [...result.files].sort((fileA, fileB) =>
      fileA.path.localeCompare(fileB.path),
    );
    expect(result.files.map((discoveredFile) => discoveredFile.path)).toEqual(
      sortedFiles.map((discoveredFile) => discoveredFile.path),
    );
    // All paths must be absolute
    for (const discoveredFile of result.files) {
      expect(discoveredFile.path.startsWith(rootDir)).toBe(true);
    }
  });

  it("returns empty array for empty directory", async () => {
    const rootDir = await makeTree({});
    const result = await walk(rootDir);
    expect(result.files).toEqual([]);
  });

  it("handles deeply nested modules", async () => {
    const rootDir = await makeTree({
      "a/b/c/build.gradle": "x",
      "a/b/build.gradle": "x",
    });
    const files = (await walk(rootDir)).files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(files).toEqual(["/a/b/build.gradle", "/a/b/c/build.gradle"]);
  });

  it("tags gradle/*.versions.toml as isCatalogToml=true", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "gradle/libs.versions.toml": "x",
    });
    const result = await walk(rootDir);
    const catalogEntry = result.files.find((discoveredFile) =>
      discoveredFile.path.endsWith("libs.versions.toml"),
    );
    const buildEntry = result.files.find((discoveredFile) =>
      discoveredFile.path.endsWith("build.gradle"),
    );
    expect(catalogEntry?.isCatalogToml).toBe(true);
    expect(buildEntry?.isCatalogToml).toBe(false);
  });

  it("tags non-catalog build files as isCatalogToml=false", async () => {
    const rootDir = await makeTree({
      "build.gradle": "x",
      "settings.gradle": "x",
      "gradle.properties": "x",
    });
    const result = await walk(rootDir);
    for (const discoveredFile of result.files) {
      expect(discoveredFile.isCatalogToml).toBe(false);
    }
  });
});

describe("walk — settings-declared catalogs", () => {
  it("discovers catalog at non-standard path declared in settings.gradle.kts", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
dependencyResolutionManagement {
  versionCatalogs {
    create("libs") {
      from(files("gradle/libs/versions.toml"))
    }
  }
}
`,
      "gradle/libs/versions.toml": "[versions]\n",
    });
    const result = await walk(rootDir);
    const catalogEntry = result.files.find((discoveredFile) =>
      discoveredFile.path.endsWith(join("gradle", "libs", "versions.toml")),
    );
    expect(catalogEntry).toBeDefined();
    expect(catalogEntry?.isCatalogToml).toBe(true);
  });

  it("discovers two catalogs declared in settings.gradle.kts", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
dependencyResolutionManagement {
  versionCatalogs {
    create("libs") {
      from(files("gradle/libs.versions.toml"))
    }
    create("tools") {
      from(files("gradle/tools.versions.toml"))
    }
  }
}
`,
      "gradle/libs.versions.toml": "[versions]\n",
      "gradle/tools.versions.toml": "[versions]\n",
    });
    const result = await walk(rootDir);
    const libsEntry = result.files.find((discoveredFile) =>
      discoveredFile.path.endsWith("libs.versions.toml"),
    );
    const toolsEntry = result.files.find((discoveredFile) =>
      discoveredFile.path.endsWith("tools.versions.toml"),
    );
    expect(libsEntry?.isCatalogToml).toBe(true);
    expect(toolsEntry?.isCatalogToml).toBe(true);
  });

  it("silently skips a catalog path declared in settings that does not exist on disk", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
dependencyResolutionManagement {
  versionCatalogs {
    create("libs") {
      from(files("does-not-exist/libs.versions.toml"))
    }
  }
}
`,
    });
    const result = await walk(rootDir);
    const relativePaths = result.files.map((discoveredFile) =>
      relativize(rootDir, discoveredFile.path),
    );
    expect(relativePaths).not.toContain("/does-not-exist/libs.versions.toml");
    // No error thrown, and only the build file is returned
    expect(relativePaths).toEqual(["/build.gradle.kts", "/settings.gradle.kts"]);
  });

  it("does not duplicate a catalog already discovered via the default gradle/*.versions.toml rule", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
dependencyResolutionManagement {
  versionCatalogs {
    create("libs") {
      from(files("gradle/libs.versions.toml"))
    }
  }
}
`,
      "gradle/libs.versions.toml": "[versions]\n",
    });
    const result = await walk(rootDir);
    const catalogPaths = result.files.filter(
      (discoveredFile) => discoveredFile.isCatalogToml,
    );
    expect(catalogPaths).toHaveLength(1);
    expect(catalogPaths[0]?.path.endsWith("libs.versions.toml")).toBe(true);
  });

  it("settings file with no versionCatalogs block leaves walk behaviour unchanged", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "gradle/libs.versions.toml": "[versions]\n",
      "settings.gradle.kts": `
rootProject.name = "my-project"
include(":app")
`,
    });
    const result = await walk(rootDir);
    const relativePaths = result.files
      .map((discoveredFile) => relativize(rootDir, discoveredFile.path))
      .sort();
    expect(relativePaths).toEqual([
      "/build.gradle.kts",
      "/gradle/libs.versions.toml",
      "/settings.gradle.kts",
    ]);
    const catalogEntry = result.files.find((discoveredFile) =>
      discoveredFile.path.endsWith("libs.versions.toml"),
    );
    expect(catalogEntry?.isCatalogToml).toBe(true);
  });
});

describe("walk — settingsRepositories", () => {
  it("returns empty settingsRepositories when no settings files are present", async () => {
    const rootDir = await makeTree({ "build.gradle.kts": "x" });
    const result = await walk(rootDir);
    expect(result.settingsRepositories).toEqual([]);
  });

  it("collects pluginManagement repositories from settings.gradle.kts", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
pluginManagement {
  repositories {
    mavenCentral()
    maven("https://example.com/plugins")
  }
}
`,
    });
    const result = await walk(rootDir);
    expect(result.settingsRepositories).toContain(
      "https://repo.maven.apache.org/maven2/",
    );
    expect(result.settingsRepositories).toContain("https://example.com/plugins");
  });

  it("collects dependencyResolutionManagement repositories from settings.gradle.kts", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
dependencyResolutionManagement {
  repositories {
    google()
    maven { url = "https://example.com/deps" }
  }
}
`,
    });
    const result = await walk(rootDir);
    expect(result.settingsRepositories).toContain("https://maven.google.com/");
    expect(result.settingsRepositories).toContain("https://example.com/deps");
  });

  it("collects both pluginManagement and dependencyResolutionManagement repositories", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
pluginManagement {
  repositories {
    gradlePluginPortal()
  }
}
dependencyResolutionManagement {
  repositories {
    mavenCentral()
    maven("https://example.com/m2")
  }
}
`,
    });
    const result = await walk(rootDir);
    expect(result.settingsRepositories).toContain("https://plugins.gradle.org/m2/");
    expect(result.settingsRepositories).toContain(
      "https://repo.maven.apache.org/maven2/",
    );
    expect(result.settingsRepositories).toContain("https://example.com/m2");
  });

  it("deduplicates repository URLs across multiple settings files", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
pluginManagement { repositories { mavenCentral() } }
dependencyResolutionManagement { repositories { mavenCentral() } }
`,
    });
    const result = await walk(rootDir);
    const centralUrl = "https://repo.maven.apache.org/maven2/";
    const count = result.settingsRepositories.filter((url) => url === centralUrl).length;
    expect(count).toBe(1);
  });

  it("returns empty settingsRepositories when settings file has no repositories blocks", async () => {
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
rootProject.name = "my-project"
include(":app")
`,
    });
    const result = await walk(rootDir);
    expect(result.settingsRepositories).toEqual([]);
  });

  it("returns settingsRepositories so run.ts can include them in the repo list", async () => {
    // walk() always returns settingsRepositories; run.ts always includes them
    const rootDir = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": `
pluginManagement { repositories { mavenCentral() } }
`,
    });
    const result = await walk(rootDir);
    expect(result.settingsRepositories.length).toBeGreaterThan(0);
  });
});

describe("walk — fixture: walk-skip-defaults", () => {
  it("collects only real build files, skipping all pruned directories", async () => {
    const fixtureRoot = resolve("test/fixtures/projects/walk-skip-defaults");
    const files = (await walk(fixtureRoot)).files
      .map((discoveredFile) => relativize(fixtureRoot, discoveredFile.path))
      .sort();

    expect(files).toEqual([
      "/app/build.gradle",
      "/build.gradle.kts",
      "/gradle.properties",
      "/gradle/libs.versions.toml",
      "/settings.gradle.kts",
    ]);
  });
});
