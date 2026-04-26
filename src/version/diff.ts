import { tokenize } from "./tokenize";

export type BumpKind = "major" | "minor" | "patch";

function numericPrefix(version: string): number[] {
  const out: number[] = [];
  for (const token of tokenize(version)) {
    if (token.kind === "num") out.push(token.value);
    else break;
  }
  while (out.length < 3) out.push(0);
  return out;
}

export function bumpKind(from: string, to: string): BumpKind {
  const [aMa, aMi, aPa] = numericPrefix(from);
  const [bMa, bMi, bPa] = numericPrefix(to);
  if (aMa !== bMa) return "major";
  if (aMi !== bMi) return "minor";
  if (aPa !== bPa) return "patch";
  // equal versions: treat as patch (caller guarantees to !== from)
  return "patch";
}

export function withinTarget(from: string, to: string, ceiling: BumpKind): boolean {
  const k = bumpKind(from, to);
  if (ceiling === "major") return true;
  if (ceiling === "minor") return k !== "major";
  return k === "patch";
}
