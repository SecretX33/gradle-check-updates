import { describe, it, expect } from "vitest";
import { isEligible, renderReplacement } from "./shape-rules.js";
import type { Occurrence } from "../types.js";

function makeOccurrence(shape: Occurrence["shape"], currentRaw: string): Occurrence {
  return {
    group: "org.foo",
    artifact: "bar",
    file: "/project/build.gradle",
    byteStart: 0,
    byteEnd: currentRaw.length,
    fileType: "groovy-dsl",
    currentRaw,
    shape,
    dependencyKey: "org.foo:bar",
  };
}

describe("isEligible", () => {
  it("snapshot → not eligible", () => {
    expect(isEligible(makeOccurrence("snapshot", "1.0.0-SNAPSHOT"))).toBe(false);
  });

  it("latestQualifier → not eligible", () => {
    expect(isEligible(makeOccurrence("latestQualifier", "latest.release"))).toBe(false);
  });

  it("mavenRange → not eligible", () => {
    expect(isEligible(makeOccurrence("mavenRange", "[1.0,2.0)"))).toBe(false);
  });

  it("richReject → not eligible", () => {
    expect(isEligible(makeOccurrence("richReject", "1.0.0"))).toBe(false);
  });

  it("richStrictly with range [1.0,2.0) → not eligible", () => {
    expect(isEligible(makeOccurrence("richStrictly", "[1.0,2.0)"))).toBe(false);
  });

  it("richStrictly with opening parenthesis range → not eligible", () => {
    expect(isEligible(makeOccurrence("richStrictly", "(1.0,2.0]"))).toBe(false);
  });

  it("richStrictly with plain version 1.7.15 → eligible", () => {
    expect(isEligible(makeOccurrence("richStrictly", "1.7.15"))).toBe(true);
  });

  it("exact → eligible", () => {
    expect(isEligible(makeOccurrence("exact", "1.2.3"))).toBe(true);
  });

  it("prerelease → eligible", () => {
    expect(isEligible(makeOccurrence("prerelease", "1.2.3-alpha.1"))).toBe(true);
  });

  it("prefix → eligible", () => {
    expect(isEligible(makeOccurrence("prefix", "1.3.+"))).toBe(true);
  });

  it("strictlyShorthand → eligible", () => {
    expect(isEligible(makeOccurrence("strictlyShorthand", "1.7.25!!1.7.25"))).toBe(true);
  });

  it("strictlyPreferShort → eligible", () => {
    expect(isEligible(makeOccurrence("strictlyPreferShort", "[1.7,1.8)!!1.7.25"))).toBe(
      true,
    );
  });

  it("richRequire → eligible", () => {
    expect(isEligible(makeOccurrence("richRequire", "1.2.3"))).toBe(true);
  });

  it("richPrefer → eligible", () => {
    expect(isEligible(makeOccurrence("richPrefer", "1.2.3"))).toBe(true);
  });
});

describe("renderReplacement", () => {
  it("exact → winner as-is", () => {
    expect(renderReplacement(makeOccurrence("exact", "1.2.3"), "2.0.0")).toBe("2.0.0");
  });

  it("prerelease → winner as-is", () => {
    expect(
      renderReplacement(makeOccurrence("prerelease", "1.2.3-alpha.1"), "2.0.0-beta.1"),
    ).toBe("2.0.0-beta.1");
  });

  it("richRequire → winner as-is", () => {
    expect(renderReplacement(makeOccurrence("richRequire", "1.2.3"), "2.0.0")).toBe(
      "2.0.0",
    );
  });

  it("richPrefer → winner as-is", () => {
    expect(renderReplacement(makeOccurrence("richPrefer", "1.2.3"), "2.0.0")).toBe(
      "2.0.0",
    );
  });

  it("richStrictly (plain) → winner as-is", () => {
    expect(renderReplacement(makeOccurrence("richStrictly", "1.7.15"), "2.0.1")).toBe(
      "2.0.1",
    );
  });

  it("prefix 1.3.+ with winner 1.5.2 → 1.5.+", () => {
    expect(renderReplacement(makeOccurrence("prefix", "1.3.+"), "1.5.2")).toBe("1.5.+");
  });

  it("prefix 1.+ (depth 1) with winner 2.3.0 → 2.+", () => {
    expect(renderReplacement(makeOccurrence("prefix", "1.+"), "2.3.0")).toBe("2.+");
  });

  it("prefix 1.2.3.+ (depth 3) with winner 1.2.4.5 → 1.2.4.+", () => {
    expect(renderReplacement(makeOccurrence("prefix", "1.2.3.+"), "1.2.4.5")).toBe(
      "1.2.4.+",
    );
  });

  it("strictlyShorthand 1.7.25!!1.7.25 with winner 2.0.1 → 2.0.1!!2.0.1", () => {
    expect(
      renderReplacement(makeOccurrence("strictlyShorthand", "1.7.25!!1.7.25"), "2.0.1"),
    ).toBe("2.0.1!!2.0.1");
  });

  it("strictlyPreferShort [1.7,1.8)!!1.7.25 with winner 2.0.1 → [2.0,2.1)!!2.0.1", () => {
    expect(
      renderReplacement(
        makeOccurrence("strictlyPreferShort", "[1.7,1.8)!!1.7.25"),
        "2.0.1",
      ),
    ).toBe("[2.0,2.1)!!2.0.1");
  });

  it("strictlyPreferShort winner with minor 9 → increments to 10 correctly", () => {
    expect(
      renderReplacement(
        makeOccurrence("strictlyPreferShort", "[1.7,1.8)!!1.7.25"),
        "1.9.5",
      ),
    ).toBe("[1.9,1.10)!!1.9.5");
  });

  it("strictlyPreferShort 3-segment bounds preserve depth", () => {
    expect(
      renderReplacement(
        makeOccurrence("strictlyPreferShort", "[1.7.0,1.8.0)!!1.7.25"),
        "2.0.1",
      ),
    ).toBe("[2.0.1,2.0.2)!!2.0.1");
  });

  it("strictlyPreferShort preserves non-default bracket types", () => {
    expect(
      renderReplacement(
        makeOccurrence("strictlyPreferShort", "(1.7,1.8]!!1.7.25"),
        "2.0.1",
      ),
    ).toBe("(2.0,2.1]!!2.0.1");
  });

  it("strictlyPreferShort malformed currentRaw (no !!) → returns winner as-is", () => {
    expect(
      renderReplacement(makeOccurrence("strictlyPreferShort", "1.7.25"), "2.0.1"),
    ).toBe("2.0.1");
  });

  it("strictlyPreferShort winner shorter than bound depth → pads with 0", () => {
    expect(
      renderReplacement(
        makeOccurrence("strictlyPreferShort", "[1.7.0,1.8.0)!!1.7.25"),
        "2.0",
      ),
    ).toBe("[2.0.0,2.0.1)!!2.0");
  });
});
