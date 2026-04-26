// src/rewrite/apply.ts
import type { Edit } from "../types";

export function applyEdits(original: Buffer, edits: Edit[]): Buffer {
  if (edits.length === 0) return Buffer.from(original);

  const sorted = [...edits].sort((a, b) => a.byteStart - b.byteStart);

  // Validate and check for overlaps on the sorted list
  for (let i = 0; i < sorted.length; i++) {
    const edit = sorted[i]!;
    if (
      edit.byteStart < 0 ||
      edit.byteEnd < edit.byteStart ||
      edit.byteEnd > original.length
    ) {
      throw new Error(
        `Invalid edit range [${edit.byteStart},${edit.byteEnd}] for buffer of length ${original.length}`,
      );
    }
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (edit.byteStart < prev.byteEnd) {
        throw new Error(
          `Edits overlap at byte ${edit.byteStart} (previous ended at ${prev.byteEnd})`,
        );
      }
    }
  }

  const parts: Buffer[] = [];
  let cursor = 0;
  for (const edit of sorted) {
    parts.push(original.subarray(cursor, edit.byteStart));
    parts.push(Buffer.from(edit.replacement, "utf8"));
    cursor = edit.byteEnd;
  }
  parts.push(original.subarray(cursor));

  return Buffer.concat(parts);
}
