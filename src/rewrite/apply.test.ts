// src/rewrite/apply.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "./apply";

const buf = (s: string) => Buffer.from(s, "utf8");
const str = (b: Buffer) => b.toString("utf8");

describe("applyEdits", () => {
  // --- Specified tests ---

  it("returns the original when no edits", () => {
    expect(str(applyEdits(buf("hello"), []))).toBe("hello");
  });

  it("replaces a single range", () => {
    // 'version = "1.0.0"': v=0 e=1 r=2 s=3 i=4 o=5 n=6 ' '=7 ==8 ' '=9 "=10 1=11 .=12 0=13 .=14 0=15 "=16
    // "1.0.0" occupies bytes [11,16) — replace to get "2.0.0"
    const out = applyEdits(buf('version = "1.0.0"'), [
      { byteStart: 11, byteEnd: 16, replacement: "2.0.0" },
    ]);
    expect(str(out)).toBe('version = "2.0.0"');
  });

  it("applies multiple edits without shifting earlier offsets", () => {
    const input = "AAA-BBB-CCC";
    const out = applyEdits(buf(input), [
      { byteStart: 0, byteEnd: 3, replacement: "x" },
      { byteStart: 4, byteEnd: 7, replacement: "yy" },
      { byteStart: 8, byteEnd: 11, replacement: "zzz" },
    ]);
    expect(str(out)).toBe("x-yy-zzz");
  });

  it("preserves CRLF, tabs, surrounding bytes byte-for-byte", () => {
    // Byte layout of 'a\r\n\tb = "1.0"\r\n':
    //  0:a  1:\r  2:\n  3:\t  4:b  5:space  6:=  7:space  8:"  9:1  10:.  11:0  12:"  13:\r  14:\n
    // byteStart=9, byteEnd=12 targets "1.0" (bytes 9,10,11)
    const original = 'a\r\n\tb = "1.0"\r\n';
    const out = applyEdits(buf(original), [
      { byteStart: 9, byteEnd: 12, replacement: "2.0" },
    ]);
    expect(str(out)).toBe('a\r\n\tb = "2.0"\r\n');
  });

  it("rejects overlapping edits", () => {
    expect(() =>
      applyEdits(buf("hello"), [
        { byteStart: 0, byteEnd: 3, replacement: "x" },
        { byteStart: 2, byteEnd: 4, replacement: "y" },
      ]),
    ).toThrow(/overlap/i);
  });

  // --- Additional edge cases ---

  it("empty replacement performs a deletion", () => {
    // "abc" → remove byte 1 ('b') → "ac"
    const out = applyEdits(buf("abc"), [{ byteStart: 1, byteEnd: 2, replacement: "" }]);
    expect(str(out)).toBe("ac");
  });

  it("edit at end of buffer", () => {
    // "v1.0" → replace bytes [1,4) "1.0" with "2.0" → "v2.0"
    const out = applyEdits(buf("v1.0"), [
      { byteStart: 1, byteEnd: 4, replacement: "2.0" },
    ]);
    expect(str(out)).toBe("v2.0");
  });

  it("adjacent edits (touching but not overlapping) succeed", () => {
    // "abcdef" → [0,3) → "XYZ", [3,6) → "123" → "XYZ123"
    const out = applyEdits(buf("abcdef"), [
      { byteStart: 0, byteEnd: 3, replacement: "XYZ" },
      { byteStart: 3, byteEnd: 6, replacement: "123" },
    ]);
    expect(str(out)).toBe("XYZ123");
  });

  it("zero-length edit inserts at position", () => {
    // "abcd" → insert "X" at position 2 → "abXcd"
    const out = applyEdits(buf("abcd"), [{ byteStart: 2, byteEnd: 2, replacement: "X" }]);
    expect(str(out)).toBe("abXcd");
  });

  it("edits passed out-of-order are sorted and applied correctly", () => {
    // Same as the multi-edit test but edits supplied in reverse order
    const input = "AAA-BBB-CCC";
    const out = applyEdits(buf(input), [
      { byteStart: 8, byteEnd: 11, replacement: "zzz" },
      { byteStart: 0, byteEnd: 3, replacement: "x" },
      { byteStart: 4, byteEnd: 7, replacement: "yy" },
    ]);
    expect(str(out)).toBe("x-yy-zzz");
  });

  it("throws when byteEnd exceeds buffer length", () => {
    expect(() =>
      applyEdits(buf("hi"), [{ byteStart: 0, byteEnd: 10, replacement: "x" }]),
    ).toThrow();
  });
});
