import { tokenize, type Token } from "./tokenize";

const QUAL_RANK: Record<string, number> = {
  dev: 0,
  alpha: 1,
  a: 1,
  beta: 2,
  b: 2,
  milestone: 3,
  m: 3,
  rc: 4,
  cr: 4,
  snapshot: 5,
  "": 6, // unqualified release (plain "1.0" with no qualifier suffix)
  final: 7,
  ga: 8,
  release: 9,
  sp: 10,
};

function rankQual(q: string): number {
  return QUAL_RANK[q] ?? -1; // unknown qualifiers rank below dev; two unknowns compare lexicographically
}

// Missing token on one side compares as: rank 6 ("") when facing a qual,
// and as numeric 0 when facing a num. Both missing → equal.
function compareTokens(a: Token | undefined, b: Token | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) {
    if (b!.kind === "qual") return 6 - rankQual(b!.value);
    return -b!.value;
  }
  if (b === undefined) {
    if (a.kind === "qual") return rankQual(a.value) - 6;
    return a.value;
  }
  if (a.kind === "num" && b.kind === "num") return a.value - b.value;
  if (a.kind === "qual" && b.kind === "qual") {
    const rankA = rankQual(a.value),
      rankB = rankQual(b.value);
    if (rankA !== rankB) return rankA - rankB;
    // Same rank: if both are known qualifiers (aliases like a/alpha), treat as equal.
    // Unknown qualifiers (rank -1) compare lexicographically.
    if (rankA !== -1) return 0;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  return a.kind === "num" ? 1 : -1;
}

export function compareVersions(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const len = Math.max(tokensA.length, tokensB.length);
  for (let i = 0; i < len; i++) {
    const comparison = compareTokens(tokensA[i], tokensB[i]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}
