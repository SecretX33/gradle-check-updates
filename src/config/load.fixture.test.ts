// src/config/load.fixture.test.ts
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loadCredentials } from "./credentials.js";
import { ConfigResolver } from "./resolve.js";

type Meta = {
  kind: "credentials" | "project";
  expectThrowMatch?: string;
  expectWarningMatch?: string;
};

const FIXTURES_DIR = "test/fixtures/config";

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("config fixture loader", async () => {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  directories.sort();

  for (const directoryName of directories) {
    const directoryPath = join(FIXTURES_DIR, directoryName);
    const metaPath = join(directoryPath, "meta.json");
    if (!(await fileExists(metaPath))) continue;
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Meta;

    if (meta.kind === "credentials") {
      it(`${directoryName}: loadCredentials throws matching ${JSON.stringify(meta.expectThrowMatch)}`, async () => {
        const credentialsPath = join(directoryPath, "credentials.json");
        await expect(loadCredentials(credentialsPath)).rejects.toThrow(
          new RegExp(meta.expectThrowMatch ?? ".", "i"),
        );
      });
      continue;
    }

    if (meta.kind === "project") {
      it(`${directoryName}: ConfigResolver behavior matches meta`, async () => {
        const warnings: { path: string; error: Error }[] = [];
        const resolver = new ConfigResolver(
          directoryPath,
          undefined,
          undefined,
          (path, error) => warnings.push({ path, error }),
        );
        const dummyFile = join(directoryPath, "build.gradle");

        if (meta.expectThrowMatch !== undefined) {
          await expect(resolver.resolveForFile(dummyFile)).rejects.toThrow(
            new RegExp(meta.expectThrowMatch, "i"),
          );
          return;
        }

        if (meta.expectWarningMatch !== undefined) {
          // JSON syntax errors are reported via the warning callback; the run continues.
          await resolver.resolveForFile(dummyFile);
          expect(warnings.length).toBeGreaterThan(0);
          expect(warnings[0]!.error.message).toMatch(
            new RegExp(meta.expectWarningMatch, "i"),
          );
        }
      });
    }
  }
});
