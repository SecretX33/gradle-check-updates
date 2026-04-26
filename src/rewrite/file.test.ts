// src/rewrite/file.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteFile } from "./file";

describe("rewriteFile", () => {
  it("writes only changed bytes back to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-"));
    const path = join(dir, "build.gradle");
    const original = `dependencies {\n  implementation 'a:b:1.0.0'\n}\n`;
    await writeFile(path, original, "utf8");
    const start = original.indexOf("1.0.0");
    await rewriteFile(path, [
      { byteStart: start, byteEnd: start + 5, replacement: "2.0.0" },
    ]);
    const after = await readFile(path, "utf8");
    expect(after).toBe(`dependencies {\n  implementation 'a:b:2.0.0'\n}\n`);
  });

  it("no edits → file is not read or written (skip entirely)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-"));
    const path = join(dir, "build.gradle");
    const original = `dependencies {\n  implementation 'a:b:1.0.0'\n}\n`;
    await writeFile(path, original, "utf8");
    const statBefore = await stat(path);

    await rewriteFile(path, []);

    const statAfter = await stat(path);
    // mtime must not change — file was not touched
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    // content is unchanged
    const after = await readFile(path, "utf8");
    expect(after).toBe(original);
  });

  it("preserves CRLF line endings around an edited version string", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-"));
    const path = join(dir, "build.gradle");
    // Build content with CRLF
    const content = "dependencies {\r\n  implementation 'a:b:1.0.0'\r\n}\r\n";
    await writeFile(path, Buffer.from(content, "utf8"));
    const start = content.indexOf("1.0.0");
    await rewriteFile(path, [
      { byteStart: start, byteEnd: start + 5, replacement: "2.0.0" },
    ]);
    const after = await readFile(path);
    const expected = Buffer.from(
      "dependencies {\r\n  implementation 'a:b:2.0.0'\r\n}\r\n",
      "utf8",
    );
    expect(after).toEqual(expected);
    // Explicitly verify CRLF sequences are still there
    expect(after.includes(Buffer.from("\r\n"))).toBe(true);
  });

  it("applies multiple edits in a single call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-"));
    const path = join(dir, "build.gradle");
    const original =
      `dependencies {\n` +
      `  implementation 'a:b:1.0.0'\n` +
      `  implementation 'c:d:2.0.0'\n` +
      `}\n`;
    await writeFile(path, original, "utf8");
    const start1 = original.indexOf("1.0.0");
    const start2 = original.indexOf("2.0.0");
    await rewriteFile(path, [
      { byteStart: start1, byteEnd: start1 + 5, replacement: "1.2.3" },
      { byteStart: start2, byteEnd: start2 + 5, replacement: "3.0.0" },
    ]);
    const after = await readFile(path, "utf8");
    expect(after).toBe(
      `dependencies {\n` +
        `  implementation 'a:b:1.2.3'\n` +
        `  implementation 'c:d:3.0.0'\n` +
        `}\n`,
    );
  });
});
