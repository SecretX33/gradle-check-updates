import type { VersionShape, Occurrence } from "../types.js";

const NON_ELIGIBLE_SHAPES = new Set<VersionShape>([
  "snapshot",
  "latestQualifier",
  "mavenRange",
  "richReject",
]);

export function isEligible(occurrence: Occurrence): boolean {
  if (NON_ELIGIBLE_SHAPES.has(occurrence.shape)) return false;
  // richStrictly is eligible only when the value is a plain version (no brackets)
  if (occurrence.shape === "richStrictly") {
    return !occurrence.currentRaw.includes("[") && !occurrence.currentRaw.includes("(");
  }
  return true;
}

export function renderReplacement(occurrence: Occurrence, winner: string): string {
  switch (occurrence.shape) {
    case "exact":
    case "prerelease":
    case "richRequire":
    case "richPrefer":
    case "richStrictly":
      return winner;
    case "prefix": {
      // Preserve depth: count numeric parts before the `+`
      const prefixParts = occurrence.currentRaw.replace(/\.\+$/, "").split(".");
      const winnerParts = winner.split(".");
      return winnerParts.slice(0, prefixParts.length).join(".") + ".+";
    }
    case "strictlyShorthand": {
      // "1.7.25!!1.7.25" → "2.0.1!!2.0.1"
      return `${winner}!!${winner}`;
    }
    case "strictlyPreferShort": {
      const boundMatch = occurrence.currentRaw.match(
        /^([\[(])([\d.]+),([\d.]+)([\])])!!(.+)$/,
      );
      if (boundMatch === null) return winner;
      const openBracket = boundMatch[1]!;
      const currentLower = boundMatch[2]!;
      // boundMatch[3] is the original upper bound — intentionally discarded and recomputed
      const closeBracket = boundMatch[4]!;
      const boundDepth = currentLower.split(".").length;
      const winnerParts = winner.split(".");
      const newLowerParts = winnerParts.slice(0, boundDepth);
      while (newLowerParts.length < boundDepth) newLowerParts.push("0");
      const newLower = newLowerParts.join(".");
      const newUpperParts = [...newLowerParts];
      newUpperParts[newUpperParts.length - 1] = String(
        parseInt(newUpperParts[newUpperParts.length - 1]!, 10) + 1,
      );
      const newUpper = newUpperParts.join(".");
      return `${openBracket}${newLower},${newUpper}${closeBracket}!!${winner}`;
    }
    default:
      return winner;
  }
}
