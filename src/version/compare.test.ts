import { describe, it, expect } from "vitest";
import { compareVersions } from "./compare";

const lt = (a: string, b: string) => expect(compareVersions(a, b)).toBeLessThan(0);
const eq = (a: string, b: string) => expect(compareVersions(a, b)).toBe(0);
const gt = (a: string, b: string) => expect(compareVersions(a, b)).toBeGreaterThan(0);

describe("compareVersions", () => {
  it("orders patch numerically", () => {
    lt("1.2.3", "1.2.4");
    gt("1.10.0", "1.9.0");
  });

  it("orders minor and major", () => {
    lt("1.9.9", "2.0.0");
  });

  it("treats missing trailing zero as zero", () => {
    eq("1.0", "1.0.0");
  });

  it("ranks dev < alpha < beta < milestone < rc < snapshot < final/release", () => {
    lt("1.0-dev", "1.0-alpha");
    lt("1.0-alpha", "1.0-beta");
    lt("1.0-beta", "1.0-milestone");
    lt("1.0-milestone", "1.0-rc1");
    lt("1.0-rc1", "1.0-SNAPSHOT");
    lt("1.0-SNAPSHOT", "1.0");
    lt("1.0", "1.0-final");
    lt("1.0-final", "1.0-ga");
    lt("1.0-ga", "1.0-release");
    lt("1.0-release", "1.0-sp1");
  });

  it("treats `a`==`alpha`, `b`==`beta`, `m`==`milestone`, `cr`==`rc`", () => {
    eq("1.0-a1", "1.0-alpha1");
    eq("1.0-b2", "1.0-beta2");
    eq("1.0-m3", "1.0-milestone3");
    eq("1.0-cr4", "1.0-rc4");
  });

  it("orders by sequential numeric within same qualifier", () => {
    lt("1.0-rc1", "1.0-rc2");
  });

  // Extra edge cases
  it("trailing zeros are symmetric", () => {
    eq("1.0.0", "1.0");
  });

  it("snapshot < final (cross-check)", () => {
    lt("1.0-SNAPSHOT", "1.0-final");
  });

  it("major beats minor buildup", () => {
    gt("2.0", "1.9.9");
  });

  it("unknown qualifiers compare lexicographically", () => {
    lt("1.0-abc", "1.0-abd");
  });

  it("is antisymmetric for qualifier/missing-token boundary cases", () => {
    gt("1.0-final", "1.0");
    gt("1.0", "1.0-dev");
    gt("1.0-sp1", "1.0-release");
  });

  describe("real-world version formats", () => {
    it("orders dot-qualified versions: 6.6.41.Final < 6.6.42.Final", () => {
      lt("6.6.41.Final", "6.6.42.Final");
    });

    it("orders across minor with dot-qualifier: 6.6.41.Final < 6.7.0.Final", () => {
      lt("6.6.41.Final", "6.7.0.Final");
    });

    it("orders classifier versions: 33.5.0-jre < 33.6.0-jre", () => {
      lt("33.5.0-jre", "33.6.0-jre");
    });

    it("stable beats alpha of same version: 2.23.0-alpha < 2.23.0", () => {
      lt("2.23.0-alpha", "2.23.0");
    });

    it("orders four-part versions: 2.2.1.1 < 2.2.1.2", () => {
      lt("2.2.1.1", "2.2.1.2");
    });

    it("orders four-part versions across minor: 2.2.1.1 < 2.3.0.0", () => {
      lt("2.2.1.1", "2.3.0.0");
    });

    it("orders two-part versions: 5.6 < 5.7", () => {
      lt("5.6", "5.7");
    });

    it("orders two-part across major: 8.1 < 9.0", () => {
      lt("8.1", "9.0");
    });

    it("case-insensitive qualifier: 6.6.41.Final == 6.6.41.FINAL", () => {
      eq("6.6.41.Final", "6.6.41.FINAL");
    });
  });
});
