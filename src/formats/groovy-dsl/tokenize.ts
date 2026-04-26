export type GroovyToken =
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
      quote: "'" | '"' | "'''" | '"""';
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

export function tokenize(input: string): GroovyToken[] {
  const tokens: GroovyToken[] = [];
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

    // Block comment /* ... */
    if (char === "/" && input[position + 1] === "*") {
      position += 2;
      while (
        position < length &&
        !(input[position] === "*" && input[position + 1] === "/")
      )
        position++;
      if (position < length) position += 2;
      tokens.push({
        kind: "comment",
        charStart: tokenStart,
        charEnd: position,
        byteStart: byteOffset(tokenStart),
        byteEnd: byteOffset(position),
      });
      continue;
    }

    // String literals (single/double, triple or plain)
    if (char === "'" || char === '"') {
      const quoteChar = char;
      const isTriple =
        input[position + 1] === quoteChar && input[position + 2] === quoteChar;
      const quoteDelimiter = (isTriple ? quoteChar.repeat(3) : quoteChar) as
        | "'"
        | '"'
        | "'''"
        | '"""';
      const delimiterLength = isTriple ? 3 : 1;
      position += delimiterLength;
      const bodyStart = position;

      while (position < length) {
        if (input[position] === "\\") {
          position += 2;
          continue;
        }
        if (isTriple) {
          if (
            input[position] === quoteChar &&
            input[position + 1] === quoteChar &&
            input[position + 2] === quoteChar
          ) {
            break;
          }
        } else if (input[position] === quoteChar) {
          break;
        }
        position++;
      }

      const bodyEnd = position;
      const body = input.slice(bodyStart, bodyEnd);
      position += delimiterLength;
      const interpolated = quoteChar === '"' && body.includes("$");

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

    // Identifier
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

    // Punctuation (everything else)
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
