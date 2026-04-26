export type KotlinToken =
  | { kind: "ws"; charStart: number; charEnd: number; byteStart: number; byteEnd: number }
  | {
      kind: "comment";
      charStart: number;
      charEnd: number;
      byteStart: number;
      byteEnd: number;
    }
  | {
      kind: "ident";
      text: string;
      charStart: number;
      charEnd: number;
      byteStart: number;
      byteEnd: number;
    }
  | {
      kind: "number";
      text: string;
      charStart: number;
      charEnd: number;
      byteStart: number;
      byteEnd: number;
    }
  | {
      kind: "punct";
      text: string;
      charStart: number;
      charEnd: number;
      byteStart: number;
      byteEnd: number;
    }
  | {
      kind: "string";
      quote: '"' | '"""';
      body: string;
      bodyCharStart: number;
      bodyCharEnd: number;
      bodyByteStart: number;
      bodyByteEnd: number;
      charStart: number;
      charEnd: number;
      byteStart: number;
      byteEnd: number;
      interpolated: boolean;
    };

export function tokenize(input: string): KotlinToken[] {
  const tokens: KotlinToken[] = [];
  const byteOffset = (charIndex: number) =>
    Buffer.byteLength(input.slice(0, charIndex), "utf8");
  let position = 0;
  const length = input.length;

  while (position < length) {
    const tokenStart = position;
    const char = input[position]!;

    // Whitespace
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      while (position < length && /\s/.test(input[position]!)) position++;
      tokens.push({
        kind: "ws",
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
      });
      continue;
    }

    // Line comment //
    if (char === "/" && input[position + 1] === "/") {
      while (position < length && input[position] !== "\n") position++;
      tokens.push({
        kind: "comment",
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
      });
      continue;
    }

    // Block comment /* ... */ with nested comment support
    if (char === "/" && input[position + 1] === "*") {
      position += 2;
      let nestingDepth = 1;
      while (position < length && nestingDepth > 0) {
        if (input[position] === "/" && input[position + 1] === "*") {
          nestingDepth++;
          position += 2;
        } else if (input[position] === "*" && input[position + 1] === "/") {
          nestingDepth--;
          position += 2;
        } else {
          position++;
        }
      }
      tokens.push({
        kind: "comment",
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
      });
      continue;
    }

    // String literals — Kotlin has no single-quoted strings.
    // Triple-quoted strings: """..."""
    // Double-quoted strings: "..."
    if (char === '"') {
      const isTriple = input[position + 1] === '"' && input[position + 2] === '"';
      const quoteDelimiter: '"' | '"""' = isTriple ? '"""' : '"';
      const delimiterLength = isTriple ? 3 : 1;
      position += delimiterLength;
      const bodyStart = position;

      while (position < length) {
        if (!isTriple && input[position] === "\\") {
          // Escape sequence — skip next character
          position += 2;
          continue;
        }
        if (isTriple) {
          if (
            input[position] === '"' &&
            input[position + 1] === '"' &&
            input[position + 2] === '"'
          ) {
            break;
          }
        } else if (input[position] === '"') {
          break;
        }
        position++;
      }

      const bodyEnd = position;
      const body = input.slice(bodyStart, bodyEnd);
      position += delimiterLength;
      // Both double-quoted and triple-quoted strings support $ interpolation in Kotlin
      const interpolated = body.includes("$");

      tokens.push({
        kind: "string",
        quote: quoteDelimiter,
        body,
        bodyCharStart: bodyStart,
        bodyCharEnd: bodyEnd,
        bodyByteStart: byteOffset(bodyStart),
        bodyByteEnd: byteOffset(bodyEnd),
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
        interpolated,
      });
      continue;
    }

    // Identifier or keyword
    if (/[A-Za-z_$]/.test(char)) {
      while (position < length && /[\w$]/.test(input[position]!)) position++;
      tokens.push({
        kind: "ident",
        text: input.slice(tokenStart, position),
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
      });
      continue;
    }

    // Number
    if (/\d/.test(char)) {
      while (position < length && /[\d.]/.test(input[position]!)) position++;
      tokens.push({
        kind: "number",
        text: input.slice(tokenStart, position),
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
      });
      continue;
    }

    // Punctuation (everything else, including apostrophes which are Kotlin char literals)
    position++;
    tokens.push({
      kind: "punct",
      text: char,
      charStart: tokenStart,
      charEnd: position,
      byteStart: byteOffset(tokenStart),
      byteEnd: byteOffset(position),
    });
  }

  return tokens;
}
