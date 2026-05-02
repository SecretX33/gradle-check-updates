// src/refs/resolve.fixture.test.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { Occurrence } from "../types.js";
import { resolveRefs, type RefError } from "./resolve.js";

type Scenario = {
  description?: string;
  input: { occurrences: Occurrence[] };
  expected: { occurrences: Occurrence[]; errors: RefError[] };
};

const FIXTURES_DIR = "test/fixtures/refs";

describe("refs scenario fixtures", async () => {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  directories.sort();

  for (const directoryName of directories) {
    const scenarioPath = join(FIXTURES_DIR, directoryName, "scenario.json");
    const scenario = JSON.parse(await readFile(scenarioPath, "utf8")) as Scenario;

    it(`${directoryName}: resolveRefs matches expected output`, () => {
      const result = resolveRefs(scenario.input.occurrences);
      expect(result.occurrences).toEqual(scenario.expected.occurrences);
      expect(result.errors).toEqual(scenario.expected.errors);
    });
  }
});
