import type { Occurrence } from "../types.js";
import { compareVersions } from "../version/compare.js";

export type SharedVarResult = {
  /** The resolved winner version for this edit site (lowest of all per-dep proposed winners). */
  resolvedWinner: string;
  /** The dependency key whose proposed winner was the lowest (the constraining dep). Undefined when all consumers agree. */
  constrainingDepKey?: string;
  /** All dependency keys that share this edit site. */
  depKeys: string[];
  /** Warning message to emit. Undefined when all consumers agree on the same winner. */
  warning?: string;
};

/**
 * Resolves shared-variable disagreements.
 *
 * Input: map of edit-site key ("`${file}:${byteStart}`") → array of
 * { occurrence, proposedWinner } where all entries share the same (file, byteStart).
 *
 * For edit sites with 2+ entries having different proposedWinners:
 * - Takes the lowest of the proposedWinners (using semantic version comparison)
 * - Records which depKey was the constraining dep (the one whose winner was lowest)
 * - Produces a warning string
 *
 * For edit sites with only one entry, or all entries agreeing, no warning is emitted
 * and the single winner is returned as-is.
 *
 * Returns: Map of edit-site key → SharedVarResult (only for sites with 2+ entries).
 * Single-entry sites are not included in the output map.
 */
export function resolveSharedVarDisagreements(
  editSites: Map<string, Array<{ occurrence: Occurrence; proposedWinner: string }>>,
): Map<string, SharedVarResult> {
  const result = new Map<string, SharedVarResult>();

  for (const [editSiteKey, entries] of editSites) {
    if (entries.length < 2) {
      continue;
    }

    const depKeys = entries.map((entry) => entry.occurrence.dependencyKey);

    let lowestEntry = entries[0];
    for (let index = 1; index < entries.length; index++) {
      const candidate = entries[index];
      if (compareVersions(candidate.proposedWinner, lowestEntry.proposedWinner) < 0) {
        lowestEntry = candidate;
      }
    }

    const resolvedWinner = lowestEntry.proposedWinner;
    const constrainingDepKey = lowestEntry.occurrence.dependencyKey;

    const allWinnerVersions = entries.map((entry) => entry.proposedWinner);
    const uniqueWinnerVersions = [...new Set(allWinnerVersions)];
    const allAgree = uniqueWinnerVersions.length === 1;

    if (allAgree) {
      result.set(editSiteKey, { resolvedWinner, depKeys });
    } else {
      const otherWinnerVersions = allWinnerVersions.filter(
        (version) => version !== resolvedWinner,
      );
      const uniqueOtherVersions = [...new Set(otherWinnerVersions)];
      const warning =
        `Shared variable constrained to ${resolvedWinner} by ${constrainingDepKey}\n` +
        `  (other consumers wanted: ${uniqueOtherVersions.join(", ")})`;
      result.set(editSiteKey, { resolvedWinner, constrainingDepKey, depKeys, warning });
    }
  }

  return result;
}
