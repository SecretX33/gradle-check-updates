// src/formats/properties/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../rewrite/apply";
import { loadFixtures } from "../../../test/helpers/fixtures";

describe("properties fixtures", async () => {
  const cases = await loadFixtures("test/fixtures/properties");
  for (const fixtureCase of cases) {
    it(`${fixtureCase.name} round-trips byte-for-byte via edits.json`, () => {
      if (!fixtureCase.edits || !fixtureCase.expectedBytes) return;
      const result = applyEdits(fixtureCase.inputBytes, fixtureCase.edits);
      expect(result.equals(fixtureCase.expectedBytes)).toBe(true);
    });
  }
});
