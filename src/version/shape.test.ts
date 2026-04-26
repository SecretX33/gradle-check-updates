import { describe, it, expect } from "vitest";
import { detectShape, isStable, isPrerelease } from "./shape";

describe("detectShape", () => {
  const cases: [string, ReturnType<typeof detectShape>][] = [
    ["1.2.3", "exact"],
    ["1.0", "exact"],
    ["1.3.0-beta3", "prerelease"],
    ["1.0-rc1", "prerelease"],
    ["1.0-M2", "prerelease"],
    ["1.0-SNAPSHOT", "snapshot"],
    ["1.+", "prefix"],
    ["1.3.+", "prefix"],
    ["+", "prefix"],
    ["latest.release", "latestQualifier"],
    ["latest.integration", "latestQualifier"],
    ["1.7.15!!", "strictlyShorthand"],
    ["[1.7,1.8)!!1.7.25", "strictlyPreferShort"],
    ["[1.0, 2.0)", "mavenRange"],
    ["(1.2, 1.5]", "mavenRange"],
    ["[1.0,)", "mavenRange"],
    // Extra edge cases
    ["1.0-dev", "prerelease"],
    ["1.0-alpha", "prerelease"],
    ["1.0-FINAL", "exact"],
    ["1.0-GA", "exact"],
    ["LATEST.release", "latestQualifier"],
    ["[1.0,2.0]", "mavenRange"],
    ["(,1.0]", "mavenRange"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => expect(detectShape(input)).toBe(expected));
  }
});

describe("isStable / isPrerelease", () => {
  it("classifies stable", () => {
    expect(isStable("1.2.3")).toBe(true);
    expect(isStable("1.0-final")).toBe(true);
  });
  it("classifies prerelease", () => {
    expect(isPrerelease("1.0-rc1")).toBe(true);
    expect(isPrerelease("1.0-M2")).toBe(true);
  });
  it("snapshot is not stable", () => {
    expect(isStable("1.0-SNAPSHOT")).toBe(false);
  });
  it("snapshot is not prerelease", () => {
    expect(isPrerelease("1.0-SNAPSHOT")).toBe(false);
  });
});
