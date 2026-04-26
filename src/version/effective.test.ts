import { describe, it, expect } from "vitest";
import { effectiveVersion, matchesPrefix, inMavenRange } from "./effective";

describe("effectiveVersion", () => {
  // --- Specified tests ---

  it("exact returns literal", () => {
    expect(effectiveVersion({ shape: "exact", raw: "1.2.3" }, [])).toBe("1.2.3");
  });

  it("prefix returns highest matching prefix", () => {
    expect(
      effectiveVersion({ shape: "prefix", raw: "1.3.+" }, [
        "1.2.0",
        "1.3.5",
        "1.3.7",
        "1.4.0",
      ]),
    ).toBe("1.3.7");
  });

  it("strictlyShorthand strips !!", () => {
    expect(effectiveVersion({ shape: "strictlyShorthand", raw: "1.7.15!!" }, [])).toBe(
      "1.7.15",
    );
  });

  it("strictlyPreferShort returns prefer half", () => {
    expect(
      effectiveVersion({ shape: "strictlyPreferShort", raw: "[1.7,1.8)!!1.7.25" }, []),
    ).toBe("1.7.25");
  });

  it("mavenRange returns highest in range", () => {
    expect(
      effectiveVersion({ shape: "mavenRange", raw: "[1.0,2.0)" }, [
        "1.0",
        "1.5",
        "2.0",
        "2.1",
      ]),
    ).toBe("1.5");
  });

  // --- Additional edge cases ---

  it("prerelease shape returns literal", () => {
    expect(effectiveVersion({ shape: "prerelease", raw: "1.0-rc1" }, [])).toBe("1.0-rc1");
  });

  it("snapshot shape returns literal", () => {
    expect(effectiveVersion({ shape: "snapshot", raw: "1.0-SNAPSHOT" }, [])).toBe(
      "1.0-SNAPSHOT",
    );
  });

  it("prefix with no matching candidates falls back to raw", () => {
    expect(effectiveVersion({ shape: "prefix", raw: "1.3.+" }, ["2.0.0"])).toBe("1.3.+");
  });

  it("wildcard prefix '+' returns highest of all candidates", () => {
    expect(effectiveVersion({ shape: "prefix", raw: "+" }, ["1.0", "2.0", "0.5"])).toBe(
      "2.0",
    );
  });

  it("mavenRange open-ended '[1.0,)' matches all versions >= 1.0", () => {
    expect(
      effectiveVersion({ shape: "mavenRange", raw: "[1.0,)" }, ["0.9", "1.0", "2.5"]),
    ).toBe("2.5");
  });

  it("does not mutate the candidates array", () => {
    const candidates = ["1.3.5", "1.3.7", "1.2.0"];
    const original = [...candidates];
    effectiveVersion({ shape: "prefix", raw: "1.3.+" }, candidates);
    expect(candidates).toEqual(original);
  });
});

describe("matchesPrefix", () => {
  it("'+' matches everything", () => {
    expect(matchesPrefix("+", "1.2.3")).toBe(true);
    expect(matchesPrefix("+", "0.0.1")).toBe(true);
  });

  it("matches exact stem", () => {
    expect(matchesPrefix("1.3.+", "1.3")).toBe(true);
  });

  it("matches versions under stem", () => {
    expect(matchesPrefix("1.3.+", "1.3.5")).toBe(true);
    expect(matchesPrefix("1.3.+", "1.3.99")).toBe(true);
  });

  it("does not match versions with longer stem prefix (off-by-one guard)", () => {
    // "1.30.0".startsWith("1.3") is true, but it must not match "1.3.+"
    expect(matchesPrefix("1.3.+", "1.30.0")).toBe(false);
  });

  it("does not match sibling versions", () => {
    expect(matchesPrefix("1.3.+", "1.4.0")).toBe(false);
    expect(matchesPrefix("1.3.+", "1.2.0")).toBe(false);
  });

  it("does not match parent version", () => {
    expect(matchesPrefix("1.3.+", "1")).toBe(false);
  });
});

describe("inMavenRange", () => {
  it("inclusive lower bound [1.0,2.0) includes 1.0", () => {
    expect(inMavenRange("[1.0,2.0)", "1.0")).toBe(true);
  });

  it("exclusive lower bound (1.0,2.0) excludes 1.0", () => {
    expect(inMavenRange("(1.0,2.0)", "1.0")).toBe(false);
  });

  it("exclusive upper bound [1.0,2.0) excludes 2.0", () => {
    expect(inMavenRange("[1.0,2.0)", "2.0")).toBe(false);
  });

  it("inclusive upper bound [1.0,2.0] includes 2.0", () => {
    expect(inMavenRange("[1.0,2.0]", "2.0")).toBe(true);
  });

  it("open-ended upper bound [1.0,) includes large versions", () => {
    expect(inMavenRange("[1.0,)", "99.0")).toBe(true);
    expect(inMavenRange("[1.0,)", "0.9")).toBe(false);
  });

  it("open-ended lower bound (,2.0) includes versions below 2.0", () => {
    expect(inMavenRange("(,2.0)", "1.0")).toBe(true);
    expect(inMavenRange("(,2.0)", "2.0")).toBe(false);
  });

  it("returns false for invalid range string", () => {
    expect(inMavenRange("not-a-range", "1.0")).toBe(false);
  });
});
