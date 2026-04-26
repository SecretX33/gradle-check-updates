import { readFileSync } from "node:fs";

export type LineCol = { line: number; col: number };

const cache = new Map<string, Buffer>();

function loadBuffer(filePath: string): Buffer {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;
  const buffer = readFileSync(filePath);
  cache.set(filePath, buffer);
  return buffer;
}

export function byteOffsetToLineCol(filePath: string, byteOffset: number): LineCol {
  const buffer = loadBuffer(filePath);
  if (byteOffset > buffer.length) {
    throw new RangeError(
      `byteOffset ${byteOffset} exceeds file length ${buffer.length} in ${filePath}`,
    );
  }
  let line = 1;
  let col = 1;
  for (let position = 0; position < byteOffset; position++) {
    const byte = buffer[position]!;
    if (byte === 0x0d && buffer[position + 1] === 0x0a) {
      position++;
      line++;
      col = 1;
    } else if (byte === 0x0a) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
