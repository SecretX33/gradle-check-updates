// src/formats/version-catalog/locate.ts
import type { Occurrence } from "../../types.js";
import { detectShape } from "../../version/shape.js";
import { splitGav } from "../util.js";

type ActiveTable = "versions" | "libraries" | "plugins" | "other";

const RICH_FIELD_SHAPE_MAP: Record<
  string,
  "richStrictly" | "richRequire" | "richPrefer" | "richReject"
> = {
  strictly: "richStrictly",
  require: "richRequire",
  prefer: "richPrefer",
  reject: "richReject",
  // rejectAll is intentionally absent: it is a boolean flag (rejectAll = true),
  // not a version string, and is never a rewrite target.
};

/**
 * State carried while scanning a single line of TOML.
 */
type ScanPosition = {
  text: string;
  byteOffset: number;
  charIndex: number;
};

/**
 * Advances the scanner position by one character, tracking the byte offset.
 */
function advanceChar(position: ScanPosition): string {
  const character = position.text[position.charIndex]!;
  position.byteOffset += Buffer.byteLength(character, "utf8");
  position.charIndex++;
  return character;
}

/**
 * Peeks at the current character without advancing.
 */
function peekChar(position: ScanPosition): string | undefined {
  return position.text[position.charIndex];
}

/**
 * Skips whitespace characters at the current position.
 */
function skipWhitespace(position: ScanPosition): void {
  while (position.charIndex < position.text.length) {
    const character = position.text[position.charIndex]!;
    if (character !== " " && character !== "\t") break;
    advanceChar(position);
  }
}

/**
 * Reads a bare key (letters, digits, hyphens, underscores).
 * Returns the key string.
 */
function readBareKey(position: ScanPosition): string {
  let key = "";
  while (position.charIndex < position.text.length) {
    const character = position.text[position.charIndex]!;
    if (/[A-Za-z0-9\-_]/.test(character)) {
      key += character;
      advanceChar(position);
    } else {
      break;
    }
  }
  return key;
}

/**
 * Reads a basic string (double-quoted). Returns the content and byte offsets
 * of the content (not including quotes).
 *
 * Returns null if the current character is not a double quote.
 */
function readDoubleQuotedString(
  position: ScanPosition,
): { content: string; contentByteStart: number; contentByteEnd: number } | null {
  if (peekChar(position) !== '"') return null;
  advanceChar(position); // consume opening quote

  const contentByteStart = position.byteOffset;
  let content = "";
  let escaped = false;

  while (position.charIndex < position.text.length) {
    const character = position.text[position.charIndex]!;
    if (escaped) {
      content += character;
      advanceChar(position);
      escaped = false;
    } else if (character === "\\") {
      // Backslash is included raw — escape sequences are not decoded (version strings never contain them).
      content += character;
      advanceChar(position);
      escaped = true;
    } else if (character === '"') {
      break;
    } else {
      content += character;
      advanceChar(position);
    }
  }

  const contentByteEnd = position.byteOffset;
  if (peekChar(position) === '"') advanceChar(position); // consume closing quote

  return { content, contentByteStart, contentByteEnd };
}

/**
 * Reads a literal string (single-quoted). Returns content and byte offsets.
 *
 * Returns null if the current character is not a single quote.
 */
function readSingleQuotedString(
  position: ScanPosition,
): { content: string; contentByteStart: number; contentByteEnd: number } | null {
  if (peekChar(position) !== "'") return null;
  advanceChar(position); // consume opening quote

  const contentByteStart = position.byteOffset;
  let content = "";

  while (position.charIndex < position.text.length) {
    const character = position.text[position.charIndex]!;
    if (character === "'") break;
    content += character;
    advanceChar(position);
  }

  const contentByteEnd = position.byteOffset;
  if (peekChar(position) === "'") advanceChar(position); // consume closing quote

  return { content, contentByteStart, contentByteEnd };
}

/**
 * Reads either a double-quoted or single-quoted TOML string.
 */
function readTomlString(
  position: ScanPosition,
): { content: string; contentByteStart: number; contentByteEnd: number } | null {
  const current = peekChar(position);
  if (current === '"') return readDoubleQuotedString(position);
  if (current === "'") return readSingleQuotedString(position);
  return null;
}

/**
 * Reads a key, which may be a bare key or a quoted string.
 * Handles dotted keys by returning the full dotted path.
 */
function readKey(position: ScanPosition): string {
  skipWhitespace(position);
  const current = peekChar(position);
  let keyPart: string;
  if (current === '"') {
    const stringResult = readDoubleQuotedString(position);
    keyPart = stringResult?.content ?? "";
  } else if (current === "'") {
    const stringResult = readSingleQuotedString(position);
    keyPart = stringResult?.content ?? "";
  } else {
    keyPart = readBareKey(position);
  }

  // Check for dotted key continuation
  if (peekChar(position) === ".") {
    advanceChar(position); // consume dot
    const subKey = readKey(position);
    return `${keyPart}.${subKey}`;
  }

  return keyPart;
}

type InlineTableField = {
  key: string;
  content: string;
  contentByteStart: number;
  contentByteEnd: number;
};

/**
 * Parses an inline table `{ key = "value", ... }` and returns all fields
 * that have string values, along with their byte positions.
 *
 * Also handles nested inline tables for rich-version blocks.
 */
type InlineTableResult = {
  fields: InlineTableField[];
  tableByteStart: number;
  tableByteEnd: number;
  /** Fields that are nested inline tables (for rich-version support). */
  nestedTables: { key: string; fields: InlineTableField[]; tableByteStart: number }[];
};

function parseInlineTable(position: ScanPosition): InlineTableResult | null {
  if (peekChar(position) !== "{") return null;

  const tableByteStart = position.byteOffset;
  advanceChar(position); // consume '{'

  const fields: InlineTableField[] = [];
  const nestedTables: {
    key: string;
    fields: InlineTableField[];
    tableByteStart: number;
  }[] = [];

  while (position.charIndex < position.text.length) {
    skipWhitespace(position);

    const current = peekChar(position);
    if (current === "}") {
      advanceChar(position); // consume '}'
      break;
    }
    if (current === ",") {
      advanceChar(position); // consume ','
      continue;
    }
    if (current === undefined) break;

    const fieldKey = readKey(position);
    skipWhitespace(position);

    if (peekChar(position) !== "=") break;
    advanceChar(position); // consume '='
    skipWhitespace(position);

    if (peekChar(position) === "{") {
      // Nested inline table (e.g. version = { strictly = "...", prefer = "..." })
      const nestedTableByteStart = position.byteOffset;
      const nestedResult = parseInlineTable(position);
      if (nestedResult) {
        nestedTables.push({
          key: fieldKey,
          fields: nestedResult.fields,
          tableByteStart: nestedTableByteStart,
        });
      }
    } else {
      const stringResult = readTomlString(position);
      if (stringResult) {
        fields.push({
          key: fieldKey,
          content: stringResult.content,
          contentByteStart: stringResult.contentByteStart,
          contentByteEnd: stringResult.contentByteEnd,
        });
      }
    }
  }

  const tableByteEnd = position.byteOffset;
  return { fields, tableByteStart, tableByteEnd, nestedTables };
}

/**
 * Locate all dependency version occurrences in a Gradle version catalog file (libs.versions.toml).
 *
 * Handles:
 * - `[versions]` table: `kotlin = "1.9.0"` → Occurrence with dependencyKey `catalog-version:kotlin`
 * - `[libraries]` table:
 *   - Compact: `foo = "g:a:1.0"` → Occurrence on version part
 *   - Inline with version: `foo = { module = "g:a", version = "1.0" }` → Occurrence on version
 *   - Inline with ref: `foo = { module = "g:a", version.ref = "kotlin" }` → pending-ref
 *   - Rich table: `foo = { module = "g:a", version = { strictly = "...", prefer = "..." } }` → multiple Occurrences
 *   - Group+name form: `foo = { group = "g", name = "a", version = "1.0" }` → Occurrence (equivalent to module)
 * - `[plugins]` table:
 *   - `kotlin = { id = "org.jetbrains.kotlin.jvm", version = "1.9.0" }` → Occurrence
 *   - `kotlin = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }` → pending-ref
 *   - Compact string form: `kotlin = "some.plugin.id:1.9.0"` → Occurrence on version part
 */
export function locateVersionCatalog(file: string, contents: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const lines = contents.split("\n");
  let currentByteOffset = 0;
  let activeTable: ActiveTable = "other";

  for (const line of lines) {
    const lineByteOffset = currentByteOffset;
    // Advance byte offset past this line and the newline character.
    // Note: split("\n") removes the \n, so we add 1 byte for the newline
    // (CRLF: the \r stays in the line string, so this still works)
    currentByteOffset += Buffer.byteLength(line, "utf8") + 1;

    const trimmed = line.trim();

    // Blank lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Table header: [versions], [libraries], [plugins]
    if (trimmed.startsWith("[") && !trimmed.startsWith("[[")) {
      const tableNameMatch = /^\[([^\]]+)\]/.exec(trimmed);
      if (tableNameMatch) {
        const tableName = tableNameMatch[1]!.trim();
        if (tableName === "versions") activeTable = "versions";
        else if (tableName === "libraries") activeTable = "libraries";
        else if (tableName === "plugins") activeTable = "plugins";
        else activeTable = "other";
      }
      continue;
    }

    if (activeTable === "other") continue;

    // Parse key = value
    const position: ScanPosition = {
      text: line,
      byteOffset: lineByteOffset,
      charIndex: 0,
    };

    skipWhitespace(position);
    if (position.charIndex >= position.text.length) continue;

    const entryKey = readKey(position);
    if (!entryKey) continue;

    // Gap 3: Dotted top-level key form (foo.module = ...) is not supported in v1 — known gap.
    // Example: `foo.module = "com.example:mylib"` / `foo.version.ref = "kotlin"`.
    // Detecting a top-level dot means this line is part of a dotted-key group that requires
    // stateful accumulation across lines to reconstruct the full entry. Skip explicitly rather
    // than silently doing the wrong thing.
    if (
      entryKey.includes(".") &&
      (activeTable === "libraries" || activeTable === "plugins")
    ) {
      continue;
    }

    skipWhitespace(position);
    if (peekChar(position) !== "=") continue;
    advanceChar(position); // consume '='
    skipWhitespace(position);

    // ── [versions] table ──────────────────────────────────────────────────────
    if (activeTable === "versions") {
      // Check for multiline strings — skip
      if (
        peekChar(position) === '"' &&
        position.text[position.charIndex + 1] === '"' &&
        position.text[position.charIndex + 2] === '"'
      ) {
        continue;
      }
      if (
        peekChar(position) === "'" &&
        position.text[position.charIndex + 1] === "'" &&
        position.text[position.charIndex + 2] === "'"
      ) {
        continue;
      }

      const stringResult = readTomlString(position);
      if (!stringResult) continue;

      const versionShape = detectShape(stringResult.content);
      occurrences.push({
        group: "",
        artifact: "",
        file,
        byteStart: stringResult.contentByteStart,
        byteEnd: stringResult.contentByteEnd,
        fileType: "version-catalog",
        currentRaw: stringResult.content,
        shape: versionShape,
        dependencyKey: `catalog-version:${entryKey}`,
      });
      continue;
    }

    // ── [libraries] table ─────────────────────────────────────────────────────
    if (activeTable === "libraries") {
      const currentChar = peekChar(position);

      // Compact string form: foo = "g:a:1.0"
      if (currentChar === '"' || currentChar === "'") {
        const stringResult = readTomlString(position);
        if (!stringResult) continue;

        const gavParts = splitGav(stringResult.content);
        if (!gavParts || !gavParts.version) continue;

        const versionOffset = stringResult.content.lastIndexOf(gavParts.version);
        const versionByteStart =
          stringResult.contentByteStart +
          Buffer.byteLength(stringResult.content.slice(0, versionOffset), "utf8");
        const versionByteEnd =
          versionByteStart + Buffer.byteLength(gavParts.version, "utf8");

        occurrences.push({
          group: gavParts.group,
          artifact: gavParts.artifact,
          file,
          byteStart: versionByteStart,
          byteEnd: versionByteEnd,
          fileType: "version-catalog",
          currentRaw: gavParts.version,
          shape: detectShape(gavParts.version),
          dependencyKey: `${gavParts.group}:${gavParts.artifact}`,
        });
        continue;
      }

      // Inline table form: foo = { module = "g:a", version = "1.0" }
      if (currentChar === "{") {
        const inlineResult = parseInlineTable(position);
        if (!inlineResult) continue;

        // Find module field to get group:artifact, or fall back to group + name fields.
        const moduleField = inlineResult.fields.find((field) => field.key === "module");

        let resolvedGroup: string;
        let resolvedArtifact: string;

        if (moduleField) {
          const gavParts = splitGav(moduleField.content);
          if (!gavParts) continue;
          resolvedGroup = gavParts.group;
          resolvedArtifact = gavParts.artifact;
        } else {
          // Gap 1: group + name form — { group = "com.example", name = "mylib", version = "1.0" }
          const groupField = inlineResult.fields.find((field) => field.key === "group");
          const nameField = inlineResult.fields.find((field) => field.key === "name");
          if (!groupField || !nameField) continue;
          resolvedGroup = groupField.content;
          resolvedArtifact = nameField.content;
        }

        const dependencyKey = `${resolvedGroup}:${resolvedArtifact}`;

        // Check for version.ref (dotted key)
        const versionRefField = inlineResult.fields.find(
          (field) => field.key === "version.ref",
        );
        if (versionRefField) {
          occurrences.push({
            group: resolvedGroup,
            artifact: resolvedArtifact,
            file,
            byteStart: versionRefField.contentByteStart,
            byteEnd: versionRefField.contentByteEnd,
            fileType: "version-catalog",
            currentRaw: versionRefField.content,
            shape: "exact",
            dependencyKey,
            via: [`__pending_ref__:${versionRefField.content}`],
          });
          continue;
        }

        // Check for nested rich-version table: version = { strictly = "...", prefer = "..." }
        const richVersionTable = inlineResult.nestedTables.find(
          (nestedTable) => nestedTable.key === "version",
        );
        if (richVersionTable) {
          const blockId = String(richVersionTable.tableByteStart);
          const richDependencyKey = `${dependencyKey}@${blockId}`;

          for (const richField of richVersionTable.fields) {
            const richShape = RICH_FIELD_SHAPE_MAP[richField.key];
            if (!richShape) continue;

            occurrences.push({
              group: resolvedGroup,
              artifact: resolvedArtifact,
              file,
              byteStart: richField.contentByteStart,
              byteEnd: richField.contentByteEnd,
              fileType: "version-catalog",
              currentRaw: richField.content,
              shape: richShape,
              dependencyKey: richDependencyKey,
            });
          }
          continue;
        }

        // Simple version field
        const versionField = inlineResult.fields.find((field) => field.key === "version");
        if (versionField) {
          occurrences.push({
            group: resolvedGroup,
            artifact: resolvedArtifact,
            file,
            byteStart: versionField.contentByteStart,
            byteEnd: versionField.contentByteEnd,
            fileType: "version-catalog",
            currentRaw: versionField.content,
            shape: detectShape(versionField.content),
            dependencyKey,
          });
        }
        continue;
      }
      continue;
    }

    // ── [plugins] table ───────────────────────────────────────────────────────
    if (activeTable === "plugins") {
      const pluginCurrentChar = peekChar(position);

      // Gap 2: Compact string form — short-notation = "some.plugin.id:1.4"
      if (pluginCurrentChar === '"' || pluginCurrentChar === "'") {
        const stringResult = readTomlString(position);
        if (!stringResult) continue;

        // Split on last ':' to separate pluginId from version
        const lastColonIndex = stringResult.content.lastIndexOf(":");
        if (lastColonIndex === -1) continue;

        const pluginId = stringResult.content.slice(0, lastColonIndex);
        const pluginVersion = stringResult.content.slice(lastColonIndex + 1);
        if (!pluginId || !pluginVersion) continue;

        const pluginArtifact = `${pluginId}.gradle.plugin`;
        const pluginDependencyKey = `${pluginId}:${pluginArtifact}`;

        // Byte offset of the version within the quoted content.
        // Content starts at contentByteStart; version starts after "pluginId:".
        const prefixByteLength = Buffer.byteLength(`${pluginId}:`, "utf8");
        const versionByteStart = stringResult.contentByteStart + prefixByteLength;
        const versionByteEnd =
          versionByteStart + Buffer.byteLength(pluginVersion, "utf8");

        occurrences.push({
          group: pluginId,
          artifact: pluginArtifact,
          file,
          byteStart: versionByteStart,
          byteEnd: versionByteEnd,
          fileType: "version-catalog",
          currentRaw: pluginVersion,
          shape: detectShape(pluginVersion),
          dependencyKey: pluginDependencyKey,
        });
        continue;
      }

      if (pluginCurrentChar !== "{") continue;

      const inlineResult = parseInlineTable(position);
      if (!inlineResult) continue;

      // Find id field
      const idField = inlineResult.fields.find((field) => field.key === "id");
      if (!idField) continue;

      const pluginId = idField.content;
      const artifact = `${pluginId}.gradle.plugin`;
      const dependencyKey = `${pluginId}:${artifact}`;

      // Check for version.ref
      const versionRefField = inlineResult.fields.find(
        (field) => field.key === "version.ref",
      );
      if (versionRefField) {
        occurrences.push({
          group: pluginId,
          artifact,
          file,
          byteStart: versionRefField.contentByteStart,
          byteEnd: versionRefField.contentByteEnd,
          fileType: "version-catalog",
          currentRaw: versionRefField.content,
          shape: "exact",
          dependencyKey,
          via: [`__pending_ref__:${versionRefField.content}`],
        });
        continue;
      }

      // Simple version field
      const versionField = inlineResult.fields.find((field) => field.key === "version");
      if (versionField) {
        occurrences.push({
          group: pluginId,
          artifact,
          file,
          byteStart: versionField.contentByteStart,
          byteEnd: versionField.contentByteEnd,
          fileType: "version-catalog",
          currentRaw: versionField.content,
          shape: detectShape(versionField.content),
          dependencyKey,
        });
      }
      continue;
    }
  }

  return occurrences;
}
