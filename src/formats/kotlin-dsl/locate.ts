// src/formats/kotlin-dsl/locate.ts
import type { Occurrence } from "../../types.js";
import { detectShape } from "../../version/shape.js";
import { splitGav } from "../util.js";
import { tokenize, type KotlinToken } from "./tokenize.js";

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
  "force",
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
      fileType: "kotlin-dsl",
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
    fileType: "kotlin-dsl",
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
function findClosingBrace(tokens: KotlinToken[], openBraceIndex: number): number {
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
  tokens: KotlinToken[],
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

    // In Kotlin DSL, rich version calls always use parens (strictly("1.0")),
    // but we skip the paren defensively so malformed files don't silently miss an occurrence.
    let valueTokenIndex = blockIndex + 1;

    const maybeOpenParen = tokens[valueTokenIndex];
    if (
      maybeOpenParen?.kind === "punct" &&
      (maybeOpenParen as Extract<KotlinToken, { kind: "punct" }>).text === "("
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
      fileType: "kotlin-dsl",
      currentRaw: valueToken.body,
      shape: RICH_SHAPE_MAP[richCallName]!,
      dependencyKey,
    });
  }

  return richOccurrences;
}

/**
 * Emits an Occurrence for a property definition if the value string represents
 * a rewritable version shape (not `latestQualifier`).
 *
 * Returns null when the value is not a version-shaped string.
 */
function emitPropertyOccurrence(
  file: string,
  propertyName: string,
  valueStringToken: Extract<KotlinToken, { kind: "string" }>,
): Occurrence | null {
  const versionShape = detectShape(valueStringToken.body);
  if (versionShape === "latestQualifier") return null;
  // Non-version strings must contain at least one digit to be considered version-like.
  if (!/\d/.test(valueStringToken.body)) return null;

  return {
    group: "",
    artifact: "",
    file,
    byteStart: valueStringToken.bodyByteStart,
    byteEnd: valueStringToken.bodyByteEnd,
    fileType: "kotlin-dsl",
    currentRaw: valueStringToken.body,
    shape: versionShape,
    dependencyKey: `prop:${propertyName}`,
  };
}

/**
 * Scans `contents` (a settings.gradle.kts file) and returns the byte ranges of
 * all `plugins { ... }` blocks found INSIDE `pluginManagement { ... }`.
 *
 * Each returned range is inclusive of the braces: `byteStart` points at the
 * opening `{` byte and `byteEnd` is one byte past the closing `}`, consistent
 * with how `parseSettingsFile` reports these ranges.
 */
function findPluginManagementBlocks(
  contents: string,
): Array<{ byteStart: number; byteEnd: number }> {
  const tokens = tokenize(contents).filter(
    (token) => token.kind !== "ws" && token.kind !== "comment",
  );
  const pluginMgmtBlocks: Array<{ byteStart: number; byteEnd: number }> = [];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;
    if (currentToken.kind !== "ident" || currentToken.text !== "pluginManagement") {
      continue;
    }

    const openBraceToken = tokens[tokenIndex + 1];
    if (
      openBraceToken?.kind !== "punct" ||
      (openBraceToken as Extract<KotlinToken, { kind: "punct" }>).text !== "{"
    ) {
      continue;
    }

    const pluginMgmtOpenIndex = tokenIndex + 1;
    const pluginMgmtCloseIndex = findClosingBrace(tokens, pluginMgmtOpenIndex);
    if (pluginMgmtCloseIndex === -1) continue;

    // Scan inside pluginManagement { ... } for plugins { ... }
    for (
      let innerIndex = pluginMgmtOpenIndex + 1;
      innerIndex < pluginMgmtCloseIndex;
      innerIndex++
    ) {
      const innerToken = tokens[innerIndex]!;
      if (innerToken.kind !== "ident" || innerToken.text !== "plugins") continue;

      const pluginsOpenToken = tokens[innerIndex + 1];
      if (
        pluginsOpenToken?.kind !== "punct" ||
        (pluginsOpenToken as Extract<KotlinToken, { kind: "punct" }>).text !== "{"
      ) {
        continue;
      }

      const pluginsCloseIndex = findClosingBrace(tokens, innerIndex + 1);
      if (pluginsCloseIndex === -1) continue;

      const pluginsCloseToken = tokens[pluginsCloseIndex]!;
      pluginMgmtBlocks.push({
        byteStart: pluginsOpenToken.byteStart,
        byteEnd: pluginsCloseToken.byteEnd,
      });

      innerIndex = pluginsCloseIndex;
    }

    tokenIndex = pluginMgmtCloseIndex;
  }

  return pluginMgmtBlocks;
}

/**
 * Returns true when `byteStart` falls within any of the given block ranges
 * (inclusive of both endpoints).
 */
function isInPluginManagementBlock(
  byteStart: number,
  blocks: Array<{ byteStart: number; byteEnd: number }>,
): boolean {
  return blocks.some(
    (block) => byteStart >= block.byteStart && byteStart < block.byteEnd,
  );
}

/**
 * Locate all dependency version occurrences in a Kotlin DSL build file (.kts).
 *
 * Handles:
 * - `<config>("group:artifact:version")`       (parenthesised form, required in Kotlin)
 * - `<config>("group:artifact:$var")`          → pending-ref marker
 * - `id("pluginId") version "1.0"`            (plugins block)
 * - `val varName = "1.0"`                      (val property definition)
 * - `extra["varName"] = "1.0"`                (extra map property)
 * - `val varName by extra("1.0")`             (extra delegation syntax)
 *
 * When `file` ends with `settings.gradle.kts`, occurrences whose `byteStart`
 * falls inside a `pluginManagement { plugins { ... } }` block are tagged with
 * `via: ["pluginManagement"]`.
 */
export function locateKotlin(file: string, contents: string): Occurrence[] {
  const isSettingsFile = file.endsWith("settings.gradle.kts");
  const pluginMgmtBlocks = isSettingsFile ? findPluginManagementBlocks(contents) : [];

  const tokens = tokenize(contents).filter(
    (token) => token.kind !== "ws" && token.kind !== "comment",
  );
  const occurrences: Occurrence[] = [];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const currentToken = tokens[tokenIndex]!;

    // ── Dependency configuration: <config>("gav") ────────────────────────────
    // In Kotlin DSL, parens are always required (no bare call syntax).
    if (currentToken.kind === "ident" && DEPENDENCY_CONFIG_NAMES.has(currentToken.text)) {
      const openParenToken = tokens[tokenIndex + 1];
      if (
        openParenToken?.kind !== "punct" ||
        (openParenToken as Extract<KotlinToken, { kind: "punct" }>).text !== "("
      ) {
        continue;
      }

      const argToken = tokens[tokenIndex + 2];
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
          // 2-part GAV (no version) — look for a rich version block.
          // Pattern: <config>("g:a") { version { strictly("..."); ... } }
          const gavParts = splitGav(argToken.body);
          if (gavParts && !gavParts.version) {
            // After the string token, expect `)` then `{`
            let closureSearchIndex = tokenIndex + 3;

            // Skip closing paren from parenthesised call
            const maybeCloseParen = tokens[closureSearchIndex];
            if (
              maybeCloseParen?.kind === "punct" &&
              (maybeCloseParen as Extract<KotlinToken, { kind: "punct" }>).text === ")"
            ) {
              closureSearchIndex++;
            }

            const depClosureOpenToken = tokens[closureSearchIndex];
            if (
              depClosureOpenToken?.kind === "punct" &&
              (depClosureOpenToken as Extract<KotlinToken, { kind: "punct" }>).text ===
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
                    (versionBlockOpenToken as Extract<KotlinToken, { kind: "punct" }>)
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
      } else if (
        argToken?.kind === "ident" &&
        (argToken as Extract<KotlinToken, { kind: "ident" }>).text === "kotlin"
      ) {
        // Pattern: <config>(kotlin("name", "version"))
        // Tokens: <config> ( kotlin ( "name" , "version" ) )
        //         +0       +1 +2     +3 +4     +5 +6       +7 +8
        const kotlinOpenParen = tokens[tokenIndex + 3];
        const nameToken = tokens[tokenIndex + 4];
        const commaToken = tokens[tokenIndex + 5];
        const versionStringToken = tokens[tokenIndex + 6];
        const kotlinCloseParen = tokens[tokenIndex + 7];
        const outerCloseParen = tokens[tokenIndex + 8];

        if (
          kotlinOpenParen?.kind === "punct" &&
          (kotlinOpenParen as Extract<KotlinToken, { kind: "punct" }>).text === "(" &&
          nameToken?.kind === "string" &&
          commaToken?.kind === "punct" &&
          (commaToken as Extract<KotlinToken, { kind: "punct" }>).text === "," &&
          versionStringToken?.kind === "string" &&
          !(versionStringToken as Extract<KotlinToken, { kind: "string" }>)
            .interpolated &&
          kotlinCloseParen?.kind === "punct" &&
          (kotlinCloseParen as Extract<KotlinToken, { kind: "punct" }>).text === ")" &&
          outerCloseParen?.kind === "punct" &&
          (outerCloseParen as Extract<KotlinToken, { kind: "punct" }>).text === ")"
        ) {
          const artifactName = (nameToken as Extract<KotlinToken, { kind: "string" }>)
            .body;
          const group = "org.jetbrains.kotlin";
          const artifact = `kotlin-${artifactName}`;
          const versionToken = versionStringToken as Extract<
            KotlinToken,
            { kind: "string" }
          >;
          occurrences.push({
            group,
            artifact,
            file,
            byteStart: versionToken.bodyByteStart,
            byteEnd: versionToken.bodyByteEnd,
            fileType: "kotlin-dsl",
            currentRaw: versionToken.body,
            shape: detectShape(versionToken.body),
            dependencyKey: `${group}:${artifact}`,
          });
        }
      } else if (
        argToken?.kind === "ident" &&
        ((argToken as Extract<KotlinToken, { kind: "ident" }>).text === "platform" ||
          (argToken as Extract<KotlinToken, { kind: "ident" }>).text ===
            "enforcedPlatform")
      ) {
        // Pattern: <config>(platform("g:a:v"))
        // Tokens: <config> ( platform ( "g:a:v" ) )
        //         +0       +1 +2       +3 +4     +5 +6
        const platformOpenParen = tokens[tokenIndex + 3];
        const gavStringToken = tokens[tokenIndex + 4];
        const platformCloseParen = tokens[tokenIndex + 5];
        const platformOuterCloseParen = tokens[tokenIndex + 6];

        if (
          platformOpenParen?.kind === "punct" &&
          (platformOpenParen as Extract<KotlinToken, { kind: "punct" }>).text === "(" &&
          gavStringToken?.kind === "string" &&
          platformCloseParen?.kind === "punct" &&
          (platformCloseParen as Extract<KotlinToken, { kind: "punct" }>).text === ")" &&
          platformOuterCloseParen?.kind === "punct" &&
          (platformOuterCloseParen as Extract<KotlinToken, { kind: "punct" }>).text ===
            ")"
        ) {
          const gavToken = gavStringToken as Extract<KotlinToken, { kind: "string" }>;
          const occurrence = emitFromGavString(
            file,
            gavToken.body,
            gavToken.bodyByteStart,
            gavToken.bodyByteEnd,
            gavToken.interpolated,
          );
          if (occurrence) {
            occurrences.push(occurrence);
          }
        }
      }
      continue;
    }

    // ── val varName = "1.0" ──────────────────────────────────────────────────
    // Also covers: val varName by extra("1.0")
    if (currentToken.kind === "ident" && currentToken.text === "val") {
      const propertyNameToken = tokens[tokenIndex + 1];
      if (propertyNameToken?.kind !== "ident") continue;

      const propertyName = (propertyNameToken as Extract<KotlinToken, { kind: "ident" }>)
        .text;
      const afterPropertyName = tokens[tokenIndex + 2];

      // Pattern: val varName = "1.0"
      // Note: the type-annotated form `val x: T = "1.0"` is not detected in v1 (known limitation).
      if (
        afterPropertyName?.kind === "punct" &&
        (afterPropertyName as Extract<KotlinToken, { kind: "punct" }>).text === "="
      ) {
        const valueToken = tokens[tokenIndex + 3];
        if (valueToken?.kind === "string") {
          const valueStringToken = valueToken as Extract<KotlinToken, { kind: "string" }>;
          const propertyOccurrence = emitPropertyOccurrence(
            file,
            propertyName,
            valueStringToken,
          );
          if (propertyOccurrence) occurrences.push(propertyOccurrence);
        }
        continue;
      }

      // Pattern: val varName by extra("1.0")
      // Tokens: val <name> by extra ( <string> )
      if (
        afterPropertyName?.kind === "ident" &&
        (afterPropertyName as Extract<KotlinToken, { kind: "ident" }>).text === "by"
      ) {
        const extraIdentToken = tokens[tokenIndex + 3];
        const extraOpenParen = tokens[tokenIndex + 4];
        const extraValueToken = tokens[tokenIndex + 5];
        if (
          extraIdentToken?.kind === "ident" &&
          (extraIdentToken as Extract<KotlinToken, { kind: "ident" }>).text === "extra" &&
          extraOpenParen?.kind === "punct" &&
          (extraOpenParen as Extract<KotlinToken, { kind: "punct" }>).text === "(" &&
          extraValueToken?.kind === "string"
        ) {
          const valueStringToken = extraValueToken as Extract<
            KotlinToken,
            { kind: "string" }
          >;
          const propertyOccurrence = emitPropertyOccurrence(
            file,
            propertyName,
            valueStringToken,
          );
          if (propertyOccurrence) occurrences.push(propertyOccurrence);
        }
        continue;
      }

      continue;
    }

    // ── extra["varName"] = "1.0" ─────────────────────────────────────────────
    //
    // Pattern: `extra [ <string-key> ] = <string-value>`
    if (currentToken.kind === "ident" && currentToken.text === "extra") {
      const openBracketToken = tokens[tokenIndex + 1];
      const keyStringToken = tokens[tokenIndex + 2];
      const closeBracketToken = tokens[tokenIndex + 3];
      const equalsToken = tokens[tokenIndex + 4];
      const valueToken = tokens[tokenIndex + 5];
      if (
        openBracketToken?.kind === "punct" &&
        (openBracketToken as Extract<KotlinToken, { kind: "punct" }>).text === "[" &&
        keyStringToken?.kind === "string" &&
        closeBracketToken?.kind === "punct" &&
        (closeBracketToken as Extract<KotlinToken, { kind: "punct" }>).text === "]" &&
        equalsToken?.kind === "punct" &&
        (equalsToken as Extract<KotlinToken, { kind: "punct" }>).text === "=" &&
        valueToken?.kind === "string"
      ) {
        const propertyName = (keyStringToken as Extract<KotlinToken, { kind: "string" }>)
          .body;
        const valueStringToken = valueToken as Extract<KotlinToken, { kind: "string" }>;
        const propertyOccurrence = emitPropertyOccurrence(
          file,
          propertyName,
          valueStringToken,
        );
        if (propertyOccurrence) occurrences.push(propertyOccurrence);
      }
      continue;
    }

    // ── Plugins block: id("...") version "..." ───────────────────────────────
    // In Kotlin DSL, id() always requires parens.
    if (currentToken.kind === "ident" && currentToken.text === "id") {
      const openParenToken = tokens[tokenIndex + 1];
      if (
        openParenToken?.kind !== "punct" ||
        (openParenToken as Extract<KotlinToken, { kind: "punct" }>).text !== "("
      ) {
        continue;
      }

      const pluginIdToken = tokens[tokenIndex + 2];
      if (pluginIdToken?.kind !== "string") continue;

      // After id("..."), expect closing paren
      const closeParenToken = tokens[tokenIndex + 3];
      if (
        closeParenToken?.kind !== "punct" ||
        (closeParenToken as Extract<KotlinToken, { kind: "punct" }>).text !== ")"
      ) {
        continue;
      }

      const versionKeywordToken = tokens[tokenIndex + 4];
      if (
        versionKeywordToken?.kind !== "ident" ||
        versionKeywordToken.text !== "version"
      ) {
        continue;
      }

      const versionStringToken = tokens[tokenIndex + 5];
      if (versionStringToken?.kind !== "string") continue;

      const pluginGroup = (pluginIdToken as Extract<KotlinToken, { kind: "string" }>)
        .body;
      const versionToken = versionStringToken as Extract<KotlinToken, { kind: "string" }>;
      const inPluginMgmt = isInPluginManagementBlock(
        versionToken.bodyByteStart,
        pluginMgmtBlocks,
      );
      occurrences.push({
        group: pluginGroup,
        artifact: `${pluginGroup}.gradle.plugin`,
        file,
        byteStart: versionToken.bodyByteStart,
        byteEnd: versionToken.bodyByteEnd,
        fileType: "kotlin-dsl",
        currentRaw: versionToken.body,
        shape: detectShape(versionToken.body),
        dependencyKey: `${pluginGroup}:${pluginGroup}.gradle.plugin`,
        ...(inPluginMgmt ? { via: ["pluginManagement"] } : {}),
      });
      continue;
    }

    // ── Plugins block: kotlin("name") version "..." ──────────────────────────
    // kotlin("jvm") version "2.2.20" expands to id("org.jetbrains.kotlin.jvm") version "..."
    if (currentToken.kind === "ident" && currentToken.text === "kotlin") {
      const openParenToken = tokens[tokenIndex + 1];
      if (
        openParenToken?.kind !== "punct" ||
        (openParenToken as Extract<KotlinToken, { kind: "punct" }>).text !== "("
      ) {
        continue;
      }

      const nameStringToken = tokens[tokenIndex + 2];
      if (nameStringToken?.kind !== "string") continue;

      const closeParenToken = tokens[tokenIndex + 3];
      if (
        closeParenToken?.kind !== "punct" ||
        (closeParenToken as Extract<KotlinToken, { kind: "punct" }>).text !== ")"
      ) {
        continue;
      }

      const versionKeywordToken = tokens[tokenIndex + 4];
      if (
        versionKeywordToken?.kind !== "ident" ||
        versionKeywordToken.text !== "version"
      ) {
        continue;
      }

      const versionStringToken = tokens[tokenIndex + 5];
      if (versionStringToken?.kind !== "string") continue;

      const pluginName = (nameStringToken as Extract<KotlinToken, { kind: "string" }>)
        .body;
      const pluginGroup = `org.jetbrains.kotlin.${pluginName}`;
      const versionToken = versionStringToken as Extract<KotlinToken, { kind: "string" }>;
      const inPluginMgmt = isInPluginManagementBlock(
        versionToken.bodyByteStart,
        pluginMgmtBlocks,
      );
      occurrences.push({
        group: pluginGroup,
        artifact: `${pluginGroup}.gradle.plugin`,
        file,
        byteStart: versionToken.bodyByteStart,
        byteEnd: versionToken.bodyByteEnd,
        fileType: "kotlin-dsl",
        currentRaw: versionToken.body,
        shape: detectShape(versionToken.body),
        dependencyKey: `${pluginGroup}:${pluginGroup}.gradle.plugin`,
        ...(inPluginMgmt ? { via: ["pluginManagement"] } : {}),
      });
    }
  }

  return occurrences;
}
