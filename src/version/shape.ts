import { tokenize } from "./tokenize";

export type SimpleShape =
  | "exact"
  | "prerelease"
  | "snapshot"
  | "prefix"
  | "latestQualifier"
  | "strictlyShorthand"
  | "strictlyPreferShort"
  | "mavenRange";

const PRE_QUALS = new Set([
  "dev",
  "alpha",
  "a",
  "beta",
  "b",
  "milestone",
  "m",
  "rc",
  "cr",
]);

export function isSnapshot(version: string): boolean {
  return /-SNAPSHOT$/i.test(version);
}

export function isPrerelease(version: string): boolean {
  if (isSnapshot(version)) return false;
  for (const token of tokenize(version)) {
    if (token.kind === "qual" && PRE_QUALS.has(token.value)) return true;
  }
  return false;
}

export function isStable(version: string): boolean {
  return !isSnapshot(version) && !isPrerelease(version);
}

export function detectShape(raw: string): SimpleShape {
  const version = raw.trim();
  if (version === "+" || /\.\+$/.test(version)) return "prefix";
  if (/^latest\./i.test(version)) return "latestQualifier";
  if (isSnapshot(version)) return "snapshot";
  // Strictly+prefer short:  [a,b)!!c   or   (a,b]!!c
  if (/^[\[(].*[\])]!!.+$/.test(version)) return "strictlyPreferShort";
  if (/!!$/.test(version)) return "strictlyShorthand";
  if (/^[\[(].*[\])]$/.test(version)) return "mavenRange";
  if (isPrerelease(version)) return "prerelease";
  return "exact";
}
