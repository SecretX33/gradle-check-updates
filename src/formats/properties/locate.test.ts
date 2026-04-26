// src/formats/properties/locate.test.ts
import { describe, it, expect } from "vitest";
import { locateProperties } from "./locate";

describe("locateProperties", () => {
  it("emits a candidate per version-shaped value", () => {
    const text = `
# header
kotlinVersion=1.9.0
springBootVersion = 3.2.0
unrelated=hello
empty=
`;
    const occurrences = locateProperties("/x/gradle.properties", text);
    expect(
      occurrences.map((occurrence) => ({
        key: occurrence.dependencyKey,
        raw: occurrence.currentRaw,
      })),
    ).toEqual([
      { key: "prop:kotlinVersion", raw: "1.9.0" },
      { key: "prop:springBootVersion", raw: "3.2.0" },
    ]);
    // Byte ranges must point exactly at the value.
    const first = occurrences[0]!;
    expect(text.slice(first.byteStart, first.byteEnd)).toBe("1.9.0");
  });

  it("handles CRLF and tabs without bleeding into surrounding bytes", () => {
    const text = "a=1.0\r\nb=2.0\r\n";
    const occurrences = locateProperties("/x/gradle.properties", text);
    expect(occurrences).toHaveLength(2);
    expect(text.slice(occurrences[0]!.byteStart, occurrences[0]!.byteEnd)).toBe("1.0");
    expect(text.slice(occurrences[1]!.byteStart, occurrences[1]!.byteEnd)).toBe("2.0");
  });

  it("ignores comments", () => {
    expect(locateProperties("/x", "# foo=1.0\n! bar=2.0\n")).toEqual([]);
  });

  it("handles colon separator", () => {
    const text = "myKey: 1.0.0\n";
    const occurrences = locateProperties("/x/gradle.properties", text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.dependencyKey).toBe("prop:myKey");
    expect(occurrences[0]!.currentRaw).toBe("1.0.0");
    expect(text.slice(occurrences[0]!.byteStart, occurrences[0]!.byteEnd)).toBe("1.0.0");
  });

  it("emits snapshot-shaped occurrences", () => {
    const text = "kotlinVersion=1.0-SNAPSHOT\n";
    const occurrences = locateProperties("/x/gradle.properties", text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.shape).toBe("snapshot");
    expect(occurrences[0]!.currentRaw).toBe("1.0-SNAPSHOT");
  });

  it("skips latestQualifier values", () => {
    const text = "myVersion=latest.release\n";
    const occurrences = locateProperties("/x/gradle.properties", text);
    expect(occurrences).toHaveLength(0);
  });

  it("handles multi-line with mixed line endings without shifting subsequent offsets", () => {
    // LF line then CRLF line then LF line
    const text = "a=1.0.0\nb=2.0.0\r\nc=3.0.0\n";
    const occurrences = locateProperties("/x/gradle.properties", text);
    expect(occurrences).toHaveLength(3);
    expect(text.slice(occurrences[0]!.byteStart, occurrences[0]!.byteEnd)).toBe("1.0.0");
    expect(text.slice(occurrences[1]!.byteStart, occurrences[1]!.byteEnd)).toBe("2.0.0");
    expect(text.slice(occurrences[2]!.byteStart, occurrences[2]!.byteEnd)).toBe("3.0.0");
  });
});
