import { describe, expect, it } from "vitest";
import type { Occurrence } from "../types.js";
import { applyCoherence } from "./coherence.js";

function makeOccurrence(
  overrides: Partial<Occurrence> &
    Pick<Occurrence, "shape" | "currentRaw" | "dependencyKey">,
): Occurrence {
  return {
    group: "com.example",
    artifact: "foo",
    file: "build.gradle",
    byteStart: 0,
    byteEnd: 10,
    fileType: "groovy-dsl",
    via: undefined,
    ...overrides,
  };
}

describe("applyCoherence", () => {
  describe("Scenario 1: simple coherent bump", () => {
    it("governs by richStrictly and aligns all siblings to its winner", () => {
      const strictlyOccurrence = makeOccurrence({
        shape: "richStrictly",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:foo@b1",
      });
      const requireOccurrence = makeOccurrence({
        shape: "richRequire",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:foo@b1",
      });
      const preferOccurrence = makeOccurrence({
        shape: "richPrefer",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:foo@b1",
      });

      const groups = new Map([
        [
          "com.example:foo@b1",
          [
            { occurrence: strictlyOccurrence, proposedWinner: "2.0.1" },
            { occurrence: requireOccurrence, proposedWinner: "2.0.0" },
            { occurrence: preferOccurrence, proposedWinner: "1.8.0" },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      expect(result.size).toBe(3);

      const strictlyDecision = result.get(strictlyOccurrence);
      expect(strictlyDecision?.status).toBe("upgrade");
      expect(strictlyDecision?.newVersion).toBe("2.0.1");

      const requireDecision = result.get(requireOccurrence);
      expect(requireDecision?.status).toBe("upgrade");
      expect(requireDecision?.newVersion).toBe("2.0.1");

      const preferDecision = result.get(preferOccurrence);
      expect(preferDecision?.status).toBe("upgrade");
      expect(preferDecision?.newVersion).toBe("2.0.1");
    });

    it("emits no-change for a sibling already at the coherent winner", () => {
      const strictlyOccurrence = makeOccurrence({
        shape: "richStrictly",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:foo@b1",
      });
      const preferOccurrence = makeOccurrence({
        shape: "richPrefer",
        currentRaw: "2.0.1",
        dependencyKey: "com.example:foo@b1",
      });

      const groups = new Map([
        [
          "com.example:foo@b1",
          [
            { occurrence: strictlyOccurrence, proposedWinner: "2.0.1" },
            { occurrence: preferOccurrence, proposedWinner: "2.0.1" },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      expect(result.size).toBe(2);

      const strictlyDecision = result.get(strictlyOccurrence);
      expect(strictlyDecision?.status).toBe("upgrade");
      expect(strictlyDecision?.newVersion).toBe("2.0.1");

      const preferDecision = result.get(preferOccurrence);
      expect(preferDecision?.status).toBe("no-change");
    });
  });

  describe("Scenario 2: reject-conflict abort", () => {
    it("emits conflict for all occurrences when a reject sibling matches the winner", () => {
      const requireOccurrence = makeOccurrence({
        shape: "richRequire",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:bar@b2",
      });
      const rejectOccurrence = makeOccurrence({
        shape: "richReject",
        currentRaw: "2.0.1",
        dependencyKey: "com.example:bar@b2",
      });

      const groups = new Map([
        [
          "com.example:bar@b2",
          [
            { occurrence: requireOccurrence, proposedWinner: "2.0.1" },
            { occurrence: rejectOccurrence, proposedWinner: undefined },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      expect(result.size).toBe(2);

      const requireDecision = result.get(requireOccurrence);
      expect(requireDecision?.status).toBe("conflict");
      expect(requireDecision?.reason).toMatch(/reject/i);

      const rejectDecision = result.get(rejectOccurrence);
      expect(rejectDecision?.status).toBe("conflict");
      expect(rejectDecision?.reason).toMatch(/reject/i);
    });

    it("does not conflict when reject sibling does not match the winner", () => {
      const requireOccurrence = makeOccurrence({
        shape: "richRequire",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:bar@b2",
      });
      const rejectOccurrence = makeOccurrence({
        shape: "richReject",
        currentRaw: "1.5.0",
        dependencyKey: "com.example:bar@b2",
      });

      const groups = new Map([
        [
          "com.example:bar@b2",
          [
            { occurrence: requireOccurrence, proposedWinner: "2.0.1" },
            { occurrence: rejectOccurrence, proposedWinner: undefined },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      const requireDecision = result.get(requireOccurrence);
      expect(requireDecision?.status).toBe("upgrade");
      expect(requireDecision?.newVersion).toBe("2.0.1");

      expect(result.has(rejectOccurrence)).toBe(false);
    });
  });

  describe("Scenario 3: no rich block (no-op)", () => {
    it("returns an empty map when no keys contain '@'", () => {
      const plainOccurrence = makeOccurrence({
        shape: "exact",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:baz",
      });

      const groups = new Map([
        ["com.example:baz", [{ occurrence: plainOccurrence, proposedWinner: "2.0.0" }]],
      ]);

      const result = applyCoherence(groups);

      expect(result.size).toBe(0);
    });

    it("returns an empty map for an empty input", () => {
      const result = applyCoherence(new Map());
      expect(result.size).toBe(0);
    });
  });

  describe("all sibling proposedWinners undefined → no update", () => {
    it("emits nothing for a block where all proposedWinners are undefined", () => {
      const strictlyOccurrence = makeOccurrence({
        shape: "richStrictly",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:qux@b3",
      });
      const preferOccurrence = makeOccurrence({
        shape: "richPrefer",
        currentRaw: "1.7.15",
        dependencyKey: "com.example:qux@b3",
      });

      const groups = new Map([
        [
          "com.example:qux@b3",
          [
            { occurrence: strictlyOccurrence, proposedWinner: undefined },
            { occurrence: preferOccurrence, proposedWinner: undefined },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      expect(result.size).toBe(0);
    });
  });

  describe("governing shape priority", () => {
    it("richRequire governs over richPrefer when no richStrictly present", () => {
      const requireOccurrence = makeOccurrence({
        shape: "richRequire",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:governed@b4",
      });
      const preferOccurrence = makeOccurrence({
        shape: "richPrefer",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:governed@b4",
      });

      const groups = new Map([
        [
          "com.example:governed@b4",
          [
            { occurrence: requireOccurrence, proposedWinner: "3.0.0" },
            { occurrence: preferOccurrence, proposedWinner: "2.0.0" },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      const requireDecision = result.get(requireOccurrence);
      expect(requireDecision?.status).toBe("upgrade");
      expect(requireDecision?.newVersion).toBe("3.0.0");

      const preferDecision = result.get(preferOccurrence);
      expect(preferDecision?.status).toBe("upgrade");
      expect(preferDecision?.newVersion).toBe("3.0.0");
    });

    it("skips the block when richStrictly is present but has no proposed winner", () => {
      const strictlyOccurrence = makeOccurrence({
        shape: "richStrictly",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:fallback@b5",
      });
      const requireOccurrence = makeOccurrence({
        shape: "richRequire",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:fallback@b5",
      });

      const groups = new Map([
        [
          "com.example:fallback@b5",
          [
            { occurrence: strictlyOccurrence, proposedWinner: undefined },
            { occurrence: requireOccurrence, proposedWinner: "3.0.0" },
          ],
        ],
      ]);

      const result = applyCoherence(groups);

      expect(result.size).toBe(0);
      expect(result.has(strictlyOccurrence)).toBe(false);
      expect(result.has(requireOccurrence)).toBe(false);
    });
  });

  describe("mixed rich and non-rich groups", () => {
    it("processes only the rich block, ignores the plain key", () => {
      const richOccurrence = makeOccurrence({
        shape: "richRequire",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:mixed@b6",
      });
      const plainOccurrence = makeOccurrence({
        shape: "exact",
        currentRaw: "1.0.0",
        dependencyKey: "com.example:mixed",
      });

      const groups = new Map([
        [
          "com.example:mixed@b6",
          [{ occurrence: richOccurrence, proposedWinner: "2.0.0" }],
        ],
        ["com.example:mixed", [{ occurrence: plainOccurrence, proposedWinner: "2.0.0" }]],
      ]);

      const result = applyCoherence(groups);

      expect(result.has(richOccurrence)).toBe(true);
      expect(result.has(plainOccurrence)).toBe(false);
    });
  });
});
