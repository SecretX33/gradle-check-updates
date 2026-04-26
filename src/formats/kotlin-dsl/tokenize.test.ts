// src/formats/kotlin-dsl/tokenize.test.ts
import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenize.js";

const nonWsKinds = (source: string) =>
  tokenize(source)
    .filter((token) => token.kind !== "ws")
    .map((token) => token.kind);

describe("kotlin tokenize", () => {
  it("recognizes strings and idents", () => {
    expect(nonWsKinds(`implementation("a:b:1.0")`)).toEqual([
      "ident",
      "punct",
      "string",
      "punct",
    ]);
  });

  it("no single-quoted strings — treated as punctuation", () => {
    // 'x' is a char literal in Kotlin — punct, ident, punct
    expect(nonWsKinds(`'x'`)).not.toContain("string");
  });

  it("skips line comments", () => {
    expect(nonWsKinds(`// hello\nfoo`)).toEqual(["comment", "ident"]);
  });

  it("handles nested block comments", () => {
    expect(nonWsKinds(`/* a /* b */ c */ foo`)).toEqual(["comment", "ident"]);
  });

  it("recognizes triple-quoted strings", () => {
    const tokens = tokenize(`"""multi\nline"""`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.quote).toBe(`"""`);
  });

  it("flags $ interpolation in double-quoted strings", () => {
    const tokens = tokenize(`"v$kotlinVersion"`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.interpolated).toBe(true);
  });

  it("flags $ interpolation in triple-quoted strings", () => {
    const tokens = tokenize(`"""prefix$var"""`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.interpolated).toBe(true);
  });

  it("does not confuse apostrophes in line comments", () => {
    expect(nonWsKinds(`// don't break\nfoo`)).toEqual(["comment", "ident"]);
  });

  // Extra tests beyond the spec

  it("handles nested block comment depth > 2", () => {
    expect(nonWsKinds(`/* a /* b /* c */ d */ e */ foo`)).toEqual(["comment", "ident"]);
  });

  it("escape in triple-quoted string does not end it early", () => {
    // In triple-quoted strings, backslash is NOT an escape; the string ends only at """
    const tokens = tokenize(`"""line1\\"still inside"""`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.quote).toBe(`"""`);
    // The body should contain the backslash and everything up to closing """
    expect(stringToken.body).toContain("\\");
  });

  it("does not flag non-interpolated double-quoted string", () => {
    const tokens = tokenize(`"no-dollar-here"`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.interpolated).toBe(false);
  });

  it("handles empty double-quoted string", () => {
    const tokens = tokenize(`""`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.body).toBe("");
    expect(stringToken.quote).toBe('"');
  });

  it("handles empty triple-quoted string", () => {
    const tokens = tokenize(`""""""`);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    expect(stringToken.body).toBe("");
    expect(stringToken.quote).toBe(`"""`);
  });

  it("computes correct byte offsets for ASCII string body", () => {
    const source = `"abc"`;
    const tokens = tokenize(source);
    const stringToken = tokens.find((token) => token.kind === "string")!;
    // Opening quote is 1 byte, so body starts at byte 1
    expect(stringToken.bodyByteStart).toBe(1);
    expect(stringToken.bodyByteEnd).toBe(4);
  });
});
