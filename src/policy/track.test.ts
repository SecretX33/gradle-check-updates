import { describe, it, expect } from "vitest";
import { trackFilter } from "./track.js";

describe("trackFilter", () => {
  it("stable current + no --pre → only stable candidates returned", () => {
    const candidates = ["2.0.0", "2.1.0-alpha.1", "2.0.0-beta.1", "1.9.0-SNAPSHOT"];
    expect(trackFilter("1.0.0", candidates, {})).toEqual(["2.0.0"]);
  });

  it("stable current + --pre → all candidates returned including prereleases", () => {
    const candidates = ["2.0.0", "2.1.0-alpha.1", "1.9.0-SNAPSHOT"];
    expect(trackFilter("1.0.0", candidates, { pre: true })).toEqual(candidates);
  });

  it("prerelease current → stables AND prereleases AND snapshots returned", () => {
    const candidates = ["2.0.0", "2.1.0-alpha.1", "1.9.0-SNAPSHOT", "3.0.0-beta.2"];
    const result = trackFilter("1.0.0-alpha.1", candidates, {});
    expect(result).toContain("2.0.0");
    expect(result).toContain("2.1.0-alpha.1");
    expect(result).toContain("3.0.0-beta.2");
    expect(result).toContain("1.9.0-SNAPSHOT");
  });

  it("snapshot current → stables AND snapshots AND prereleases returned", () => {
    const candidates = ["2.0.0", "2.1.0-SNAPSHOT", "2.0.0-alpha.1"];
    const result = trackFilter("1.0.0-SNAPSHOT", candidates, {});
    expect(result).toContain("2.0.0");
    expect(result).toContain("2.1.0-SNAPSHOT");
    expect(result).toContain("2.0.0-alpha.1");
  });

  it("empty candidates → empty result", () => {
    expect(trackFilter("1.0.0", [], {})).toEqual([]);
  });

  it("--pre flag overrides everything, returns all candidates", () => {
    const candidates = ["2.0.0", "2.1.0-alpha.1", "1.9.0-SNAPSHOT", "3.0.0-beta.2"];
    expect(trackFilter("1.0.0", candidates, { pre: true })).toEqual(candidates);
  });

  it("stable current filters out snapshots", () => {
    const candidates = ["2.0.0-SNAPSHOT", "1.5.0-SNAPSHOT"];
    expect(trackFilter("1.0.0", candidates, {})).toEqual([]);
  });
});
