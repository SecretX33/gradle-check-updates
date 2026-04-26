import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenize";

describe("tokenize", () => {
  it("splits numeric and qualifier parts", () => {
    expect(tokenize("1.2.3")).toEqual([
      { kind: "num", value: 1 },
      { kind: "num", value: 2 },
      { kind: "num", value: 3 },
    ]);
  });
  it("treats `-` `.` `_` `+` as separators", () => {
    expect(tokenize("1-2.3_4+5").map((t) => t.value)).toEqual([1, 2, 3, 4, 5]);
  });
  it("separates digits from letters at boundaries", () => {
    expect(tokenize("1a2").map((t) => t.value)).toEqual([1, "a", 2]);
  });
  it("normalizes qualifier to lowercase", () => {
    const t = tokenize("1.0-RC1");
    expect(t[2]).toEqual({ kind: "qual", value: "rc" });
    expect(t[3]).toEqual({ kind: "num", value: 1 });
  });

  // Edge cases
  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
  it("handles pure qualifier like SNAPSHOT", () => {
    expect(tokenize("SNAPSHOT")).toEqual([{ kind: "qual", value: "snapshot" }]);
  });
  it("handles multiple consecutive separators", () => {
    expect(tokenize("1..2")).toEqual([
      { kind: "num", value: 1 },
      { kind: "num", value: 2 },
    ]);
  });

  describe("real-world version formats", () => {
    it("parses dot-separated qualifier: 6.6.41.Final", () => {
      expect(tokenize("6.6.41.Final")).toEqual([
        { kind: "num", value: 6 },
        { kind: "num", value: 6 },
        { kind: "num", value: 41 },
        { kind: "qual", value: "final" },
      ]);
    });

    it("parses classifier with dash: 33.5.0-jre", () => {
      expect(tokenize("33.5.0-jre")).toEqual([
        { kind: "num", value: 33 },
        { kind: "num", value: 5 },
        { kind: "num", value: 0 },
        { kind: "qual", value: "jre" },
      ]);
    });

    it("parses prerelease with dash: 2.23.0-alpha", () => {
      expect(tokenize("2.23.0-alpha")).toEqual([
        { kind: "num", value: 2 },
        { kind: "num", value: 23 },
        { kind: "num", value: 0 },
        { kind: "qual", value: "alpha" },
      ]);
    });

    it("parses four-part version: 2.2.1.1", () => {
      expect(tokenize("2.2.1.1")).toEqual([
        { kind: "num", value: 2 },
        { kind: "num", value: 2 },
        { kind: "num", value: 1 },
        { kind: "num", value: 1 },
      ]);
    });

    it("parses two-part version: 5.6", () => {
      expect(tokenize("5.6")).toEqual([
        { kind: "num", value: 5 },
        { kind: "num", value: 6 },
      ]);
    });

    it("parses two-part version: 8.1", () => {
      expect(tokenize("8.1")).toEqual([
        { kind: "num", value: 8 },
        { kind: "num", value: 1 },
      ]);
    });
  });
});
