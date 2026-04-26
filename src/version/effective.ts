import { compareVersions } from "./compare";

export function matchesPrefix(prefix: string, candidate: string): boolean {
  if (prefix === "+") return true;
  const stem = prefix.slice(0, -2); // strip ".+"
  return candidate === stem || candidate.startsWith(stem + ".");
}

export function inMavenRange(range: string, version: string): boolean {
  const rangeMatch = /^([\[(])\s*([^,]*)\s*,\s*([^,]*)\s*([\])])$/.exec(range);
  if (!rangeMatch) return false;
  const [, lowerBracket, lowerBound, upperBound, upperBracket] = rangeMatch;
  if (lowerBound) {
    const comparison = compareVersions(version, lowerBound);
    if (lowerBracket === "[" ? comparison < 0 : comparison <= 0) return false;
  }
  if (upperBound) {
    const comparison = compareVersions(version, upperBound);
    if (upperBracket === "]" ? comparison > 0 : comparison >= 0) return false;
  }
  return true;
}

export function effectiveVersion(
  spec: { shape: string; raw: string },
  candidates: string[],
): string {
  const { shape, raw } = spec;
  switch (shape) {
    case "exact":
    case "prerelease":
    case "snapshot":
      return raw;
    case "strictlyShorthand":
      return raw.replace(/!!$/, "");
    case "strictlyPreferShort": {
      const idx = raw.indexOf("!!");
      return raw.slice(idx + 2);
    }
    case "prefix": {
      const matching = candidates
        .filter((c) => matchesPrefix(raw, c))
        .sort(compareVersions);
      return matching.at(-1) ?? raw;
    }
    case "mavenRange": {
      const matching = candidates
        .filter((c) => inMavenRange(raw, c))
        .sort(compareVersions);
      return matching.at(-1) ?? raw;
    }
    case "latestQualifier":
      return candidates.slice().sort(compareVersions).at(-1) ?? raw;
    default:
      return raw;
  }
}
