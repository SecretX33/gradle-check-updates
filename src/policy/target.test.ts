import { describe, it, expect } from "vitest";
import { targetFilter } from "./target.js";

describe("targetFilter", () => {
  it("candidate < current → always filtered (never-downgrade)", () => {
    expect(targetFilter("2.0.0", ["1.0.0", "1.9.9"], undefined)).toEqual([]);
  });

  it("candidate == current → kept (already at this version, no downgrade)", () => {
    expect(targetFilter("2.0.0", ["2.0.0"], undefined)).toEqual(["2.0.0"]);
  });

  it("no target → only never-downgrade applies, upward candidates pass", () => {
    expect(
      targetFilter("1.0.0", ["0.9.0", "1.0.0", "1.1.0", "2.0.0"], undefined),
    ).toEqual(["1.0.0", "1.1.0", "2.0.0"]);
  });

  it("target: patch → only patches of current minor pass", () => {
    expect(
      targetFilter("1.2.3", ["1.2.4", "1.3.0", "2.0.0", "1.2.3", "1.2.2"], "patch"),
    ).toEqual(["1.2.4", "1.2.3"]);
  });

  it("target: minor → patches and minors pass, major blocked", () => {
    expect(targetFilter("1.2.3", ["1.2.4", "1.3.0", "2.0.0", "1.2.3"], "minor")).toEqual([
      "1.2.4",
      "1.3.0",
      "1.2.3",
    ]);
  });

  it("target: major → all upward candidates pass", () => {
    expect(
      targetFilter("1.2.3", ["1.2.4", "1.3.0", "2.0.0", "3.1.0", "1.2.3"], "major"),
    ).toEqual(["1.2.4", "1.3.0", "2.0.0", "3.1.0", "1.2.3"]);
  });

  it("1.2.3 under patch target: 1.2.4 passes, 1.3.0 blocked, 2.0.0 blocked", () => {
    const result = targetFilter("1.2.3", ["1.2.4", "1.3.0", "2.0.0"], "patch");
    expect(result).toContain("1.2.4");
    expect(result).not.toContain("1.3.0");
    expect(result).not.toContain("2.0.0");
  });

  it("downgrade candidate mixed with upgrades → only downgrades filtered", () => {
    const result = targetFilter("1.5.0", ["1.4.0", "1.6.0", "2.0.0"], "major");
    expect(result).not.toContain("1.4.0");
    expect(result).toContain("1.6.0");
    expect(result).toContain("2.0.0");
  });

  it("empty candidates → empty result", () => {
    expect(targetFilter("1.0.0", [], "minor")).toEqual([]);
  });
});
