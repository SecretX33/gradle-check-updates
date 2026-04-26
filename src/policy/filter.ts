import picomatch from "picomatch";

function buildMatcher(pattern: string): (input: string) => boolean {
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    const regexPattern = pattern.slice(1, -1);
    const regex = new RegExp(`^(?:${regexPattern})$`);
    return (input: string) => regex.test(input);
  }
  return picomatch(pattern);
}

export function includeExcludeFilter(
  dependencyKey: string,
  includes: string[],
  excludes: string[],
): boolean {
  const passesInclude =
    includes.length === 0 ||
    includes.some((pattern) => buildMatcher(pattern)(dependencyKey));
  const passesExclude =
    excludes.length === 0 ||
    !excludes.some((pattern) => buildMatcher(pattern)(dependencyKey));
  return passesInclude && passesExclude;
}
