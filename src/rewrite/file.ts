// src/rewrite/file.ts
import { readFile, writeFile } from "node:fs/promises";
import type { Edit } from "../types";
import { applyEdits } from "./apply";

export async function rewriteFile(path: string, edits: Edit[]): Promise<void> {
  if (edits.length === 0) return;
  const original = await readFile(path);
  const updated = applyEdits(original, edits);
  await writeFile(path, updated);
}
