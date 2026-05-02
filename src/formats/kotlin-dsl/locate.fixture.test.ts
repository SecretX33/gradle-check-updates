// src/formats/kotlin-dsl/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../rewrite/apply.js";
import { loadFixtures } from "../../../test/helpers/fixtures.js";
import { locateKotlin } from "./locate.js";

describe("kotlin-dsl fixtures", async () => {
  const fixtureCases = await loadFixtures("test/fixtures/kotlin-dsl");
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
        const actual = locateKotlin("INPUT", fixtureCase.inputText);
        expect(actual).toEqual(fixtureCase.occurrences);
      });
    }
  }
});
