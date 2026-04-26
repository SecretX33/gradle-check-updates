import type { Decision, Occurrence, VersionShape } from "../types.js";

export type BlockEntry = { occurrence: Occurrence; proposedWinner: string | undefined };

const SHAPE_STRENGTH: Partial<Record<VersionShape, number>> = {
  richStrictly: 3,
  richRequire: 2,
  richPrefer: 1,
};

function governingStrength(shape: VersionShape): number {
  return SHAPE_STRENGTH[shape] ?? 0;
}

/**
 * Applies the rich-block coherence rule.
 *
 * Input: map of dependencyKey → { occurrence, proposedWinner } pairs.
 * proposedWinner is the version string already chosen by per-occurrence policy
 * for this occurrence (or undefined if the occurrence is ineligible/no-change).
 *
 * For groups with "@<blockId>" in their dependencyKey:
 * - Determines the governing occurrence by strongest constraint shape
 * - If a reject sibling matches the governing winner → conflict for all
 * - Otherwise aligns all sibling winners to the governing winner
 *
 * Returns: Map of occurrence → Decision (only for occurrences that were
 * in a rich block; non-rich occurrences are passed through unchanged).
 */
export function applyCoherence(
  groups: Map<string, Array<BlockEntry>>,
): Map<Occurrence, Decision> {
  const result = new Map<Occurrence, Decision>();

  for (const [dependencyKey, entries] of groups) {
    if (!dependencyKey.includes("@")) {
      continue;
    }

    const governingEntry = findGoverningEntry(entries);
    if (governingEntry === undefined) {
      continue;
    }

    const coherentWinner = governingEntry.proposedWinner!;

    const rejectConflict = entries.some(
      (entry) =>
        entry.occurrence.shape === "richReject" &&
        entry.occurrence.currentRaw === coherentWinner,
    );

    if (rejectConflict) {
      for (const entry of entries) {
        result.set(entry.occurrence, {
          occurrence: entry.occurrence,
          status: "conflict",
          reason: "reject constraint matches proposed winner",
        });
      }
      continue;
    }

    for (const entry of entries) {
      if (entry.occurrence.shape === "richReject") {
        continue;
      }

      if (entry.occurrence.currentRaw === coherentWinner) {
        result.set(entry.occurrence, {
          occurrence: entry.occurrence,
          status: "no-change",
        });
      } else {
        result.set(entry.occurrence, {
          occurrence: entry.occurrence,
          status: "upgrade",
          newVersion: coherentWinner,
        });
      }
    }
  }

  return result;
}

function findGoverningEntry(entries: Array<BlockEntry>): BlockEntry | undefined {
  let strongestEntry: BlockEntry | undefined;
  let strongestStrength = 0;

  for (const entry of entries) {
    if (entry.occurrence.shape === "richReject") continue;
    const strength = governingStrength(entry.occurrence.shape);
    if (strength > strongestStrength) {
      strongestStrength = strength;
      strongestEntry = entry;
    }
  }

  if (strongestEntry === undefined) return undefined;
  if (strongestEntry.proposedWinner === undefined) return undefined;
  return strongestEntry;
}
