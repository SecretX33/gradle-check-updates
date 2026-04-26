import { describe, it, expect } from "vitest";
import { locateGroovy } from "./locate.js";

describe("locateGroovy", () => {
  // ── Spec tests ──────────────────────────────────────────────────────────────

  it("finds exact GAV in single-quoted string", () => {
    const text = `dependencies {\n  implementation 'org.foo:bar:1.0.0'\n}\n`;
    const occurrences = locateGroovy("/x/build.gradle", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.group).toBe("org.foo");
    expect(occurrence.artifact).toBe("bar");
    expect(occurrence.currentRaw).toBe("1.0.0");
    expect(text.slice(occurrence.byteStart, occurrence.byteEnd)).toBe("1.0.0");
    expect(occurrence.shape).toBe("exact");
  });

  it("finds prerelease shape", () => {
    const occurrences = locateGroovy("/x", `compile 'a:b:1.3.0-beta3'`);
    expect(occurrences[0]!.shape).toBe("prerelease");
  });

  it("finds plugins block: id ... version ...", () => {
    const occurrences = locateGroovy(
      "/x",
      `plugins {\n  id 'org.springframework.boot' version '3.2.0'\n}`,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.group).toBe("org.springframework.boot");
    expect(occurrences[0]!.artifact).toBe("org.springframework.boot.gradle.plugin");
    expect(occurrences[0]!.currentRaw).toBe("3.2.0");
  });

  it("ignores adjacent comments", () => {
    const text = `implementation 'a:b:1.0' // pinned`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences[0]!.byteEnd).toBe(text.indexOf("1.0") + 3);
  });

  it("emits pending-ref marker for $-interpolated version", () => {
    const text = `implementation "a:b:$kotlinVersion"`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences[0]!.via?.[0]).toMatch(/^__pending_ref__:kotlinVersion$/);
  });

  // ── Extra tests ──────────────────────────────────────────────────────────────

  it("finds exact GAV in double-quoted string", () => {
    const occurrences = locateGroovy("/x", `implementation "a:b:1.5.0"`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.currentRaw).toBe("1.5.0");
    expect(occurrences[0]!.shape).toBe("exact");
  });

  it("finds GAV with parentheses syntax", () => {
    const occurrences = locateGroovy("/x", `implementation('a:b:2.0.0')`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.currentRaw).toBe("2.0.0");
  });

  it("finds snapshot shape", () => {
    const occurrences = locateGroovy("/x", `api 'a:b:1.0-SNAPSHOT'`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("snapshot");
  });

  it("skips 2-part GAV (no version segment)", () => {
    const occurrences = locateGroovy("/x", `implementation 'a:b'`);
    expect(occurrences).toHaveLength(0);
  });

  it("reports maven-range shape but still emits occurrence", () => {
    const occurrences = locateGroovy("/x", `implementation 'org.foo:bar:[1.0,2.0)'`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("mavenRange");
  });

  it("finds version in api configuration", () => {
    const occurrences = locateGroovy("/x", `api 'com.example:lib:3.0.0'`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.group).toBe("com.example");
    expect(occurrences[0]!.artifact).toBe("lib");
    expect(occurrences[0]!.currentRaw).toBe("3.0.0");
  });

  it("finds version in testImplementation configuration", () => {
    const occurrences = locateGroovy("/x", `testImplementation 'junit:junit:4.13.2'`);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.currentRaw).toBe("4.13.2");
  });

  it("sets dependencyKey to group:artifact", () => {
    const occurrences = locateGroovy(
      "/x",
      `implementation 'com.google.guava:guava:32.0.0'`,
    );
    expect(occurrences[0]!.dependencyKey).toBe("com.google.guava:guava");
  });

  it("sets fileType to groovy-dsl", () => {
    const occurrences = locateGroovy("/x/build.gradle", `implementation 'a:b:1.0.0'`);
    expect(occurrences[0]!.fileType).toBe("groovy-dsl");
  });

  it("byte offsets are correct for exact version", () => {
    // "implementation 'a:b:" = 20 chars, version starts at char 20
    const text = `implementation 'a:b:1.2.3'`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences[0]!.byteStart).toBe(20);
    expect(occurrences[0]!.byteEnd).toBe(25);
  });

  it("plugins block with double-quoted id and version", () => {
    const occurrences = locateGroovy(
      "/x",
      `plugins {\n  id "com.example.plugin" version "2.0.0"\n}`,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.group).toBe("com.example.plugin");
    expect(occurrences[0]!.artifact).toBe("com.example.plugin.gradle.plugin");
    expect(occurrences[0]!.currentRaw).toBe("2.0.0");
  });

  it("handles multiple deps in same block", () => {
    const text = [
      "dependencies {",
      "  implementation 'a:b:1.0.0'",
      "  api 'c:d:2.0.0'",
      "}",
    ].join("\n");
    const occurrences = locateGroovy("/x", text);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.currentRaw).toBe("1.0.0");
    expect(occurrences[1]!.currentRaw).toBe("2.0.0");
  });

  it("pending-ref occurrence has no byteStart/byteEnd pointing into version literal (byteStart equals bodyByteStart)", () => {
    const text = `implementation "a:b:$myVar"`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences).toHaveLength(1);
    // group and artifact should still be extracted
    expect(occurrences[0]!.group).toBe("a");
    expect(occurrences[0]!.artifact).toBe("b");
    // via marker should reference the variable
    expect(occurrences[0]!.via).toBeDefined();
    expect(occurrences[0]!.via![0]).toBe("__pending_ref__:myVar");
  });

  it("prefix shape is detected", () => {
    const occurrences = locateGroovy("/x", `implementation 'a:b:1.3.+'`);
    expect(occurrences[0]!.shape).toBe("prefix");
  });

  // ── Rich version block tests ─────────────────────────────────────────────────

  it("emits one Occurrence per rich-block call sharing dependencyKey", () => {
    const text = `
implementation('org.foo:bar') {
  version {
    strictly '1.7.15'
    prefer '1.7.15'
  }
}`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences.map((occ) => occ.shape)).toEqual(["richStrictly", "richPrefer"]);
    expect(new Set(occurrences.map((occ) => occ.dependencyKey))).toHaveProperty(
      "size",
      1,
    );
  });

  it("rich reject is emitted but never auto-modified", () => {
    const occurrences = locateGroovy(
      "/x",
      `
implementation('a:b') { version { require '1.0'; reject '2.0' } }`,
    );
    expect(occurrences.find((occ) => occ.shape === "richReject")).toBeDefined();
  });

  it("require is detected inside rich version block", () => {
    const occurrences = locateGroovy(
      "/x",
      `implementation('a:b') { version { require '1.5' } }`,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("richRequire");
  });

  it("dependencyKey includes @blockId derived from byte offset", () => {
    const occurrences = locateGroovy(
      "/x",
      `implementation('a:b') { version { require '1.5' } }`,
    );
    expect(occurrences[0]!.dependencyKey).toMatch(/^a:b@\d+$/);
  });

  it("byteStart/byteEnd of rich occurrence points at version string value not keyword", () => {
    const text = `implementation('a:b') { version { strictly '1.2.3' } }`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.currentRaw).toBe("1.2.3");
    // byteStart/byteEnd must span the version literal content, not the keyword
    expect(text.slice(occurrence.byteStart, occurrence.byteEnd)).toBe("1.2.3");
  });

  it("all rich occurrences share group and artifact from the outer dependency", () => {
    const text = `
implementation('com.example:mylib') {
  version {
    strictly '1.0.0'
    prefer '1.0.0'
  }
}`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences).toHaveLength(2);
    for (const occurrence of occurrences) {
      expect(occurrence.group).toBe("com.example");
      expect(occurrence.artifact).toBe("mylib");
    }
  });

  // ── ext / extra property tests ───────────────────────────────────────────────

  it("locates ext.varName = '1.0' definitions", () => {
    const occurrences = locateGroovy("/x", `ext.kotlinVersion = '1.9.0'`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({
        dependencyKey: "prop:kotlinVersion",
        currentRaw: "1.9.0",
      }),
    );
  });

  it("locates ext { x = '1.0'; y = '2.0' }", () => {
    const occurrences = locateGroovy(
      "/x",
      `ext { kotlinVersion = '1.9.0'\nspringVersion = '3.0' }`,
    );
    expect(occurrences.map((occ) => occ.dependencyKey)).toEqual(
      expect.arrayContaining(["prop:kotlinVersion", "prop:springVersion"]),
    );
  });

  it("locates project.ext.varName = '1.0' definitions", () => {
    const occurrences = locateGroovy("/x", `project.ext.varName = '1.0.0'`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({ dependencyKey: "prop:varName", currentRaw: "1.0.0" }),
    );
  });

  it('locates extra["varName"] = "1.0" definitions', () => {
    const occurrences = locateGroovy("/x", `extra["varName"] = "1.0.0"`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({ dependencyKey: "prop:varName", currentRaw: "1.0.0" }),
    );
  });

  it("ext property occurrence has group and artifact as empty strings", () => {
    const occurrences = locateGroovy("/x", `ext.someVersion = '2.5.1'`);
    expect(occurrences[0]!.group).toBe("");
    expect(occurrences[0]!.artifact).toBe("");
  });

  it("ext property occurrence has fileType groovy-dsl", () => {
    const occurrences = locateGroovy("/x", `ext.someVersion = '2.5.1'`);
    expect(occurrences[0]!.fileType).toBe("groovy-dsl");
  });

  it("does not emit ext property for non-version value", () => {
    const occurrences = locateGroovy("/x", `ext.description = 'hello'`);
    expect(occurrences).toHaveLength(0);
  });

  it("ext property byte range points at value string, not key", () => {
    // "ext.kotlinVersion = '" = 20 chars, value starts at char 20
    const text = `ext.kotlinVersion = '1.9.0'`;
    const occurrences = locateGroovy("/x", text);
    expect(occurrences).toHaveLength(1);
    const occurrence = occurrences[0]!;
    expect(occurrence.currentRaw).toBe("1.9.0");
    expect(text.slice(occurrence.byteStart, occurrence.byteEnd)).toBe("1.9.0");
  });

  it("ext block emits correct shape for each property", () => {
    const occurrences = locateGroovy(
      "/x",
      `ext { stableVersion = '1.0.0'\npreVersion = '2.0.0-beta1' }`,
    );
    expect(
      occurrences.find((occ) => occ.dependencyKey === "prop:stableVersion")?.shape,
    ).toBe("exact");
    expect(
      occurrences.find((occ) => occ.dependencyKey === "prop:preVersion")?.shape,
    ).toBe("prerelease");
  });

  it("does not emit ext property for latestQualifier value", () => {
    const occurrences = locateGroovy("/x", `ext.myVersion = 'latest.release'`);
    expect(occurrences).toHaveLength(0);
  });

  it("extra property with single-quoted key emits correct dependencyKey", () => {
    const occurrences = locateGroovy("/x", `extra['myLib'] = '3.1.4'`);
    expect(occurrences).toContainEqual(
      expect.objectContaining({ dependencyKey: "prop:myLib", currentRaw: "3.1.4" }),
    );
  });
});
