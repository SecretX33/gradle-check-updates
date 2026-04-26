import { describe, it, expect } from "vitest";
import { bumpKind, withinTarget } from "./diff";

describe("bumpKind", () => {
  it("patch", () => expect(bumpKind("1.2.3", "1.2.4")).toBe("patch"));
  it("minor", () => expect(bumpKind("1.2.3", "1.3.0")).toBe("minor"));
  it("major", () => expect(bumpKind("1.2.3", "2.0.0")).toBe("major"));
  it("prerelease bump within same x.y.z is patch-equivalent", () => {
    expect(bumpKind("1.0.0-rc1", "1.0.0-rc2")).toBe("patch");
  });
  it("downgrade still classified by distance", () => {
    expect(bumpKind("2.0.0", "1.9.0")).toBe("major");
  });
  it("2-part versions: minor bump", () => {
    expect(bumpKind("1.0", "1.1")).toBe("minor");
  });
  it("snapshot to release with same numeric is patch", () => {
    expect(bumpKind("1.0.0-SNAPSHOT", "1.0.0")).toBe("patch");
  });

  describe("real-world version formats", () => {
    it("dot-qualified patch: 6.6.41.Final → 6.6.42.Final", () => {
      expect(bumpKind("6.6.41.Final", "6.6.42.Final")).toBe("patch");
    });

    it("dot-qualified minor: 6.6.41.Final → 6.7.0.Final", () => {
      expect(bumpKind("6.6.41.Final", "6.7.0.Final")).toBe("minor");
    });

    it("dot-qualified major: 6.6.41.Final → 7.0.0.Final", () => {
      expect(bumpKind("6.6.41.Final", "7.0.0.Final")).toBe("major");
    });

    it("classifier minor: 33.5.0-jre → 33.6.0-jre", () => {
      expect(bumpKind("33.5.0-jre", "33.6.0-jre")).toBe("minor");
    });

    it("four-part patch: 2.2.1.1 → 2.2.1.2", () => {
      expect(bumpKind("2.2.1.1", "2.2.1.2")).toBe("patch");
    });

    it("four-part minor: 2.2.1.1 → 2.3.0.0", () => {
      expect(bumpKind("2.2.1.1", "2.3.0.0")).toBe("minor");
    });

    it("two-part minor: 5.6 → 5.7", () => {
      expect(bumpKind("5.6", "5.7")).toBe("minor");
    });

    it("two-part major: 8.1 → 9.0", () => {
      expect(bumpKind("8.1", "9.0")).toBe("major");
    });
  });
});

describe("withinTarget", () => {
  it("patch ceiling: patch bump is within", () => {
    expect(withinTarget("1.0.0", "1.0.1", "patch")).toBe(true);
  });
  it("patch ceiling: minor bump is not within", () => {
    expect(withinTarget("1.0.0", "1.1.0", "patch")).toBe(false);
  });
  it("minor ceiling: minor bump is within", () => {
    expect(withinTarget("1.0.0", "1.1.0", "minor")).toBe(true);
  });
  it("minor ceiling: major bump is not within", () => {
    expect(withinTarget("1.0.0", "2.0.0", "minor")).toBe(false);
  });
  it("major ceiling: major bump is within", () => {
    expect(withinTarget("1.0.0", "2.0.0", "major")).toBe(true);
  });
  it("major ceiling: patch bump is within", () => {
    expect(withinTarget("1.0.0", "1.0.1", "major")).toBe(true);
  });
  it("patch ceiling rejects major bump", () =>
    expect(withinTarget("1.0.0", "2.0.0", "patch")).toBe(false));
});
