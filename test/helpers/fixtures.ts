import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type FixtureCase = {
  name: string;
  inputPath: string;
  inputBytes: Buffer;
  inputText: string;
  expectedBytes: Buffer | null;
  edits: { byteStart: number; byteEnd: number; replacement: string }[] | null;
  occurrences: unknown | null;
};

export async function loadFixtures(rootDir: string): Promise<FixtureCase[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const out: FixtureCase[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(rootDir, entry.name);
    const files = await readdir(dir);
    const inputName = files.find((fileName: string) => fileName.startsWith("input."));
    if (!inputName) continue;
    const expectedName = files.find((fileName: string) => fileName.startsWith("expected."));
    const inputPath = join(dir, inputName);
    const inputBytes = await readFile(inputPath);
    const expectedBytes = expectedName ? await readFile(join(dir, expectedName)) : null;
    const editsPath = join(dir, "edits.json");
    const occurrencesPath = join(dir, "occurrences.json");
    const edits = files.includes("edits.json")
      ? JSON.parse(await readFile(editsPath, "utf8"))
      : null;
    const occurrences = files.includes("occurrences.json")
      ? JSON.parse(await readFile(occurrencesPath, "utf8"))
      : null;
    out.push({
      name: entry.name,
      inputPath,
      inputBytes,
      inputText: inputBytes.toString("utf8"),
      expectedBytes,
      edits,
      occurrences,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
