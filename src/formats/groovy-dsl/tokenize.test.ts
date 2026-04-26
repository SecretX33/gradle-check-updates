import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenize.js";

const nonWsKinds = (source: string) =>
  tokenize(source)
    .filter((token) => token.kind !== "ws")
    .map((token) => token.kind);

describe("groovy tokenize", () => {
  it("recognizes strings and idents", () => {
    expect(nonWsKinds(`implementation 'a:b:1.0'`)).toEqual(["ident", "string"]);
  });

  it("skips line comments", () => {
    expect(nonWsKinds(`// hello\nfoo`)).toEqual(["comment", "ident"]);
  });

  it("skips block comments", () => {
    expect(nonWsKinds(`/* a */ foo`)).toEqual(["comment", "ident"]);
  });

  it("recognizes triple-quoted strings", () => {
    const tokens = tokenize(`x = """multi\nline"""`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.quote).toBe(`"""`);
  });

  it("does not mistake apostrophes inside line comments for string starts", () => {
    expect(nonWsKinds(`// don't break\nfoo`)).toEqual(["comment", "ident"]);
  });

  it("flags $ interpolation in double-quoted strings", () => {
    const tokens = tokenize(`"v$kotlinVersion"`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.interpolated).toBe(true);
  });

  it("does not flag $ in single-quoted strings", () => {
    const tokens = tokenize(`'v$kotlinVersion'`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.interpolated).toBe(false);
  });

  // Extra edge cases
  it("recognizes triple single-quoted strings", () => {
    const tokens = tokenize(`'''hello'''`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken).toBeDefined();
    expect(stringToken.quote).toBe(`'''`);
  });

  it("escaped quote inside string does not end the string", () => {
    // The tokenizer receives the 12-char string: 'it\'s fine'
    // (one backslash at index 3, apostrophe at index 4, closing quote at index 11)
    // charEnd = 12 because position advances past the closing delimiter
    const escapedQuoteSource = "'it\\'s fine'";
    expect(escapedQuoteSource.length).toBe(12);
    const tokens = tokenize(escapedQuoteSource);
    const stringTokens = tokens.filter((token) => token.kind === "string");
    expect(stringTokens).toHaveLength(1);
    const stringToken = stringTokens[0]!;
    expect(stringToken.charStart).toBe(0);
    expect(stringToken.charEnd).toBe(12);
  });

  it("bodyByteStart and bodyByteEnd are correct for ASCII body", () => {
    // Input: 'hello' — opening quote at index 0, body starts at index 1
    const tokens = tokenize(`'hello'`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.bodyByteStart).toBe(1); // after opening '
    expect(stringToken.bodyByteEnd).toBe(6); // before closing '
  });

  it("byteStart points to opening quote and bodyByteStart points to first body char", () => {
    // Input: 'a:b:1.0'
    const tokens = tokenize(`'a:b:1.0'`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.byteStart).toBe(0); // index of opening '
    expect(stringToken.bodyByteStart).toBe(1); // index of 'a'
  });
});
