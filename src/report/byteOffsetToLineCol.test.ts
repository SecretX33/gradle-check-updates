import { describe, it, expect, vi, beforeEach } from "vitest";
import { byteOffsetToLineCol } from "./byteOffsetToLineCol";

vi.mock("node:fs");

import * as fs from "node:fs";

const mockReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("byteOffsetToLineCol", () => {
  it("offset 0 returns line 1, col 1", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("hello\nworld", "utf8") as never);

    expect(byteOffsetToLineCol("/fake/file-zero.txt", 0)).toEqual({ line: 1, col: 1 });
  });

  it("offset at start of second line (LF) returns line 2, col 1", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("hello\nworld", "utf8") as never);

    expect(byteOffsetToLineCol("/fake/file-lf.txt", 6)).toEqual({ line: 2, col: 1 });
  });

  it("mid-word offset returns correct line and column", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("abc\ndef", "utf8") as never);

    expect(byteOffsetToLineCol("/fake/file-midword.txt", 5)).toEqual({ line: 2, col: 2 });
  });

  it("CRLF: offset at start of second line returns line 2, col 1", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("line1\r\nline2", "utf8") as never);

    expect(byteOffsetToLineCol("/fake/file-crlf.txt", 7)).toEqual({ line: 2, col: 1 });
  });

  it("CRLF mid-line: offset at second char of second line returns line 2, col 2", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("ab\r\ncd", "utf8") as never);

    expect(byteOffsetToLineCol("/fake/file-crlf-mid.txt", 5)).toEqual({
      line: 2,
      col: 2,
    });
  });

  it("cache hit: readFileSync called only once for the same path", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("abc\ndef", "utf8") as never);

    byteOffsetToLineCol("/fake/file-cache.txt", 0);
    byteOffsetToLineCol("/fake/file-cache.txt", 4);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it("throws RangeError when byteOffset exceeds buffer length", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("abc", "utf8") as never);

    expect(() => byteOffsetToLineCol("/fake/file-oob.txt", 10)).toThrow(RangeError);
  });
});
