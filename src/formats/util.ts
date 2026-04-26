export function utf8ByteLen(source: string): number {
  return Buffer.byteLength(source, "utf8");
}

export function charIndexToByte(text: string, charIndex: number): number {
  return Buffer.byteLength(text.slice(0, charIndex), "utf8");
}

/** Parses "group:artifact:version" or "group:artifact" into parts (rest is the trailing version, possibly empty). */
export function splitGav(
  coord: string,
): { group: string; artifact: string; version: string | null } | null {
  const parts = coord.split(":");
  if (parts.length === 2) return { group: parts[0]!, artifact: parts[1]!, version: null };
  if (parts.length === 3)
    return { group: parts[0]!, artifact: parts[1]!, version: parts[2]! };
  return null;
}

export function depKey(group: string, artifact: string, blockId?: string): string {
  return blockId ? `${group}:${artifact}@${blockId}` : `${group}:${artifact}`;
}
