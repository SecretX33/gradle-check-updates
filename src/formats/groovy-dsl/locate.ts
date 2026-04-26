// src/formats/groovy-dsl/locate.ts
import type { Occurrence } from "../../types.js";
import { detectShape } from "../../version/shape.js";
import { splitGav } from "../util.js";
import { tokenize, type GroovyToken } from "./tokenize.js";

const RICH_VERSION_CALL_NAMES = new Set(["strictly", "require", "prefer", "reject"]);

const RICH_SHAPE_MAP: Record<
  string,
  "richStrictly" | "richRequire" | "richPrefer" | "richReject"
> = {
  strictly: "richStrictly",
  require: "richRequire",
  prefer: "richPrefer",
  reject: "richReject",
};

const DEPENDENCY_CONFIG_NAMES = new Set([
  "implementation",
  "api",
  "compile",
  "compileOnly",
  "runtimeOnly",
  "testImplementation",
  "testCompile",
  "testRuntimeOnly",
  "annotationProcessor",
  "kapt",
  "ksp",
  "classpath",
  "detektPlugins",
  "androidTestImplementation",
  "debugImplementation",
  "releaseImplementation",
]);

/**
 * Extracts an Occurrence from a GAV string token body.
 *
 * For interpolated strings containing a `$varName` version placeholder,
 * emits an occurrence with a `via` pending-ref marker so downstream
 * resolution can find the actual version literal.
 *
 * Returns null if the string body is not a valid GAV coordinate.
 */
function emitFromGavString(
  file: string,
  rawBody: string,
  bodyByteStart: number,
  bodyByteEnd: number,
  isInterpolated: boolean,
): Occurrence | null {
  // Interpolated: extract var name from ":$var" or ":${var}" suffix
  const interpolationMatch = /^([^:]+):([^:]+):(?:\$\{?([A-Za-z_][\w]*)\}?)$/.exec(
    rawBody,
  );
  if (isInterpolated && interpolationMatch) {
    const [, group, artifact, varName] = interpolationMatch;
    return {
      group: group!,
      artifact: artifact!,
      file,
      byteStart: bodyByteStart,
      byteEnd: bodyByteEnd,
      fileType: "groovy-dsl",
      currentRaw: `$${varName!}`,
      shape: "exact",
      dependencyKey: `${group}:${artifact}`,
      via: [`__pending_ref__:${varName!}`],
    };
  }

  const gavParts = splitGav(rawBody);
  if (!gavParts || !gavParts.version) return null;

  const versionOffset = rawBody.lastIndexOf(gavParts.version);
  const versionByteStart =
    bodyByteStart + Buffer.byteLength(rawBody.slice(0, versionOffset), "utf8");
  const versionByteEnd = versionByteStart + Buffer.byteLength(gavParts.version, "utf8");

  return {
    group: gavParts.group,
    artifact: gavParts.artifact,
    file,
    byteStart: versionByteStart,
    byteEnd: versionByteEnd,
    fileType: "groovy-dsl",
    currentRaw: gavParts.version,
    shape: detectShape(gavParts.version),
    dependencyKey: `${gavParts.group}:${gavParts.artifact}`,
  };
}

/**
 * Returns the index of the closing `}` token that matches the opening `{` at
 * `openBraceIndex` in the filtered token array (ws and comments already
 * removed). Returns -1 if no matching brace is found.
 */
function findClosingBrace(tokens: GroovyToken[], openBraceIndex: number): number {
  let braceDepth = 0;
  for (let scanIndex = openBraceIndex; scanIndex < tokens.length; scanIndex++) {
    const scanToken = tokens[scanIndex]!;
    if (scanToken.kind !== "punct") continue;
    if (scanToken.text === "{") {
      braceDepth++;
    } else if (scanToken.text === "}") {
      braceDepth--;
      if (braceDepth === 0) return scanIndex;
    }
  }
  return -1;
}

/**
 * Scans a `version { ... }` block (tokens between `versionBlockStart` and
 * `versionBlockEnd`, exclusive) and emits one `Occurrence` per
 * `strictly`/`require`/`prefer`/`reject` call followed by a string literal.
 *
 * All emitted occurrences share `dependencyKey = "group:artifact@<blockId>`
 * where `blockId` is the stringified `byteStart` of the `version` keyword token.
 */
function scanVersionBlock(
  file: string,
  tokens: GroovyToken[],
  versionBlockStart: number,
  versionBlockEnd: number,
  group: string,
  artifact: string,
  versionKeywordByteStart: number,
): Occurrence[] {
  const blockId = String(versionKeywordByteStart);
  const dependencyKey = `${group}:${artifact}@${blockId}`;
  const richOccurrences: Occurrence[] = [];

  for (
    let blockIndex = versionBlockStart + 1;
    blockIndex < versionBlockEnd;
    blockIndex++
  ) {
    const blockToken = tokens[blockIndex]!;
    if (blockToken.kind !== "ident") continue;
    if (!RICH_VERSION_CALL_NAMES.has(blockToken.text)) continue;

    const richCallName = blockToken.text as keyof typeof RICH_SHAPE_MAP;

    // The version value may be passed as a parenthesised argument or as a bare
    // string: `strictly '1.0'` or `strictly('1.0')`.
    let valueTokenIndex = blockIndex + 1;

    // Skip optional opening paren
    const maybeOpenParen = tokens[valueTokenIndex];
    if (
      maybeOpenParen?.kind === "punct" &&
      (maybeOpenParen as Extract<GroovyToken, { kind: "punct" }>).text === "("
    ) {
      valueTokenIndex++;
    }

    const valueToken = tokens[valueTokenIndex];
    if (valueToken?.kind !== "string") continue;

    richOccurrences.push({
      group,
      artifact,
      file,
      byteStart: valueToken.bodyByteStart,
      byteEnd: valueToken.bodyByteEnd,
      fileType: "groovy-dsl",
      currentRaw: valueToken.body,
      shape: RICH_SHAPE_MAP[richCallName]!,
      dependencyKey,
    });
  }

  return richOccurrences;
}

/**
 * Emits an Occurrence for an ext/extra property definition if the value
 * string represents a rewritable version shape (not `latestQualifier`).
 *
 * Returns null when the value is not a version-shaped string.
 */
function emitExtPropertyOccurrence(
  file: string,
  extPropertyName: string,
  valueStringToken: Extract<GroovyToken, { kind: "string" }>,
): Occurrence | null {
  const versionShape = detectShape(valueStringToken.body);
  if (versionShape === "latestQualifier") return null;
  // Non-version strings (e.g. "hello") will resolve to "exact" by default, but
  // we additionally reject strings that are clearly not version-like: they must
  // contain at least one digit.
  if (!/\d/.test(valueStringToken.body)) return null;

  return {
    group: "",
    artifact: "",
    file,
    byteStart: valueStringToken.bodyByteStart,
    byteEnd: valueStringToken.bodyByteEnd,
    fileType: "groovy-dsl",
    currentRaw: valueStringToken.body,
    shape: versionShape,
    dependencyKey: `prop:${extPropertyName}`,
  };
}

/**
 * Locate all dependency version occurrences in a Groovy DSL build file.
 *
 * Handles:
 * - `<config> 'group:artifact:version'`  (single/double/triple quoted)
 * - `<config> "group:artifact:$var"`     → pending-ref marker
 * - `<config>('group:artifact:version')` (parenthesised form)
 * - `id 'pluginId' version '1.0'`        (plugins block)
 * - `ext.varName = '1.0'`                (ext dot-access property)
 * - `ext { varName = '1.0' }`            (ext block property)
 * - `project.ext.varName = '1.0'`        (project-prefixed ext property)
 * - `extra["varName"] = "1.0"`           (extra map property)
 */
export function locateGroovy(file: string, contents: string): Occurrence[] {
  const tokens = tokenize(contents).filter(
    (token) => token.kind !== "ws" && token.kind !== "comment",
  );
  const occurrences: Occurrence[] = [];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;

    // ── Dependency configuration: <config> '<gav>' ──────────────────────────
    if (currentToken.kind === "ident" && DEPENDENCY_CONFIG_NAMES.has(currentToken.text)) {
      let lookAhead = tokenIndex + 1;

      // Skip optional opening paren
      if (
        tokens[lookAhead]?.kind === "punct" &&
        (tokens[lookAhead] as Extract<GroovyToken, { kind: "punct" }>).text === "("
      ) {
        lookAhead++;
      }

      const argToken = tokens[lookAhead];
      if (argToken?.kind === "string") {
        const occurrence = emitFromGavString(
          file,
          argToken.body,
          argToken.bodyByteStart,
          argToken.bodyByteEnd,
          argToken.interpolated,
        );
        if (occurrence) {
          occurrences.push(occurrence);
        } else {
          // 2-part GAV (no version in string) — look ahead for a rich version block.
          // Pattern: <config>('g:a') { version { strictly '...'; ... } }
          const gavParts = splitGav(argToken.body);
          if (gavParts && !gavParts.version) {
            // After the string token (and optional closing paren), expect `{`
            let closureSearchIndex = lookAhead + 1;

            // Skip optional closing paren from parenthesised call
            const maybeCloseParen = tokens[closureSearchIndex];
            if (
              maybeCloseParen?.kind === "punct" &&
              (maybeCloseParen as Extract<GroovyToken, { kind: "punct" }>).text === ")"
            ) {
              closureSearchIndex++;
            }

            const depClosureOpenToken = tokens[closureSearchIndex];
            if (
              depClosureOpenToken?.kind === "punct" &&
              (depClosureOpenToken as Extract<GroovyToken, { kind: "punct" }>).text ===
                "{"
            ) {
              const depClosureCloseIndex = findClosingBrace(tokens, closureSearchIndex);
              if (depClosureCloseIndex !== -1) {
                // Scan within dependency closure for `version { ... }`
                for (
                  let innerIndex = closureSearchIndex + 1;
                  innerIndex < depClosureCloseIndex;
                  innerIndex++
                ) {
                  const innerToken = tokens[innerIndex]!;
                  if (innerToken.kind !== "ident" || innerToken.text !== "version")
                    continue;

                  const versionBlockOpenToken = tokens[innerIndex + 1];
                  if (
                    versionBlockOpenToken?.kind === "punct" &&
                    (versionBlockOpenToken as Extract<GroovyToken, { kind: "punct" }>)
                      .text === "{"
                  ) {
                    const versionBlockCloseIndex = findClosingBrace(
                      tokens,
                      innerIndex + 1,
                    );
                    if (versionBlockCloseIndex !== -1) {
                      const richBlockOccurrences = scanVersionBlock(
                        file,
                        tokens,
                        innerIndex + 1,
                        versionBlockCloseIndex,
                        gavParts.group,
                        gavParts.artifact,
                        innerToken.byteStart,
                      );
                      occurrences.push(...richBlockOccurrences);
                    }
                  }
                }
              }
            }
          }
        }
      }
      continue;
    }

    // ── ext property patterns ────────────────────────────────────────────────
    //
    // Pattern 3: `project . ext . <ident> = <string>`
    // We detect this by checking: ident("project") → punct(".") → ident("ext")
    // → punct(".") → ident(varName) → punct("=") → string
    if (currentToken.kind === "ident" && currentToken.text === "project") {
      const dotAfterProject = tokens[tokenIndex + 1];
      const extAfterProject = tokens[tokenIndex + 2];
      if (
        dotAfterProject?.kind === "punct" &&
        (dotAfterProject as Extract<GroovyToken, { kind: "punct" }>).text === "." &&
        extAfterProject?.kind === "ident" &&
        (extAfterProject as Extract<GroovyToken, { kind: "ident" }>).text === "ext"
      ) {
        const dotAfterExt = tokens[tokenIndex + 3];
        const propertyNameToken = tokens[tokenIndex + 4];
        const equalsToken = tokens[tokenIndex + 5];
        const valueToken = tokens[tokenIndex + 6];
        if (
          dotAfterExt?.kind === "punct" &&
          (dotAfterExt as Extract<GroovyToken, { kind: "punct" }>).text === "." &&
          propertyNameToken?.kind === "ident" &&
          equalsToken?.kind === "punct" &&
          (equalsToken as Extract<GroovyToken, { kind: "punct" }>).text === "=" &&
          valueToken?.kind === "string"
        ) {
          const extPropertyName = (
            propertyNameToken as Extract<GroovyToken, { kind: "ident" }>
          ).text;
          const valueStringToken = valueToken as Extract<GroovyToken, { kind: "string" }>;
          const extOccurrence = emitExtPropertyOccurrence(
            file,
            extPropertyName,
            valueStringToken,
          );
          if (extOccurrence) occurrences.push(extOccurrence);
        }
        continue;
      }
    }

    // ── ext dot-access and ext block ─────────────────────────────────────────
    if (currentToken.kind === "ident" && currentToken.text === "ext") {
      const nextToken = tokens[tokenIndex + 1];

      // Pattern 1: `ext . <ident> = <string>`
      if (
        nextToken?.kind === "punct" &&
        (nextToken as Extract<GroovyToken, { kind: "punct" }>).text === "."
      ) {
        const propertyNameToken = tokens[tokenIndex + 2];
        const equalsToken = tokens[tokenIndex + 3];
        const valueToken = tokens[tokenIndex + 4];
        if (
          propertyNameToken?.kind === "ident" &&
          equalsToken?.kind === "punct" &&
          (equalsToken as Extract<GroovyToken, { kind: "punct" }>).text === "=" &&
          valueToken?.kind === "string"
        ) {
          const extPropertyName = (
            propertyNameToken as Extract<GroovyToken, { kind: "ident" }>
          ).text;
          const valueStringToken = valueToken as Extract<GroovyToken, { kind: "string" }>;
          const extOccurrence = emitExtPropertyOccurrence(
            file,
            extPropertyName,
            valueStringToken,
          );
          if (extOccurrence) occurrences.push(extOccurrence);
        }
        continue;
      }

      // Pattern 2: `ext { <ident> = <string> ... }`
      if (
        nextToken?.kind === "punct" &&
        (nextToken as Extract<GroovyToken, { kind: "punct" }>).text === "{"
      ) {
        const extBlockCloseIndex = findClosingBrace(tokens, tokenIndex + 1);
        if (extBlockCloseIndex !== -1) {
          for (
            let blockIndex = tokenIndex + 2;
            blockIndex < extBlockCloseIndex;
            blockIndex++
          ) {
            const blockPropertyNameToken = tokens[blockIndex];
            const blockEqualsToken = tokens[blockIndex + 1];
            const blockValueToken = tokens[blockIndex + 2];
            if (
              blockPropertyNameToken?.kind === "ident" &&
              blockEqualsToken?.kind === "punct" &&
              (blockEqualsToken as Extract<GroovyToken, { kind: "punct" }>).text ===
                "=" &&
              blockValueToken?.kind === "string"
            ) {
              const extPropertyName = (
                blockPropertyNameToken as Extract<GroovyToken, { kind: "ident" }>
              ).text;
              const valueStringToken = blockValueToken as Extract<
                GroovyToken,
                { kind: "string" }
              >;
              const extOccurrence = emitExtPropertyOccurrence(
                file,
                extPropertyName,
                valueStringToken,
              );
              if (extOccurrence) occurrences.push(extOccurrence);
            }
          }
        }
        continue;
      }
    }

    // ── extra["varName"] = <string> ──────────────────────────────────────────
    //
    // Pattern 4: `extra [ <string-key> ] = <string-value>`
    if (currentToken.kind === "ident" && currentToken.text === "extra") {
      const openBracketToken = tokens[tokenIndex + 1];
      const keyStringToken = tokens[tokenIndex + 2];
      const closeBracketToken = tokens[tokenIndex + 3];
      const equalsToken = tokens[tokenIndex + 4];
      const valueToken = tokens[tokenIndex + 5];
      if (
        openBracketToken?.kind === "punct" &&
        (openBracketToken as Extract<GroovyToken, { kind: "punct" }>).text === "[" &&
        keyStringToken?.kind === "string" &&
        closeBracketToken?.kind === "punct" &&
        (closeBracketToken as Extract<GroovyToken, { kind: "punct" }>).text === "]" &&
        equalsToken?.kind === "punct" &&
        (equalsToken as Extract<GroovyToken, { kind: "punct" }>).text === "=" &&
        valueToken?.kind === "string"
      ) {
        const extPropertyName = (
          keyStringToken as Extract<GroovyToken, { kind: "string" }>
        ).body;
        const valueStringToken = valueToken as Extract<GroovyToken, { kind: "string" }>;
        const extOccurrence = emitExtPropertyOccurrence(
          file,
          extPropertyName,
          valueStringToken,
        );
        if (extOccurrence) occurrences.push(extOccurrence);
      }
      continue;
    }

    // ── Plugins block: id <string> version <string> ──────────────────────────
    if (currentToken.kind === "ident" && currentToken.text === "id") {
      let lookAhead = tokenIndex + 1;

      // Skip optional opening paren
      if (
        tokens[lookAhead]?.kind === "punct" &&
        (tokens[lookAhead] as Extract<GroovyToken, { kind: "punct" }>).text === "("
      ) {
        lookAhead++;
      }

      const pluginIdToken = tokens[lookAhead];
      if (pluginIdToken?.kind !== "string") continue;

      let versionLookAhead = lookAhead + 1;

      // Skip optional closing paren after the id string
      if (
        tokens[versionLookAhead]?.kind === "punct" &&
        (tokens[versionLookAhead] as Extract<GroovyToken, { kind: "punct" }>).text === ")"
      ) {
        versionLookAhead++;
      }

      const versionKeywordToken = tokens[versionLookAhead];
      if (
        versionKeywordToken?.kind !== "ident" ||
        versionKeywordToken.text !== "version"
      ) {
        continue;
      }

      const versionStringToken = tokens[versionLookAhead + 1];
      if (versionStringToken?.kind !== "string") continue;

      const pluginGroup = pluginIdToken.body;
      occurrences.push({
        group: pluginGroup,
        artifact: `${pluginGroup}.gradle.plugin`,
        file,
        byteStart: versionStringToken.bodyByteStart,
        byteEnd: versionStringToken.bodyByteEnd,
        fileType: "groovy-dsl",
        currentRaw: versionStringToken.body,
        shape: detectShape(versionStringToken.body),
        dependencyKey: `${pluginGroup}:${pluginGroup}.gradle.plugin`,
      });
    }
  }

  return occurrences;
}
