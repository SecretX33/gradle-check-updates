// src/discover/settings.test.ts
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { parseSettingsFile } from "./settings.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gcu-settings-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeTempFile(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

// ── Test 1: single versionCatalogs create + from(files(...)) ────────────────
describe("versionCatalogs", () => {
  it("detects one create block and resolves its absolute path", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
versionCatalogs {
    create("libs") {
        from(files("gradle/libs.versions.toml"))
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(1);
    expect(result.catalogFiles[0]!.name).toBe("libs");
    expect(result.catalogFiles[0]!.path).toBe(join(tempDir, "gradle/libs.versions.toml"));
  });

  // ── Test 2: multiple create blocks ──────────────────────────────────────
  it("detects multiple create blocks in order", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
versionCatalogs {
    create("libs") {
        from(files("gradle/libs.versions.toml"))
    }
    create("deps") {
        from(files("path/to/deps.toml"))
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(2);
    expect(result.catalogFiles[0]!.name).toBe("libs");
    expect(result.catalogFiles[0]!.path).toBe(join(tempDir, "gradle/libs.versions.toml"));
    expect(result.catalogFiles[1]!.name).toBe("deps");
    expect(result.catalogFiles[1]!.path).toBe(join(tempDir, "path/to/deps.toml"));
  });

  // ── Test 3: versionCatalogs nested inside dependencyResolutionManagement ─
  it("detects versionCatalogs nested inside dependencyResolutionManagement", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
dependencyResolutionManagement {
    versionCatalogs {
        create("libs") {
            from(files("gradle/libs.versions.toml"))
        }
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(1);
    expect(result.catalogFiles[0]!.name).toBe("libs");
    expect(result.catalogFiles[0]!.path).toBe(join(tempDir, "gradle/libs.versions.toml"));
  });

  // ── Test 4: published catalog form (no files()) — ignored, warning logged ─
  it("ignores from(group:artifact:version) published catalogs and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
versionCatalogs {
    create("libs") {
        from("com.example:catalog:1.0.0")
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[gcu] settings.gradle.kts: published catalog"),
    );
    warnSpy.mockRestore();
  });
});

// ── Test 5: pluginManagement.repositories ───────────────────────────────────
describe("pluginManagement.repositories", () => {
  it("extracts URLs from pluginManagement repositories block", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
pluginManagement {
    repositories {
        mavenCentral()
        maven("https://example.com/m2")
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.pluginRepositories).toContain("https://repo.maven.apache.org/maven2/");
    expect(result.pluginRepositories).toContain("https://example.com/m2");
    expect(result.dependencyRepositories).toHaveLength(0);
  });
});

// ── Test 6: dependencyResolutionManagement.repositories ────────────────────
describe("dependencyResolutionManagement.repositories", () => {
  it("extracts URLs from dependencyResolutionManagement repositories block", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        maven { url = uri("https://drm-repo.example.com/maven") }
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.dependencyRepositories).toContain(
      "https://repo.maven.apache.org/maven2/",
    );
    expect(result.dependencyRepositories).toContain("https://drm-repo.example.com/maven");
    expect(result.pluginRepositories).toHaveLength(0);
  });
});

// ── Test 7: both blocks in same file — no cross-contamination ───────────────
describe("both repo blocks in same file", () => {
  it("populates plugin and dependency repos separately", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
pluginManagement {
    repositories {
        maven("https://plugin-repo.example.com/")
    }
}

dependencyResolutionManagement {
    repositories {
        google()
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.pluginRepositories).toEqual(["https://plugin-repo.example.com/"]);
    expect(result.dependencyRepositories).toEqual(["https://maven.google.com/"]);
  });
});

// ── Test 8: mavenLocal() silently dropped ───────────────────────────────────
describe("mavenLocal()", () => {
  it("silently drops mavenLocal from plugin repositories", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
pluginManagement {
    repositories {
        mavenLocal()
        mavenCentral()
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.pluginRepositories).toEqual(["https://repo.maven.apache.org/maven2/"]);
  });

  it("silently drops mavenLocal from dependency repositories", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
dependencyResolutionManagement {
    repositories {
        mavenLocal()
        google()
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.dependencyRepositories).toEqual(["https://maven.google.com/"]);
  });
});

// ── Test 9: pluginManagement.plugins block detection ────────────────────────
describe("pluginManagement.plugins block", () => {
  it("emits byteStart/byteEnd for the inner plugins block", async () => {
    const content = `pluginManagement {
    plugins {
        id("org.jetbrains.kotlin.jvm") version "2.0.0"
    }
}
`;
    const filePath = await writeTempFile("settings.gradle.kts", content);
    const result = await parseSettingsFile(filePath);
    expect(result.pluginOccurrenceBlocks).toHaveLength(1);
    const block = result.pluginOccurrenceBlocks[0]!;
    expect(block.byteStart).toBeGreaterThanOrEqual(0);
    expect(block.byteEnd).toBeGreaterThan(block.byteStart);
    // Verify the byte range covers the braces of the plugins block
    const buf = Buffer.from(content, "utf8");
    expect(buf[block.byteStart]).toBe(0x7b); // '{'
    expect(buf[block.byteEnd - 1]).toBe(0x7d); // '}'
  });

  it("does NOT emit top-level plugins { } blocks", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
plugins {
    id("com.example.plugin") version "1.0"
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.pluginOccurrenceBlocks).toHaveLength(0);
  });
});

// ── Test 10: commented-out versionCatalogs not detected ─────────────────────
describe("commented-out blocks", () => {
  it("ignores line-commented versionCatalogs", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `// versionCatalogs { create("libs") { from(files("gradle/libs.versions.toml")) } }
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(0);
  });

  it("ignores block-commented versionCatalogs", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `/*
versionCatalogs {
    create("libs") {
        from(files("gradle/libs.versions.toml"))
    }
}
*/
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(0);
  });
});

// ── Test 11: empty settings file ────────────────────────────────────────────
describe("empty settings file", () => {
  it("returns all empty arrays when no relevant blocks exist", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `rootProject.name = "my-project"
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.catalogFiles).toHaveLength(0);
    expect(result.pluginRepositories).toHaveLength(0);
    expect(result.dependencyRepositories).toHaveLength(0);
    expect(result.pluginOccurrenceBlocks).toHaveLength(0);
  });
});

// ── Test 12: settings.gradle (Groovy DSL) ───────────────────────────────────
describe("Groovy DSL settings.gradle", () => {
  it("detects pluginManagement repositories in Groovy syntax", async () => {
    const filePath = await writeTempFile(
      "settings.gradle",
      `
pluginManagement {
    repositories {
        mavenCentral()
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.pluginRepositories).toContain("https://repo.maven.apache.org/maven2/");
  });
});

// ── Test 13: repositoriesMode.set(...) line is ignored ──────────────────────
describe("repositoriesMode.set(...) is ignored", () => {
  it("does not break repo extraction when repositoriesMode.set appears", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        mavenCentral()
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.dependencyRepositories).toContain(
      "https://repo.maven.apache.org/maven2/",
    );
  });
});

// ── Test 14: two consecutive maven { } blocks in the same repositories {} ────
describe("consecutive maven { } blocks", () => {
  it("detects both maven blocks when one uses uri() and the next uses a plain string", async () => {
    const filePath = await writeTempFile(
      "settings.gradle.kts",
      `
dependencyResolutionManagement {
    repositories {
        maven { url = uri("https://first.example.com/maven") }
        maven { url = "https://second.example.com/maven" }
    }
}
`,
    );
    const result = await parseSettingsFile(filePath);
    expect(result.dependencyRepositories).toContain("https://first.example.com/maven");
    expect(result.dependencyRepositories).toContain("https://second.example.com/maven");
  });
});
