export function cooldownFilter(
  candidates: string[],
  publishedAt: (version: string) => Date | undefined,
  cooldownDays: number,
  now: Date,
): string[] {
  if (cooldownDays <= 0) return candidates;
  const cutoffMs = now.getTime() - cooldownDays * 86_400_000;
  return candidates.filter((version) => {
    const publishDate = publishedAt(version);
    if (!publishDate) return true; // unknown timestamp → don't filter out
    return publishDate.getTime() <= cutoffMs;
  });
}
