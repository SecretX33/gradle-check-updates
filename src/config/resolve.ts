import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProjectConfigSchema, type ProjectConfig, type UserConfig } from "./schema.js";

const CONFIG_NAMES = [".gcu.json"];
// Note: .gcu.json5 is not supported in v1 — JSON.parse does not handle JSON5 syntax.
// A JSON5 parser would be needed before adding the filename here.

export class ConfigResolver {
  // Cache maps a directory to the full merged chain result rooted at that directory.
  private readonly directoryCache = new Map<string, UserConfig>();
  private readonly projectRoot: string;
  /** Number of times a config file was actually read from disk (for testing memoization). */
  fileReadCount = 0;

  constructor(
    projectRoot: string,
    private readonly userConfig: UserConfig | undefined,
    private readonly onConfigLoaded?: (configPath: string, config: ProjectConfig) => void,
    private readonly onConfigError?: (configPath: string, error: Error) => void,
  ) {
    this.projectRoot = projectRoot;
  }

  async resolveForFile(filePath: string, isCatalogToml = false): Promise<UserConfig> {
    const startDir = isCatalogToml ? dirname(dirname(filePath)) : dirname(filePath);
    return this.resolveChainFromDir(startDir);
  }

  private async resolveChainFromDir(startDir: string): Promise<UserConfig> {
    if (this.directoryCache.has(startDir)) {
      return this.directoryCache.get(startDir)!;
    }

    // Collect all directories from startDir up to (and including) projectRoot.
    const dirChain: string[] = [];
    let currentDir = startDir;
    while (true) {
      dirChain.push(currentDir);
      if (currentDir === this.projectRoot) break;
      const parentDir = dirname(currentDir);
      // Stop if we've reached the filesystem root or aren't descending anymore.
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    // Walk outermost → innermost so each step's merged value reflects "configs from this
    // directory up to projectRoot" — never the deeper inner layers.
    dirChain.reverse();

    // The cache stores a *per-directory* partial merge: cache[dir] = merge of all
    // .gcu.json files from `dir` up to projectRoot, layered on top of userConfig. Caching
    // every step keeps siblings cheap while preventing inner layers from leaking upward.
    let merged: UserConfig = this.userConfig ?? {};
    for (const dir of dirChain) {
      const cached = this.directoryCache.get(dir);
      if (cached !== undefined) {
        merged = cached;
        continue;
      }
      const found = await this.tryLoadConfigAt(dir);
      if (found !== null) {
        merged = { ...merged, ...found };
      }
      this.directoryCache.set(dir, merged);
    }

    return merged;
  }

  private async tryLoadConfigAt(dir: string): Promise<ProjectConfig | null> {
    for (const configName of CONFIG_NAMES) {
      const configPath = join(dir, configName);
      try {
        const text = await readFile(configPath, "utf8");
        this.fileReadCount++;
        const parsed = JSON.parse(text) as unknown;
        const config = ProjectConfigSchema.parse(parsed);
        this.onConfigLoaded?.(configPath, config);
        return config;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        // JSON syntax errors are treated as warnings — the file is skipped but the run
        // continues. This handles cases like JSON5/JSONC comments or trailing commas.
        if (err instanceof SyntaxError) {
          this.onConfigError?.(configPath, err);
          continue;
        }
        throw err;
      }
    }
    return null;
  }
}
