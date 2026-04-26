// src/discover/settings.ts
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  tokenize as tokenizeKotlin,
  type KotlinToken,
} from "../formats/kotlin-dsl/tokenize.js";
import {
  tokenize as tokenizeGroovy,
  type GroovyToken,
} from "../formats/groovy-dsl/tokenize.js";

type AnyToken = KotlinToken | GroovyToken;

/** Well-known symbolic repository shorthands and their canonical base URLs. */
const WELL_KNOWN_REPO_URLS: Record<string, string> = {
  mavenCentral: "https://repo.maven.apache.org/maven2/",
  google: "https://maven.google.com/",
  gradlePluginPortal: "https://plugins.gradle.org/m2/",
};

export type SettingsParseResult = {
  /** Version catalog files declared via versionCatalogs { create("name") { from(files("path")) } } */
  catalogFiles: { name: string; path: string }[];
  /** Repository URLs from pluginManagement { repositories { ... } }, deduplicated, insertion-ordered */
  pluginRepositories: string[];
  /** Repository URLs from dependencyResolutionManagement { repositories { ... } }, deduplicated, insertion-ordered */
  dependencyRepositories: string[];
  /**
   * Byte ranges of the inner `plugins { ... }` block found inside
   * `pluginManagement { plugins { ... } }`.
   *
   * Range is INCLUSIVE of the braces: byteStart points at `{` and byteEnd points
   * at the byte immediately after `}` (exclusive end), consistent with how block
   * ranges are used in the rest of this codebase.
   */
  pluginOccurrenceBlocks: { byteStart: number; byteEnd: number }[];
};

/**
 * Returns the index of the closing `}` that matches the `{` at `openBraceIndex`
 * in a whitespace/comment-filtered token array. Returns -1 if no match found.
 */
function findClosingBrace(tokens: AnyToken[], openBraceIndex: number): number {
  let braceDepth = 0;
  for (let scanIndex = openBraceIndex; scanIndex < tokens.length; scanIndex++) {
    const scanToken = tokens[scanIndex]!;
    if (scanToken.kind !== "punct") continue;
    const punctText = (scanToken as Extract<AnyToken, { kind: "punct" }>).text;
    if (punctText === "{") {
      braceDepth++;
    } else if (punctText === "}") {
      braceDepth--;
      if (braceDepth === 0) return scanIndex;
    }
  }
  return -1;
}

/**
 * Scans a `repositories { ... }` block and returns the repository URLs it declares.
 *
 * Recognized patterns (same as repos.ts scanRepositoriesBlock):
 * - `mavenCentral()` / `google()` / `gradlePluginPortal()` → well-known URLs
 * - `mavenLocal()` → silently dropped
 * - `maven("https://...")` → literal URL (Kotlin shorthand)
 * - `maven { url 'https://...' }` / `maven { url "https://..." }` → Groovy bare string
 * - `maven { url = uri("...") }` / `maven { url = "..." }` → Kotlin assignment
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

    if (identText in WELL_KNOWN_REPO_URLS) {
      collectedUrls.push(WELL_KNOWN_REPO_URLS[identText]!);
      continue;
    }

    if (identText === "mavenLocal") {
      continue;
    }

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
 * - `url 'https://...'`     (bare string, Groovy)
 * - `url "https://..."`     (bare string, Groovy/Kotlin)
 * - `url = uri('...')`      (assignment with uri() call, Groovy)
 * - `url = uri("...")`      (assignment with uri() call, Kotlin)
 * - `url = "https://..."`   (direct assignment, Kotlin)
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

    // Pattern: url <string>  (Groovy bare form)
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

      // uri(...) call: url = uri("...") or url = uri('...')
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
 * Scans a `versionCatalogs { ... }` block for `create("name") { from(files("path")) }`
 * entries. Returns resolved catalog file entries.
 *
 * - `from(files("path"))` → emits an entry
 * - `from("group:artifact:version")` → ignored with a console.warn
 */
function scanVersionCatalogsBlock(
  tokens: AnyToken[],
  blockStart: number,
  blockEnd: number,
  settingsDir: string,
  settingsBasename: string,
): { name: string; path: string }[] {
  const catalogFiles: { name: string; path: string }[] = [];

  for (let tokenIndex = blockStart + 1; tokenIndex < blockEnd; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident") continue;

    const identText = (currentToken as Extract<AnyToken, { kind: "ident" }>).text;
    if (identText !== "create") continue;

    // create("name") { ... }
    // Next tokens: ( "name" ) {
    const openParenToken = tokens[tokenIndex + 1];
    const nameStringToken = tokens[tokenIndex + 2];
    const closeParenToken = tokens[tokenIndex + 3];
    const openBraceToken = tokens[tokenIndex + 4];

    if (
      !openParenToken ||
      openParenToken.kind !== "punct" ||
      (openParenToken as Extract<AnyToken, { kind: "punct" }>).text !== "("
    )
      continue;

    if (!nameStringToken || nameStringToken.kind !== "string") continue;
    const catalogName = (nameStringToken as Extract<AnyToken, { kind: "string" }>).body;

    if (
      !closeParenToken ||
      closeParenToken.kind !== "punct" ||
      (closeParenToken as Extract<AnyToken, { kind: "punct" }>).text !== ")"
    )
      continue;

    if (
      !openBraceToken ||
      openBraceToken.kind !== "punct" ||
      (openBraceToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
    )
      continue;

    const createBlockCloseIndex = findClosingBrace(tokens, tokenIndex + 4);
    if (createBlockCloseIndex === -1) continue;

    // Scan inside create { ... } for from(files("path")) or from("group:artifact:version")
    const catalogEntry = scanCreateBlock(
      tokens,
      tokenIndex + 4,
      createBlockCloseIndex,
      catalogName,
      settingsDir,
      settingsBasename,
    );

    if (catalogEntry !== null) {
      catalogFiles.push(catalogEntry);
    }

    tokenIndex = createBlockCloseIndex;
  }

  return catalogFiles;
}

/**
 * Scans a `create("name") { ... }` block for `from(files("path"))` or `from("...")`.
 * Returns a catalog entry if `from(files("path"))` is found, null otherwise.
 * Warns via console.warn if a published catalog (`from("group:artifact:version")`) is found.
 */
function scanCreateBlock(
  tokens: AnyToken[],
  openBraceIndex: number,
  closeBraceIndex: number,
  catalogName: string,
  settingsDir: string,
  settingsBasename: string,
): { name: string; path: string } | null {
  for (let tokenIndex = openBraceIndex + 1; tokenIndex < closeBraceIndex; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident") continue;

    const identText = (currentToken as Extract<AnyToken, { kind: "ident" }>).text;
    if (identText !== "from") continue;

    // from( ... )
    const openParenToken = tokens[tokenIndex + 1];
    if (
      !openParenToken ||
      openParenToken.kind !== "punct" ||
      (openParenToken as Extract<AnyToken, { kind: "punct" }>).text !== "("
    )
      continue;

    const firstArgumentToken = tokens[tokenIndex + 2];
    if (!firstArgumentToken) continue;

    // from(files("path")) — files(...) call
    if (
      firstArgumentToken.kind === "ident" &&
      (firstArgumentToken as Extract<AnyToken, { kind: "ident" }>).text === "files"
    ) {
      const filesOpenParenToken = tokens[tokenIndex + 3];
      const filesPathStringToken = tokens[tokenIndex + 4];

      if (
        filesOpenParenToken?.kind === "punct" &&
        (filesOpenParenToken as Extract<AnyToken, { kind: "punct" }>).text === "(" &&
        filesPathStringToken?.kind === "string"
      ) {
        const declaredPath = (
          filesPathStringToken as Extract<AnyToken, { kind: "string" }>
        ).body;
        const resolvedPath = resolve(settingsDir, declaredPath);
        return { name: catalogName, path: resolvedPath };
      }
      continue;
    }

    // from("group:artifact:version") — published catalog, warn and ignore
    if (firstArgumentToken.kind === "string") {
      const publishedCoordinate = (
        firstArgumentToken as Extract<AnyToken, { kind: "string" }>
      ).body;
      console.warn(
        `[gcu] ${settingsBasename}: published catalog "${catalogName}" uses from("${publishedCoordinate}") — published catalogs are not supported in v1 and will be ignored`,
      );
      continue;
    }
  }

  return null;
}

/**
 * Parses a `settings.gradle.kts` or `settings.gradle` file and extracts:
 * - Version catalog declarations (`versionCatalogs { create(...) { from(files(...)) } }`)
 * - Plugin repository URLs (`pluginManagement { repositories { ... } }`)
 * - Dependency repository URLs (`dependencyResolutionManagement { repositories { ... } }`)
 * - Byte ranges of `pluginManagement { plugins { ... } }` inner blocks
 *
 * The file is read with UTF-8 encoding. If the file does not exist, the underlying
 * error is re-thrown for the caller to handle.
 */
export async function parseSettingsFile(filePath: string): Promise<SettingsParseResult> {
  const contents = await readFile(filePath, "utf8");
  const settingsDir = dirname(filePath);
  const settingsFilename = basename(filePath);
  const isKotlin = filePath.endsWith(".kts");

  const rawTokens = isKotlin ? tokenizeKotlin(contents) : tokenizeGroovy(contents);
  const tokens = rawTokens.filter(
    (token) => token.kind !== "ws" && token.kind !== "comment",
  ) as AnyToken[];

  const catalogFiles: { name: string; path: string }[] = [];
  const pluginRepositories: string[] = [];
  const dependencyRepositories: string[] = [];
  const pluginOccurrenceBlocks: { byteStart: number; byteEnd: number }[] = [];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident") continue;

    const identText = (currentToken as Extract<AnyToken, { kind: "ident" }>).text;

    // ── versionCatalogs { ... } ───────────────────────────────────────────
    if (identText === "versionCatalogs") {
      const nextToken = tokens[tokenIndex + 1];
      if (
        !nextToken ||
        nextToken.kind !== "punct" ||
        (nextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
      )
        continue;

      const catalogsBlockCloseIndex = findClosingBrace(tokens, tokenIndex + 1);
      if (catalogsBlockCloseIndex === -1) continue;

      const entries = scanVersionCatalogsBlock(
        tokens,
        tokenIndex + 1,
        catalogsBlockCloseIndex,
        settingsDir,
        settingsFilename,
      );
      catalogFiles.push(...entries);
      tokenIndex = catalogsBlockCloseIndex;
      continue;
    }

    // ── pluginManagement { ... } ─────────────────────────────────────────
    if (identText === "pluginManagement") {
      const nextToken = tokens[tokenIndex + 1];
      if (
        !nextToken ||
        nextToken.kind !== "punct" ||
        (nextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
      )
        continue;

      const pluginMgmtOpenIndex = tokenIndex + 1;
      const pluginMgmtCloseIndex = findClosingBrace(tokens, pluginMgmtOpenIndex);
      if (pluginMgmtCloseIndex === -1) continue;

      // Scan inside pluginManagement for repositories { ... } and plugins { ... }
      for (
        let innerIndex = pluginMgmtOpenIndex + 1;
        innerIndex < pluginMgmtCloseIndex;
        innerIndex++
      ) {
        const innerToken = tokens[innerIndex]!;
        if (innerToken.kind !== "ident") continue;

        const innerIdentText = (innerToken as Extract<AnyToken, { kind: "ident" }>).text;

        if (innerIdentText === "repositories") {
          const repoNextToken = tokens[innerIndex + 1];
          if (
            !repoNextToken ||
            repoNextToken.kind !== "punct" ||
            (repoNextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
          )
            continue;

          const reposBlockCloseIndex = findClosingBrace(tokens, innerIndex + 1);
          if (reposBlockCloseIndex === -1) continue;

          const repoUrls = scanRepositoriesBlock(
            tokens,
            innerIndex + 1,
            reposBlockCloseIndex,
          );
          pluginRepositories.push(...repoUrls);
          innerIndex = reposBlockCloseIndex;
          continue;
        }

        if (innerIdentText === "plugins") {
          const pluginsNextToken = tokens[innerIndex + 1];
          if (
            !pluginsNextToken ||
            pluginsNextToken.kind !== "punct" ||
            (pluginsNextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
          )
            continue;

          const pluginsCloseIndex = findClosingBrace(tokens, innerIndex + 1);
          if (pluginsCloseIndex === -1) continue;

          const pluginsCloseToken = tokens[pluginsCloseIndex]!;

          // byteStart is the start of `{`, byteEnd is the end (exclusive) of `}`
          // This is inclusive-of-braces: byteStart points at `{`, byteEnd points
          // one byte past `}`.
          pluginOccurrenceBlocks.push({
            byteStart: pluginsNextToken.byteStart,
            byteEnd: pluginsCloseToken.byteEnd,
          });

          innerIndex = pluginsCloseIndex;
        }
      }

      tokenIndex = pluginMgmtCloseIndex;
      continue;
    }

    // ── dependencyResolutionManagement { ... } ───────────────────────────
    if (identText === "dependencyResolutionManagement") {
      const nextToken = tokens[tokenIndex + 1];
      if (
        !nextToken ||
        nextToken.kind !== "punct" ||
        (nextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
      )
        continue;

      const drmOpenIndex = tokenIndex + 1;
      const drmCloseIndex = findClosingBrace(tokens, drmOpenIndex);
      if (drmCloseIndex === -1) continue;

      // Scan inside dependencyResolutionManagement for repositories and versionCatalogs
      for (let innerIndex = drmOpenIndex + 1; innerIndex < drmCloseIndex; innerIndex++) {
        const innerToken = tokens[innerIndex]!;
        if (innerToken.kind !== "ident") continue;

        const innerIdentText = (innerToken as Extract<AnyToken, { kind: "ident" }>).text;

        if (innerIdentText === "repositories") {
          const repoNextToken = tokens[innerIndex + 1];
          if (
            !repoNextToken ||
            repoNextToken.kind !== "punct" ||
            (repoNextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
          )
            continue;

          const reposBlockCloseIndex = findClosingBrace(tokens, innerIndex + 1);
          if (reposBlockCloseIndex === -1) continue;

          const repoUrls = scanRepositoriesBlock(
            tokens,
            innerIndex + 1,
            reposBlockCloseIndex,
          );
          dependencyRepositories.push(...repoUrls);
          innerIndex = reposBlockCloseIndex;
          continue;
        }

        if (innerIdentText === "versionCatalogs") {
          const catalogsNextToken = tokens[innerIndex + 1];
          if (
            !catalogsNextToken ||
            catalogsNextToken.kind !== "punct" ||
            (catalogsNextToken as Extract<AnyToken, { kind: "punct" }>).text !== "{"
          )
            continue;

          const catalogsBlockCloseIndex = findClosingBrace(tokens, innerIndex + 1);
          if (catalogsBlockCloseIndex === -1) continue;

          const entries = scanVersionCatalogsBlock(
            tokens,
            innerIndex + 1,
            catalogsBlockCloseIndex,
            settingsDir,
            settingsFilename,
          );
          catalogFiles.push(...entries);
          innerIndex = catalogsBlockCloseIndex;
        }
      }

      tokenIndex = drmCloseIndex;
      continue;
    }
  }

  return {
    catalogFiles,
    pluginRepositories: [...new Set(pluginRepositories)],
    dependencyRepositories: [...new Set(dependencyRepositories)],
    pluginOccurrenceBlocks,
  };
}
