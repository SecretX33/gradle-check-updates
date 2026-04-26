import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class Cache {
  constructor(private readonly cacheDir: string) {}

  private keyPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return join(this.cacheDir, hash);
  }

  async get(key: string, ttlMs: number): Promise<string | undefined> {
    const filePath = this.keyPath(key);
    try {
      const raw = await readFile(filePath, "utf8");
      const newlineIndex = raw.indexOf("\n");
      if (newlineIndex === -1) return undefined; // invalid / legacy format
      const timestampLine = raw.slice(0, newlineIndex);
      const cachedAt = new Date(timestampLine).getTime();
      if (isNaN(cachedAt)) return undefined; // malformed timestamp
      if (Date.now() - cachedAt > ttlMs) return undefined; // expired
      return raw.slice(newlineIndex + 1);
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const timestamp = new Date().toISOString();
    await writeFile(this.keyPath(key), `${timestamp}\n${value}`, "utf8");
  }
}
