// src/formats/groovy-dsl/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../rewrite/apply.js";
import { loadFixtures } from "../../../test/helpers/fixtures.js";

describe("groovy-dsl fixtures", async () => {
  const fixtureCases = await loadFixtures("test/fixtures/groovy-dsl");
  for (const fixtureCase of fixtureCases) {
    it(`${fixtureCase.name}: rewriter produces expected bytes`, () => {
      if (!fixtureCase.edits || !fixtureCase.expectedBytes) return;
      expect(
        applyEdits(fixtureCase.inputBytes, fixtureCase.edits).equals(
          fixtureCase.expectedBytes,
        ),
      ).toBe(true);
    });
  }
});
