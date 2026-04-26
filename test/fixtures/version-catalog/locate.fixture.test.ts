// test/fixtures/version-catalog/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../../src/rewrite/apply.js";
import { loadFixtures } from "../../helpers/fixtures.js";

describe("version-catalog fixtures", async () => {
  const fixtureCases = await loadFixtures("test/fixtures/version-catalog");
  for (const fixtureCase of fixtureCases) {
    it(`${fixtureCase.name}: rewriter produces expected bytes`, () => {
      if (!fixtureCase.edits || !fixtureCase.expectedBytes) return;
      expect(applyEdits(fixtureCase.inputBytes, fixtureCase.edits).equals(fixtureCase.expectedBytes)).toBe(true);
    });
  }
});
