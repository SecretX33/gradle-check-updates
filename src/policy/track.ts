import { isStable, isPrerelease, isSnapshot } from "../version/shape.js";

export function trackFilter(
  currentVersion: string,
  candidates: string[],
  options: { pre?: boolean },
): string[] {
  if (options.pre) return candidates;
  if (isStable(currentVersion))
    return candidates.filter((candidate) => isStable(candidate));
  // current is prerelease or snapshot → keep stables, prereleases, and snapshots
  return candidates.filter(
    (candidate) =>
      isStable(candidate) || isPrerelease(candidate) || isSnapshot(candidate),
  );
}
