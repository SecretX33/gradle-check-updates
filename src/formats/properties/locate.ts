// src/formats/properties/locate.ts
import type { Occurrence } from "../../types";
import { detectShape } from "../../version/shape";
import { charIndexToByte } from "../util";

/**
 * Matches `key = value` or `key: value` or `key value` (Java .properties formats).
 * Groups: [1] key, [2] value (already trimmed of leading/trailing whitespace).
 */
const KEY_VAL_PATTERN = /^[ \t]*([A-Za-z_][\w.\-]*)[ \t]*[=: \t][ \t]*(.*?)[ \t]*$/;

/**
 * A value is version-shaped if it:
 * - starts with a digit (e.g. "1.9.0", "3.2.0-RC1")
 * - or is `+` (Gradle wildcard)
 * - or is a Maven range like "[1.0,2.0)"
 * - or ends with `.+` (prefix wildcard)
 * - or matches `!!` forms (strictlyShorthand / strictlyPreferShort)
 * - or starts with `latest.` (latestQualifier — we still let detectShape handle skipping)
 *
 * Plain words like "hello" or "true" are not version-shaped.
 */
const VERSION_VALUE_PATTERN = /^\+$|^\d|^latest\.|^\[|^\(|!!$/;

export function locateProperties(file: string, contents: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  let charPos = 0;

  for (const line of contents.split(/\r?\n/)) {
    const lineStartChar = charPos;

    // Advance charPos past the line content plus the actual line ending in the original text.
    const afterLine = charPos + line.length;
    const isCrlf = contents.slice(afterLine, afterLine + 2) === "\r\n";
    charPos = afterLine + (isCrlf ? 2 : 1);

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;

    const match = KEY_VAL_PATTERN.exec(line);
    if (!match) continue;

    const [, key, value] = match;
    if (!value) continue;

    // Skip values that don't look version-shaped at all (e.g. plain words, booleans).
    if (!VERSION_VALUE_PATTERN.test(value)) continue;

    const shape = detectShape(value);
    if (shape === "latestQualifier") continue;

    // Find the value's position within the line. Use lastIndexOf so whitespace
    // around the separator doesn't confuse the search.
    const valueOffsetInLine = line.lastIndexOf(value);
    const byteStart = charIndexToByte(contents, lineStartChar + valueOffsetInLine);
    const byteEnd = byteStart + Buffer.byteLength(value, "utf8");

    occurrences.push({
      group: "",
      artifact: "",
      file,
      byteStart,
      byteEnd,
      fileType: "properties",
      currentRaw: value,
      shape,
      dependencyKey: `prop:${key}`,
    });
  }

  return occurrences;
}
