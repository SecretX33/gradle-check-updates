// src/discover/repos.ts
import {
  tokenize as tokenizeGroovy,
  type GroovyToken,
} from "../formats/groovy-dsl/tokenize.js";
import {
  tokenize as tokenizeKotlin,
  type KotlinToken,
} from "../formats/kotlin-dsl/tokenize.js";

type AnyToken = GroovyToken | KotlinToken;

/** Well-known symbolic repository shorthands and their canonical base URLs. */
const WELL_KNOWN_REPO_URLS: Record<string, string> = {
  mavenCentral: "https://repo.maven.apache.org/maven2/",
  google: "https://maven.google.com/",
  gradlePluginPortal: "https://plugins.gradle.org/m2/",
};

/**
 * Returns the index of the closing `}` that matches the `{` at `openBraceIndex`
 * in a whitespace/comment-filtered token array. Returns -1 if no match is found.
 */
function findClosingBrace(tokens: AnyToken[], openBraceIndex: number): number {
  let braceDepth = 0;
  for (let scanIndex = openBraceIndex; scanIndex < tokens.length; scanIndex++) {
    const scanToken = tokens[scanIndex]!;
    if (scanToken.kind !== "punct") continue;
    if ((scanToken as Extract<AnyToken, { kind: "punct" }>).text === "{") {
      braceDepth++;
    } else if ((scanToken as Extract<AnyToken, { kind: "punct" }>).text === "}") {
      braceDepth--;
      if (braceDepth === 0) return scanIndex;
    }
  }
  return -1;
}

/**
 * Scans a `repositories { ... }` block (tokens from `blockStart + 1` to
 * `blockEnd - 1` inclusive) and returns the repository URLs it declares.
 *
 * Recognized patterns:
 * - `mavenCentral()` / `google()` / `gradlePluginPortal()` → well-known URLs
 * - `mavenLocal()` → ignored (local, no URL)
 * - `maven { url 'https://...' }` or `maven { url "https://..." }` → literal URL
 * - `maven { url = uri('...') }` / `maven { url = uri("...") }` → literal URL from uri()
 * - `maven("https://...")` (Kotlin DSL shorthand) → literal URL
 */
function scanRepositoriesBlock(
  tokens: AnyToken[],
  blockStart: number,
  blockEnd: number,
): string[] {
  const collectedUrls: string[] = [];

  for (let tokenIndex = blockStart + 1; tokenIndex < blockEnd; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident") continue;

    const identText = (currentToken as Extract<AnyToken, { kind: "ident" }>).text;

    // ── Well-known shorthand: mavenCentral(), google(), gradlePluginPortal() ──
    if (identText in WELL_KNOWN_REPO_URLS) {
      const wellKnownUrl = WELL_KNOWN_REPO_URLS[identText]!;
      collectedUrls.push(wellKnownUrl);
      continue;
    }

    // ── mavenLocal() — skip, no URL ───────────────────────────────────────────
    if (identText === "mavenLocal") {
      continue;
    }

    // ── maven(...) — Kotlin shorthand or maven { ... } block ─────────────────
    if (identText === "maven") {
      const nextToken = tokens[tokenIndex + 1];
      if (!nextToken) continue;

      // Kotlin shorthand: maven("https://...")
      if (
        nextToken.kind === "punct" &&
        (nextToken as Extract<AnyToken, { kind: "punct" }>).text === "("
      ) {
        const argumentToken = tokens[tokenIndex + 2];
        if (argumentToken?.kind === "string") {
          const urlString = (argumentToken as Extract<AnyToken, { kind: "string" }>).body;
          collectedUrls.push(urlString);
          continue;
        }
      }

      // Block form: maven { ... }
      if (
        nextToken.kind === "punct" &&
        (nextToken as Extract<AnyToken, { kind: "punct" }>).text === "{"
      ) {
        const mavenBlockCloseIndex = findClosingBrace(tokens, tokenIndex + 1);
        if (mavenBlockCloseIndex === -1) continue;

        const mavenBlockUrl = extractUrlFromMavenBlock(
          tokens,
          tokenIndex + 1,
          mavenBlockCloseIndex,
        );
        if (mavenBlockUrl !== null) {
          collectedUrls.push(mavenBlockUrl);
        }
        tokenIndex = mavenBlockCloseIndex;
      }
    }
  }

  return collectedUrls;
}

/**
 * Extracts the URL string from a `maven { ... }` block.
 *
 * Recognized sub-patterns:
 * - `url 'https://...'`        (bare string, Groovy)
 * - `url "https://..."`        (bare string, Groovy/Kotlin)
 * - `url = uri('...')`         (assignment with uri() call, Groovy)
 * - `url = uri("...")`         (assignment with uri() call, Kotlin)
 * - `url = "https://..."`      (direct assignment, Kotlin)
 *
 * Returns the URL string, or null if no recognizable pattern is found.
 */
function extractUrlFromMavenBlock(
  tokens: AnyToken[],
  openBraceIndex: number,
  closeBraceIndex: number,
): string | null {
  for (let tokenIndex = openBraceIndex + 1; tokenIndex < closeBraceIndex; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident") continue;

    const identText = (currentToken as Extract<AnyToken, { kind: "ident" }>).text;
    if (identText !== "url") continue;

    const afterUrlToken = tokens[tokenIndex + 1];
    if (!afterUrlToken) continue;

    // Pattern: url <string>  (no equals sign, Groovy style)
    if (afterUrlToken.kind === "string") {
      return (afterUrlToken as Extract<AnyToken, { kind: "string" }>).body;
    }

    // Pattern: url = <string> or url = uri(<string>)
    if (
      afterUrlToken.kind === "punct" &&
      (afterUrlToken as Extract<AnyToken, { kind: "punct" }>).text === "="
    ) {
      const afterEqualsToken = tokens[tokenIndex + 2];
      if (!afterEqualsToken) continue;

      // Direct assignment: url = "https://..."
      if (afterEqualsToken.kind === "string") {
        return (afterEqualsToken as Extract<AnyToken, { kind: "string" }>).body;
      }

      // uri(...) call: url = uri('...')  or  url = uri("...")
      if (
        afterEqualsToken.kind === "ident" &&
        (afterEqualsToken as Extract<AnyToken, { kind: "ident" }>).text === "uri"
      ) {
        const openParenToken = tokens[tokenIndex + 3];
        const uriArgumentToken = tokens[tokenIndex + 4];
        if (
          openParenToken?.kind === "punct" &&
          (openParenToken as Extract<AnyToken, { kind: "punct" }>).text === "(" &&
          uriArgumentToken?.kind === "string"
        ) {
          return (uriArgumentToken as Extract<AnyToken, { kind: "string" }>).body;
        }
      }
    }
  }

  return null;
}

/**
 * Extracts Maven repository base URLs declared in a `repositories { ... }` block
 * in a Groovy DSL (`build.gradle`) or Kotlin DSL (`build.gradle.kts`) file.
 *
 * Returns a deduplicated, insertion-ordered array of URL strings.
 * `mavenLocal()` is ignored (it has no network URL).
 */
export function extractRepositoryUrls(
  contents: string,
  fileType: "groovy-dsl" | "kotlin-dsl",
): string[] {
  const rawTokens =
    fileType === "groovy-dsl" ? tokenizeGroovy(contents) : tokenizeKotlin(contents);
  const tokens = rawTokens.filter(
    (token) => token.kind !== "ws" && token.kind !== "comment",
  ) as AnyToken[];

  const collectedUrls: string[] = [];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident") continue;
    if ((currentToken as Extract<AnyToken, { kind: "ident" }>).text !== "repositories")
      continue;

    const nextToken = tokens[tokenIndex + 1];
    if (
      !nextToken ||
      nextToken.kind !== "punct" ||
      (nextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
    ) {
      continue;
    }

    const repositoriesBlockCloseIndex = findClosingBrace(tokens, tokenIndex + 1);
    if (repositoriesBlockCloseIndex === -1) continue;

    const blockUrls = scanRepositoriesBlock(
      tokens,
      tokenIndex + 1,
      repositoriesBlockCloseIndex,
    );
    collectedUrls.push(...blockUrls);

    tokenIndex = repositoriesBlockCloseIndex;
  }

  // Deduplicate while preserving insertion order
  return [...new Set(collectedUrls)];
}
