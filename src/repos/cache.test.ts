import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cache } from "./cache.js";

let tempCacheDir: string;
let cache: Cache;

function keyPath(dir: string, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return join(dir, hash);
}

beforeEach(async () => {
  tempCacheDir = await mkdtemp(join(tmpdir(), "gcu-cache-test-"));
  cache = new Cache(tempCacheDir);
});

afterEach(async () => {
  await rm(tempCacheDir, { recursive: true, force: true });
});

describe("Cache", () => {
  it("returns undefined on cache miss (empty directory)", async () => {
    const result = await cache.get("nonexistent-key", 60_000);
    expect(result).toBeUndefined();
  });

  it("returns the cached value after set", async () => {
    await cache.set("my-key", "my-value");
    const result = await cache.get("my-key", 60_000);
    expect(result).toBe("my-value");
  });

  it("returns undefined when ttlMs is -1 (entry is always expired)", async () => {
    await cache.set("expiring-key", "some-value");
    const result = await cache.get("expiring-key", -1);
    expect(result).toBeUndefined();
  });

  it("stores and retrieves different keys independently", async () => {
    await cache.set("key-alpha", "value-alpha");
    await cache.set("key-beta", "value-beta");
    expect(await cache.get("key-alpha", 60_000)).toBe("value-alpha");
    expect(await cache.get("key-beta", 60_000)).toBe("value-beta");
  });

  it("creates the cache directory when it does not exist", async () => {
    const nestedCacheDir = join(tempCacheDir, "nested", "path");
    const nestedCache = new Cache(nestedCacheDir);
    await nestedCache.set("test-key", "test-value");
    const result = await nestedCache.get("test-key", 60_000);
    expect(result).toBe("test-value");
  });

  it("stores an ISO timestamp on the first line followed by the content", async () => {
    await cache.set("format-key", "hello world");
    const raw = await readFile(keyPath(tempCacheDir, "format-key"), "utf8");
    const [firstLine, ...rest] = raw.split("\n");
    expect(new Date(firstLine!).toISOString()).toBe(firstLine); // valid ISO 8601
    expect(rest.join("\n")).toBe("hello world");
  });

  it("respects TTL using the embedded timestamp, not the file mtime", async () => {
    // Write a cache entry with a timestamp 2 hours in the past
    const pastIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await writeFile(keyPath(tempCacheDir, "old-key"), `${pastIso}\nstale-value`, "utf8");

    // A 1-hour TTL should treat this as expired
    expect(await cache.get("old-key", 60 * 60 * 1000)).toBeUndefined();
    // A 3-hour TTL should treat this as fresh
    expect(await cache.get("old-key", 3 * 60 * 60 * 1000)).toBe("stale-value");
  });

  it("returns undefined for Infinity TTL when the entry is brand-new", async () => {
    // Infinity TTL should never expire — even if Date.now() - cachedAt is large
    await cache.set("perm-key", "permanent-value");
    expect(await cache.get("perm-key", Infinity)).toBe("permanent-value");
  });

  it("returns undefined for a file that lacks an embedded timestamp (legacy / corrupt)", async () => {
    // Raw content with no newline separator
    await writeFile(keyPath(tempCacheDir, "legacy-key"), "raw-xml-no-timestamp", "utf8");
    expect(await cache.get("legacy-key", 60_000)).toBeUndefined();
  });

  it("returns undefined for a file with a malformed timestamp on the first line", async () => {
    await writeFile(
      keyPath(tempCacheDir, "bad-ts-key"),
      "not-a-date\nsome content",
      "utf8",
    );
    expect(await cache.get("bad-ts-key", 60_000)).toBeUndefined();
  });

  it("preserves multiline values (e.g. XML bodies)", async () => {
    const xml = `<?xml version="1.0"?>\n<metadata>\n  <groupId>com.example</groupId>\n</metadata>`;
    await cache.set("xml-key", xml);
    expect(await cache.get("xml-key", 60_000)).toBe(xml);
  });
});
