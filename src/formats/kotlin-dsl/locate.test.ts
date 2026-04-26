// src/formats/kotlin-dsl/locate.test.ts
import { describe, it, expect } from "vitest";
import { locateKotlin } from "./locate.js";

function sliceBytes(text: string, start: number, end: number): string {
  return Buffer.from(text).slice(start, end).toString();
}

describe("locateKotlin", () => {
  it("finds exact GAV in double-quoted string", () => {
    const text = `dependencies {\n  implementation("org.foo:bar:1.0.0")\n}\n`;
    const occurrences = locateKotlin("/x/build.gradle.kts", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.foo");
    expect(occurrence.artifact).toBe("bar");
    expect(occurrence.currentRaw).toBe("1.0.0");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.0.0");
  });

  it('finds plugin: id("...") version "..."', () => {
    const occurrences = locateKotlin(
      "/x",
      `plugins {\n  id("org.springframework.boot") version "3.2.0"\n}`,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.group).toBe("org.springframework.boot");
    expect(occurrences[0]!.currentRaw).toBe("3.2.0");
  });

  it('locates val kotlinVersion = "1.9.0"', () => {
    const occurrences = locateKotlin("/x", `val kotlinVersion = "1.9.0"`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({
        dependencyKey: "prop:kotlinVersion",
        currentRaw: "1.9.0",
      }),
    );
  });

  it("emits pending-ref for interpolated version", () => {
    const occurrences = locateKotlin("/x", `implementation("a:b:$kotlinVersion")`);
    expect(occurrences[0]!.via?.[0]).toMatch(/^__pending_ref__:kotlinVersion$/);
  });

  it('locates extra["varName"] = "1.0"', () => {
    const occurrences = locateKotlin("/x", `extra["kotlinVersion"] = "1.9.0"`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({ dependencyKey: "prop:kotlinVersion" }),
    );
  });

  // Extra tests beyond the spec

  it('api("a:b:1.5.0") is found (api is a valid config name)', () => {
    const occurrences = locateKotlin("/x", `api("a:b:1.5.0")`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.currentRaw).toBe("1.5.0");
  });

  it("testImplementation with SNAPSHOT version gets snapshot shape", () => {
    const occurrences = locateKotlin("/x", `testImplementation("a:b:1.0-SNAPSHOT")`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("snapshot");
  });

  it('2-part GAV implementation("a:b") produces no occurrences (no version)', () => {
    const occurrences = locateKotlin("/x", `implementation("a:b")`);
    expect(occurrences).toHaveLength(0);
  });

  it('val varName by extra("1.0.0") emits prop:varName', () => {
    const occurrences = locateKotlin("/x", `val myVersion by extra("1.0.0")`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({ dependencyKey: "prop:myVersion", currentRaw: "1.0.0" }),
    );
  });

  it("plugin occurrence has correct group and artifact", () => {
    const occurrences = locateKotlin("/x", `id("com.example.plugin") version "2.1.0"`);
    expect(occurrences[0]!.group).toBe("com.example.plugin");
    expect(occurrences[0]!.artifact).toBe("com.example.plugin.gradle.plugin");
    expect(occurrences[0]!.dependencyKey).toBe(
      "com.example.plugin:com.example.plugin.gradle.plugin",
    );
  });

  it("byte offset of version in GAV string is correct", () => {
    // "org.foo:bar:1.0.0"
    //  0123456789012345678
    // 'o' is at byte 0 in body; version starts at index 12 ("1.0.0")
    const text = `implementation("org.foo:bar:1.0.0")`;
    const occurrences = locateKotlin("/x", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    // Extract the substring using the byte offsets
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.0.0");
  });

  it("maven range version gets mavenRange shape and is report-only eligible", () => {
    const occurrences = locateKotlin("/x", `implementation("org.foo:bar:[1.0,2.0)")`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("mavenRange");
  });

  it("does not emit occurrence for implementation without parens (invalid Kotlin)", () => {
    // In Kotlin DSL, parens are always required — bare call should not be found
    const occurrences = locateKotlin("/x", `implementation "org.foo:bar:1.0.0"`);
    expect(occurrences).toHaveLength(0);
  });

  it("interpolated version with braces: \${varName}", () => {
    const occurrences = locateKotlin("/x", `implementation("a:b:\${myVersion}")`);
    expect(occurrences[0]!.via?.[0]).toBe("__pending_ref__:myVersion");
  });

  // ── Rich version block: version { strictly(...) prefer(...) } ──────────────

  it("version { strictly(...) } emits richStrictly occurrence", () => {
    const source = [
      `dependencies {`,
      `    implementation("org.foo:bar") {`,
      `        version {`,
      `            strictly("1.7.15")`,
      `        }`,
      `    }`,
      `}`,
      ``,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.shape).toBe("richStrictly");
    expect(occurrence.currentRaw).toBe("1.7.15");
    expect(occurrence.group).toBe("org.foo");
    expect(occurrence.artifact).toBe("bar");
    expect(sliceBytes(source, occurrence.byteStart, occurrence.byteEnd)).toBe("1.7.15");
  });

  it("version { prefer(...) } emits richPrefer occurrence", () => {
    const source = [
      `dependencies {`,
      `    implementation("org.foo:bar") {`,
      `        version {`,
      `            prefer("1.7.25")`,
      `        }`,
      `    }`,
      `}`,
      ``,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.shape).toBe("richPrefer");
    expect(occurrence.currentRaw).toBe("1.7.25");
    expect(sliceBytes(source, occurrence.byteStart, occurrence.byteEnd)).toBe("1.7.25");
  });

  it("version { require(...) } emits richRequire occurrence", () => {
    const source = `implementation("org.foo:bar") { version { require("2.0.0") } }`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("richRequire");
    expect(occurrences[0]!.currentRaw).toBe("2.0.0");
  });

  it("version { reject(...) } emits richReject occurrence", () => {
    const source = `implementation("org.foo:bar") { version { reject("1.0.0") } }`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("richReject");
    expect(occurrences[0]!.currentRaw).toBe("1.0.0");
  });

  it("version block with strictly and prefer shares dependencyKey", () => {
    const source = [
      `dependencies {`,
      `    implementation("org.foo:bar") {`,
      `        version {`,
      `            strictly("1.7.15")`,
      `            prefer("1.7.25")`,
      `        }`,
      `    }`,
      `}`,
      ``,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.dependencyKey).toBe(occurrences[1]!.dependencyKey);
    expect(occurrences[0]!.dependencyKey).toMatch(/^org\.foo:bar@\d+$/);
  });

  it("version block byte offsets point to version literal inside parens", () => {
    const source = `implementation("org.foo:bar") { version { strictly("1.7.15") } }`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(sliceBytes(source, occurrence.byteStart, occurrence.byteEnd)).toBe("1.7.15");
  });
});

describe("settings.gradle.kts plugin detection", () => {
  it("top-level plugins block in settings.gradle.kts has no via field", () => {
    const source = `plugins {\n  id("com.example.foo") version "1.0.0"\n}\n`;
    const occurrences = locateKotlin("/root/settings.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.example.foo");
    expect(occurrence.currentRaw).toBe("1.0.0");
    expect(occurrence.via).toBeUndefined();
  });

  it("pluginManagement plugins block in settings.gradle.kts has via: ['pluginManagement']", () => {
    const source = [
      `pluginManagement {`,
      `  plugins {`,
      `    id("com.example.foo") version "1.0.0"`,
      `  }`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/root/settings.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.example.foo");
    expect(occurrence.currentRaw).toBe("1.0.0");
    expect(occurrence.via).toEqual(["pluginManagement"]);
  });

  it("both top-level and pluginManagement plugins in the same settings file are detected with correct via", () => {
    const source = [
      `pluginManagement {`,
      `  plugins {`,
      `    id("com.example.mgmt") version "2.0.0"`,
      `  }`,
      `}`,
      `plugins {`,
      `  id("com.example.top") version "3.0.0"`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/root/settings.gradle.kts", source);
    expect(occurrences).toHaveLength(2);

    const mgmtOccurrence = occurrences.find((o) => o.group === "com.example.mgmt");
    const topOccurrence = occurrences.find((o) => o.group === "com.example.top");

    expect(mgmtOccurrence).toBeDefined();
    expect(mgmtOccurrence!.via).toEqual(["pluginManagement"]);
    expect(mgmtOccurrence!.currentRaw).toBe("2.0.0");

    expect(topOccurrence).toBeDefined();
    expect(topOccurrence!.via).toBeUndefined();
    expect(topOccurrence!.currentRaw).toBe("3.0.0");
  });

  it("non-settings file: build.gradle.kts plugins block has no via field", () => {
    const source = `plugins {\n  id("com.example.foo") version "1.0.0"\n}\n`;
    const occurrences = locateKotlin("/root/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.via).toBeUndefined();
  });

  it("commented-out pluginManagement block is not detected", () => {
    const source = [
      `// pluginManagement {`,
      `//   plugins {`,
      `//     id("com.example.foo") version "1.0.0"`,
      `//   }`,
      `// }`,
    ].join("\n");
    const occurrences = locateKotlin("/root/settings.gradle.kts", source);
    expect(occurrences).toHaveLength(0);
  });
});

describe("kotlin() shorthand — plugins block", () => {
  it('basic kotlin("jvm") version "2.2.20"', () => {
    const source = [`plugins {`, `    kotlin("jvm") version "2.2.20"`, `}`].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.jetbrains.kotlin.jvm");
    expect(occurrence.artifact).toBe("org.jetbrains.kotlin.jvm.gradle.plugin");
    expect(occurrence.currentRaw).toBe("2.2.20");
    expect(occurrence.dependencyKey).toBe(
      "org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin",
    );
  });

  it('multi-segment name kotlin("multiplatform") version "2.0.0"', () => {
    const source = [`plugins {`, `    kotlin("multiplatform") version "2.0.0"`, `}`].join(
      "\n",
    );
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.jetbrains.kotlin.multiplatform");
    expect(occurrence.artifact).toBe("org.jetbrains.kotlin.multiplatform.gradle.plugin");
  });

  it("mixed kotlin() and id() in same plugins block — both detected independently", () => {
    const source = [
      `plugins {`,
      `    kotlin("jvm") version "2.2.20"`,
      `    id("com.example.plugin") version "1.0.0"`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(2);
    const kotlinOccurrence = occurrences.find((occurrence) =>
      occurrence.group.startsWith("org.jetbrains.kotlin"),
    );
    const idOccurrence = occurrences.find((occurrence) =>
      occurrence.group.startsWith("com.example"),
    );
    expect(kotlinOccurrence).toBeDefined();
    expect(kotlinOccurrence!.currentRaw).toBe("2.2.20");
    expect(idOccurrence).toBeDefined();
    expect(idOccurrence!.currentRaw).toBe("1.0.0");
  });

  it('kotlin("jvm") WITHOUT version — NOT detected', () => {
    const source = [
      `plugins {`,
      `    kotlin("jvm")`,
      `    id("com.example.plugin") version "1.0.0"`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    // Only the id() occurrence should be found
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.group).toBe("com.example.plugin");
  });

  it('kotlin("jvm") version "2.2.20" inside pluginManagement block has via: ["pluginManagement"]', () => {
    const source = [
      `pluginManagement {`,
      `  plugins {`,
      `    kotlin("jvm") version "2.2.20"`,
      `  }`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/root/settings.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.jetbrains.kotlin.jvm");
    expect(occurrence.currentRaw).toBe("2.2.20");
    expect(occurrence.via).toEqual(["pluginManagement"]);
  });
});

describe("kotlin() shorthand — dependencies block", () => {
  it('basic implementation(kotlin("stdlib", "1.9.0"))', () => {
    const source = [
      `dependencies {`,
      `    implementation(kotlin("stdlib", "1.9.0"))`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.jetbrains.kotlin");
    expect(occurrence.artifact).toBe("kotlin-stdlib");
    expect(occurrence.currentRaw).toBe("1.9.0");
  });

  it('testImplementation(kotlin("test", "1.9.0"))', () => {
    const source = `testImplementation(kotlin("test", "1.9.0"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.jetbrains.kotlin");
    expect(occurrence.artifact).toBe("kotlin-test");
    expect(occurrence.currentRaw).toBe("1.9.0");
  });

  it('hyphenated name: implementation(kotlin("stdlib-jdk8", "1.9.0")) produces kotlin-stdlib-jdk8', () => {
    const source = `implementation(kotlin("stdlib-jdk8", "1.9.0"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.artifact).toBe("kotlin-stdlib-jdk8");
  });

  it('implementation(kotlin("stdlib")) with NO version argument — NOT detected', () => {
    const source = `implementation(kotlin("stdlib"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(0);
  });

  it('implementation(kotlin("stdlib", kotlinVersion)) — identifier version — NOT detected', () => {
    const source = `implementation(kotlin("stdlib", kotlinVersion))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(0);
  });

  it("mixed file with kotlin() shorthand and regular GAV string — both detected", () => {
    const source = [
      `dependencies {`,
      `    implementation(kotlin("stdlib", "1.9.0"))`,
      `    implementation("com.example:library:2.0.0")`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(2);
    const kotlinOccurrence = occurrences.find(
      (occurrence) => occurrence.group === "org.jetbrains.kotlin",
    );
    const regularOccurrence = occurrences.find(
      (occurrence) => occurrence.group === "com.example",
    );
    expect(kotlinOccurrence).toBeDefined();
    expect(kotlinOccurrence!.artifact).toBe("kotlin-stdlib");
    expect(regularOccurrence).toBeDefined();
    expect(regularOccurrence!.artifact).toBe("library");
  });

  it('implementation(kotlin("reflect")) with NO version — NOT detected', () => {
    const source = `implementation(kotlin("reflect"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(0);
  });

  it('implementation(kotlin("stdlib-jdk8")) with NO version — NOT detected', () => {
    const source = `implementation(kotlin("stdlib-jdk8"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(0);
  });
});

describe("platform() wrapper", () => {
  it('basic implementation(platform("g:a:v")) is detected as regular GAV', () => {
    const source = `implementation(platform("com.squareup.okhttp3:okhttp-bom:5.2.1"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.squareup.okhttp3");
    expect(occurrence.artifact).toBe("okhttp-bom");
    expect(occurrence.currentRaw).toBe("5.2.1");
    expect(occurrence.dependencyKey).toBe("com.squareup.okhttp3:okhttp-bom");
  });

  it("byte offsets within platform() string are correct", () => {
    const source = `implementation(platform("com.example:my-bom:1.0.0"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(sliceBytes(source, occurrences[0]!.byteStart, occurrences[0]!.byteEnd)).toBe(
      "1.0.0",
    );
  });

  it("testImplementation(platform(...)) is detected", () => {
    const source = `testImplementation(platform("org.junit:junit-bom:5.10.0"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.artifact).toBe("junit-bom");
    expect(occurrences[0]!.currentRaw).toBe("5.10.0");
  });

  it("platform() with 2-part GAV (no version) — NOT detected", () => {
    const source = `implementation(platform("com.example:my-bom"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(0);
  });

  it('enforcedPlatform("g:a:v") is detected the same as platform()', () => {
    const source = `implementation(enforcedPlatform("com.squareup.okhttp3:okhttp-bom:5.2.1"))`;
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.group).toBe("com.squareup.okhttp3");
    expect(occurrences[0]!.artifact).toBe("okhttp-bom");
    expect(occurrences[0]!.currentRaw).toBe("5.2.1");
  });

  it("mixed: platform() and regular GAV in same file — both detected", () => {
    const source = [
      `dependencies {`,
      `    implementation(platform("com.squareup.okhttp3:okhttp-bom:5.2.1"))`,
      `    implementation("com.example:library:2.0.0")`,
      `}`,
    ].join("\n");
    const occurrences = locateKotlin("/x/build.gradle.kts", source);
    expect(occurrences).toHaveLength(2);
    expect(
      occurrences.find((occurrence) => occurrence.artifact === "okhttp-bom"),
    ).toBeDefined();
    expect(
      occurrences.find((occurrence) => occurrence.artifact === "library"),
    ).toBeDefined();
  });
});
