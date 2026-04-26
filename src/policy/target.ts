import { compareVersions } from "../version/compare.js";
import { withinTarget } from "../version/diff.js";
import type { ProjectConfig } from "../config/schema.js";

export function targetFilter(
  currentVersion: string,
  candidates: string[],
  target: ProjectConfig["target"],
): string[] {
  return candidates.filter((candidate) => {
    // Never-downgrade invariant: candidates strictly below current are always filtered
    if (compareVersions(candidate, currentVersion) < 0) return false;
    // Target ceiling
    if (target) return withinTarget(currentVersion, candidate, target);
    return true;
  });
}
