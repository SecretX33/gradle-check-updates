// test/fixtures/version-catalog/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../../src/rewrite/apply.js";
import { locateVersionCatalog } from "../../../src/formats/version-catalog/locate.js";
import { loadFixtures } from "../../helpers/fixtures.js";

describe("version-catalog fixtures", async () => {
  const fixtureCases = await loadFixtures("test/fixtures/version-catalog");
  for (const fixtureCase of fixtureCases) {
    if (fixtureCase.edits && fixtureCase.expectedBytes) {
      it(`${fixtureCase.name}: rewriter produces expected bytes`, () => {
        expect(
          applyEdits(fixtureCase.inputBytes, fixtureCase.edits!).equals(
            fixtureCase.expectedBytes!,
          ),
        ).toBe(true);
      });
    }

    if (fixtureCase.occurrences !== null) {
      it(`${fixtureCase.name}: locator emits expected occurrences`, () => {
        const actual = locateVersionCatalog("INPUT", fixtureCase.inputText);
        expect(actual).toEqual(fixtureCase.occurrences);
      });
    }
  }
});
