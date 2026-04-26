import { compareVersions } from "../version/compare.js";

export function isAllowDowngradeValid(options: {
  allowDowngrade: boolean;
  cooldownDays: number | undefined;
}): boolean {
  if (
    options.allowDowngrade &&
    (options.cooldownDays === undefined || options.cooldownDays <= 0)
  ) {
    return false;
  }
  return true;
}

export function attemptAllowDowngrade(options: {
  currentVersion: string;
  candidates: string[];
  publishedAt: Map<string, number>;
  cooldownDays: number;
  currentPublishedAt: number | undefined;
  now: Date;
}): string | undefined {
  const {
    currentVersion,
    candidates,
    publishedAt,
    cooldownDays,
    currentPublishedAt,
    now,
  } = options;
  const cutoffMs = now.getTime() - cooldownDays * 86_400_000;

  const currentIsInsideWindow =
    currentPublishedAt === undefined || currentPublishedAt > cutoffMs;

  if (!currentIsInsideWindow) {
    return undefined;
  }

  const eligibleCandidates = candidates.filter((candidate) => {
    if (compareVersions(candidate, currentVersion) >= 0) return false;
    const timestamp = publishedAt.get(candidate);
    if (timestamp === undefined) return false;
    return timestamp <= cutoffMs;
  });

  if (eligibleCandidates.length === 0) {
    return undefined;
  }

  return eligibleCandidates.reduce((highest, candidate) => {
    return compareVersions(candidate, highest) > 0 ? candidate : highest;
  });
}
