// src/formats/version-catalog/locate.test.ts
import { describe, it, expect } from "vitest";
import { locateVersionCatalog } from "./locate.js";

function sliceBytes(text: string, start: number, end: number): string {
  return Buffer.from(text, "utf8").subarray(start, end).toString("utf8");
}

describe("locateVersionCatalog", () => {
  // ── [versions] table ────────────────────────────────────────────────────────

  it("[versions] simple string emits catalog-version occurrence", () => {
    const text = `[versions]\nkotlin = "1.9.0"\n`;
    const occurrences = locateVersionCatalog("/catalog/libs.versions.toml", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.dependencyKey).toBe("catalog-version:kotlin");
    expect(occurrence.currentRaw).toBe("1.9.0");
    expect(occurrence.shape).toBe("exact");
    expect(occurrence.group).toBe("");
    expect(occurrence.artifact).toBe("");
    expect(occurrence.fileType).toBe("version-catalog");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.9.0");
  });

  it("[versions] byte offsets point inside quotes, not at quotes", () => {
    const text = `[versions]\nkotlin = "1.9.0"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences[0]!.byteStart).toBeGreaterThan(0);
    // The byte at byteStart should be '1', not '"'
    expect(sliceBytes(text, occurrences[0]!.byteStart, occurrences[0]!.byteEnd)).toBe(
      "1.9.0",
    );
  });

  it("[versions] snapshot shape detected", () => {
    const text = `[versions]\nmylib = "1.0-SNAPSHOT"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences[0]!.shape).toBe("snapshot");
  });

  it("[versions] prefix shape detected", () => {
    const text = `[versions]\nmylib = "1.3.+"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences[0]!.shape).toBe("prefix");
  });

  it("[versions] maven range shape detected", () => {
    const text = `[versions]\nmylib = "[1.0,2.0)"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences[0]!.shape).toBe("mavenRange");
  });

  it("[versions] multiple entries emitted", () => {
    const text = ["[versions]", `kotlin = "1.9.0"`, `compose = "1.5.0"`, ""].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((occ) => occ.dependencyKey)).toContain(
      "catalog-version:kotlin",
    );
    expect(occurrences.map((occ) => occ.dependencyKey)).toContain(
      "catalog-version:compose",
    );
  });

  it("[versions] comments and blank lines are skipped", () => {
    const text = ["[versions]", "# This is a comment", "", `kotlin = "1.9.0"`].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.currentRaw).toBe("1.9.0");
  });

  // ── [libraries] table ───────────────────────────────────────────────────────

  it("[libraries] compact string form emits exact occurrence", () => {
    const text = `[libraries]\nfoo = "com.example:mylib:1.0.0"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.example");
    expect(occurrence.artifact).toBe("mylib");
    expect(occurrence.dependencyKey).toBe("com.example:mylib");
    expect(occurrence.currentRaw).toBe("1.0.0");
    expect(occurrence.shape).toBe("exact");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.0.0");
  });

  it('[libraries] inline table with version = "..." emits occurrence', () => {
    const text = `[libraries]\nfoo = { module = "com.example:mylib", version = "2.0.0" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.example");
    expect(occurrence.artifact).toBe("mylib");
    expect(occurrence.currentRaw).toBe("2.0.0");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("2.0.0");
  });

  it("[libraries] inline table with version.ref emits pending-ref", () => {
    const text = `[libraries]\nfoo = { module = "com.example:mylib", version.ref = "kotlin" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.example");
    expect(occurrence.artifact).toBe("mylib");
    expect(occurrence.via).toEqual(["__pending_ref__:kotlin"]);
    expect(occurrence.currentRaw).toBe("kotlin");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("kotlin");
  });

  it("[libraries] rich table with strictly and prefer emits two richly-shaped occurrences", () => {
    const text = `[libraries]\nfoo = { module = "com.example:mylib", version = { strictly = "1.7.15", prefer = "1.7.25" } }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(2);
    const shapes = occurrences.map((occ) => occ.shape);
    expect(shapes).toContain("richStrictly");
    expect(shapes).toContain("richPrefer");
  });

  it("[libraries] rich table occurrences share dependencyKey with @blockId suffix", () => {
    const text = `[libraries]\nfoo = { module = "com.example:mylib", version = { strictly = "1.7.15", prefer = "1.7.25" } }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.dependencyKey).toBe(occurrences[1]!.dependencyKey);
    expect(occurrences[0]!.dependencyKey).toMatch(/^com\.example:mylib@\d+$/);
  });

  it("[libraries] rich table byte offsets point to version content", () => {
    const text = `[libraries]\nfoo = { module = "com.example:mylib", version = { strictly = "1.7.15", prefer = "1.7.25" } }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    const strictlyOccurrence = occurrences.find((occ) => occ.shape === "richStrictly")!;
    const preferOccurrence = occurrences.find((occ) => occ.shape === "richPrefer")!;
    expect(
      sliceBytes(text, strictlyOccurrence.byteStart, strictlyOccurrence.byteEnd),
    ).toBe("1.7.15");
    expect(sliceBytes(text, preferOccurrence.byteStart, preferOccurrence.byteEnd)).toBe(
      "1.7.25",
    );
  });

  it("[libraries] rich table with reject emits richReject occurrence", () => {
    const text = `[libraries]\nfoo = { module = "g:a", version = { require = "2.0", reject = "1.0" } }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    const shapes = occurrences.map((occ) => occ.shape);
    expect(shapes).toContain("richRequire");
    expect(shapes).toContain("richReject");
  });

  it("[libraries] 2-part compact GAV (no version) emits nothing", () => {
    const text = `[libraries]\nfoo = "com.example:mylib"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(0);
  });

  // ── [plugins] table ─────────────────────────────────────────────────────────

  it("[plugins] with version emits occurrence with gradle.plugin artifact", () => {
    const text = `[plugins]\nkotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "1.9.0" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.jetbrains.kotlin.jvm");
    expect(occurrence.artifact).toBe("org.jetbrains.kotlin.jvm.gradle.plugin");
    expect(occurrence.dependencyKey).toBe(
      "org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin",
    );
    expect(occurrence.currentRaw).toBe("1.9.0");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.9.0");
  });

  it("[plugins] with version.ref emits pending-ref", () => {
    const text = `[plugins]\nkotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.artifact).toBe("org.jetbrains.kotlin.jvm.gradle.plugin");
    expect(occurrence.via).toEqual(["__pending_ref__:kotlin"]);
    expect(occurrence.currentRaw).toBe("kotlin");
  });

  // ── Multi-table file ─────────────────────────────────────────────────────────

  it("full catalog file emits occurrences from all active tables", () => {
    const text = [
      "[versions]",
      `kotlin = "1.9.0"`,
      "",
      "[libraries]",
      `foo = "com.example:mylib:1.0.0"`,
      `bar = { module = "com.example:bar", version.ref = "kotlin" }`,
      "",
      "[plugins]",
      `kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }`,
      "",
    ].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    // versions: 1, libraries: 2 (compact + ref), plugins: 1
    expect(occurrences).toHaveLength(4);
  });

  it("[other-table] entries are ignored", () => {
    const text = [
      "[bundles]",
      `myBundle = ["foo", "bar"]`,
      "",
      "[versions]",
      `kotlin = "1.9.0"`,
    ].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.dependencyKey).toBe("catalog-version:kotlin");
  });

  it("fileType is version-catalog on all occurrences", () => {
    const text = [
      "[versions]",
      `kotlin = "1.9.0"`,
      "[libraries]",
      `foo = "a:b:1.0"`,
    ].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    for (const occurrence of occurrences) {
      expect(occurrence.fileType).toBe("version-catalog");
    }
  });

  // ── Gap 1: group/name library form ──────────────────────────────────────────

  it("[libraries] group+name form emits occurrence", () => {
    const text = `[libraries]\nmy-lib = { group = "com.mycompany", name = "alternate", version = "1.4" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.mycompany");
    expect(occurrence.artifact).toBe("alternate");
    expect(occurrence.dependencyKey).toBe("com.mycompany:alternate");
    expect(occurrence.currentRaw).toBe("1.4");
    expect(occurrence.shape).toBe("exact");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.4");
  });

  it("[libraries] group+name form with version.ref emits pending-ref", () => {
    const text = `[libraries]\nmy-lib = { group = "com.mycompany", name = "alternate", version.ref = "myVersion" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("com.mycompany");
    expect(occurrence.artifact).toBe("alternate");
    expect(occurrence.dependencyKey).toBe("com.mycompany:alternate");
    expect(occurrence.via).toEqual(["__pending_ref__:myVersion"]);
    expect(occurrence.currentRaw).toBe("myVersion");
  });

  it("[libraries] group+name form with rich version emits rich occurrences", () => {
    const text = `[libraries]\nmy-lib = { group = "com.mycompany", name = "alternate", version = { require = "1.4" } }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("richRequire");
    expect(occurrences[0]!.currentRaw).toBe("1.4");
    expect(occurrences[0]!.dependencyKey).toMatch(/^com\.mycompany:alternate@\d+$/);
  });

  it("[libraries] inline table without module or group+name emits nothing", () => {
    const text = `[libraries]\nmy-lib = { someOtherField = "value" }\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(0);
  });

  // ── Gap 2: Plugin compact string form ───────────────────────────────────────

  it("[plugins] compact string 'pluginId:version' emits occurrence", () => {
    const text = `[plugins]\nshort-notation = "some.plugin.id:1.4"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("some.plugin.id");
    expect(occurrence.artifact).toBe("some.plugin.id.gradle.plugin");
    expect(occurrence.dependencyKey).toBe("some.plugin.id:some.plugin.id.gradle.plugin");
    expect(occurrence.currentRaw).toBe("1.4");
    expect(occurrence.shape).toBe("exact");
    expect(sliceBytes(text, occurrence.byteStart, occurrence.byteEnd)).toBe("1.4");
  });

  it("[plugins] compact string byte offsets point precisely to version", () => {
    const text = `[plugins]\nmy-plugin = "com.example.myplugin:2.3.1"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    expect(sliceBytes(text, occurrences[0]!.byteStart, occurrences[0]!.byteEnd)).toBe(
      "2.3.1",
    );
  });

  it("[plugins] compact string without colon emits nothing", () => {
    const text = `[plugins]\nbad-entry = "nocolon"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(0);
  });

  it("[plugins] compact string with snapshot version detects shape", () => {
    const text = `[plugins]\nmy-plugin = "com.example:1.0-SNAPSHOT"\n`;
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("snapshot");
  });

  // ── Gap 3: Dotted top-level key form (known v1 gap) ─────────────────────────

  it("[libraries] dotted top-level key form produces zero occurrences", () => {
    const text = [
      "[libraries]",
      `foo.module = "com.example:mylib"`,
      `foo.version.ref = "kotlin"`,
    ].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(0);
  });

  it("[plugins] dotted top-level key form produces zero occurrences", () => {
    const text = [
      "[plugins]",
      `my-plugin.id = "com.example.plugin"`,
      `my-plugin.version.ref = "pluginVer"`,
    ].join("\n");
    const occurrences = locateVersionCatalog("/f", text);
    expect(occurrences).toHaveLength(0);
  });
});
