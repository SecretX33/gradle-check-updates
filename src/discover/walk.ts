// src/discover/walk.ts
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseSettingsFile } from "./settings.js";

/**
 * Directory names that are always skipped, regardless of depth in the tree.
 * These are hardcoded in v1 — no .gcuignore, no --ignore flag.
 */
const PRUNED_DIRS = new Set([
  ".gradle",
  ".idea",
  ".vscode",
  ".git",
  ".hg",
  ".svn",
  "build",
  "out",
  "target",
  "node_modules",
  ".pnpm-store",
  ".yarn",
  ".gcu",
  "__pycache__",
  ".venv",
  "venv",
]);

/**
 * Allow-list for dot-prefixed directory names that should NOT be pruned.
 * Empty in v1 — this is the documented extension point for future requests.
 */
const ALLOWED_DOT_DIRS = new Set<string>();

/**
 * Known Gradle build file names that are always collected regardless of
 * their parent directory name.
 */
const KNOWN_BUILD_FILES = new Set([
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
]);

/**
 * Returns true if a directory should be descended into during the walk.
 *
 * A directory is skipped when it is in the hardcoded prune list, or when its
 * name starts with `.` and it is not on the (currently empty) allow-list.
 */
function shouldDescendIntoDirectory(directoryName: string): boolean {
  if (PRUNED_DIRS.has(directoryName)) return false;
  if (directoryName.startsWith(".") && !ALLOWED_DOT_DIRS.has(directoryName)) return false;
  return true;
}

/**
 * Returns true if a file should be collected based on its name and its
 * immediate parent directory name.
 *
 * Rules:
 * - Any file in KNOWN_BUILD_FILES is always collected.
 * - Any `*.versions.toml` file whose immediate parent directory is named
 *   `gradle` is collected (e.g. `gradle/libs.versions.toml`).
 */
function shouldCollectFile(fileName: string, parentDirectoryName: string): boolean {
  if (KNOWN_BUILD_FILES.has(fileName)) return true;
  if (fileName.endsWith(".versions.toml") && parentDirectoryName === "gradle")
    return true;
  return false;
}

/**
 * A file discovered by the walker, tagged with metadata about how it should
 * be processed downstream.
 */
export type DiscoveredFile = {
  path: string;
  /** true for any file that should be processed as a Gradle version catalog */
  isCatalogToml: boolean;
};

/**
 * Returns true when `filePath` is accessible on disk (i.e. exists and can be
 * read), false otherwise.  Errors other than ENOENT are treated as non-existent
 * so the walker never throws on permission or other I/O oddities.
 */
async function fileExistsOnDisk(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The result of a directory walk: the list of discovered Gradle build files
 * and the union of all repository URLs declared in any settings files found.
 */
export type WalkResult = {
  /** All discovered Gradle build files, sorted by path. */
  files: DiscoveredFile[];
  /**
   * Union of `pluginRepositories` and `dependencyRepositories` from every
   * settings.gradle(.kts) file found during the walk, deduplicated and
   * insertion-ordered.
   */
  settingsRepositories: string[];
};

/**
 * Recursively walks `rootDir` and returns a `WalkResult` containing:
 * - A sorted list of discovered Gradle build files, each tagged with `isCatalogToml`.
 * - A deduplicated list of repository URLs declared in all settings files.
 *
 * After the initial tree walk, any settings.gradle(.kts) files in the result
 * are parsed via `parseSettingsFile` to find version catalog declarations and
 * repository URLs. Catalog files that exist on disk and are not already in the
 * result are appended with `isCatalogToml: true`. Repository URLs from
 * `pluginManagement { repositories {} }` and
 * `dependencyResolutionManagement { repositories {} }` are collected into
 * `settingsRepositories`.
 *
 * Directories in the hardcoded prune list (and any dot-prefixed directory not
 * on the empty allow-list) are skipped entirely and not descended into.
 */
export async function walk(rootDir: string): Promise<WalkResult> {
  const collectedPaths: string[] = [];
  const allSettingsRepositories: string[] = [];

  async function recurse(currentDirectory: string): Promise<void> {
    let directoryEntries;
    try {
      directoryEntries = await readdir(currentDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const directoryEntry of directoryEntries) {
      const entryName = directoryEntry.name;
      const entryFullPath = join(currentDirectory, entryName);

      if (directoryEntry.isDirectory()) {
        if (shouldDescendIntoDirectory(entryName)) {
          await recurse(entryFullPath);
        }
      } else if (directoryEntry.isFile()) {
        const parentDirectoryName = basename(currentDirectory);
        if (shouldCollectFile(entryName, parentDirectoryName)) {
          collectedPaths.push(entryFullPath);
        }
      }
    }
  }

  await recurse(rootDir);

  // Build the initial result set, tagging catalog TOMLs discovered by the
  // default gradle/*.versions.toml rule.
  const collectedPathSet = new Set(collectedPaths);
  const discoveredFiles: DiscoveredFile[] = collectedPaths.map((collectedPath) => ({
    path: collectedPath,
    isCatalogToml:
      collectedPath.endsWith(".versions.toml") &&
      basename(collectedPath.replace(/[/\\][^/\\]+$/, "")) === "gradle",
  }));

  // Parse any settings files to find catalog declarations at non-standard paths.
  const settingsFilePaths = collectedPaths.filter(
    (collectedPath) =>
      collectedPath.endsWith("settings.gradle") ||
      collectedPath.endsWith("settings.gradle.kts"),
  );

  for (const settingsFilePath of settingsFilePaths) {
    let settingsParseResult;
    try {
      settingsParseResult = await parseSettingsFile(settingsFilePath);
    } catch {
      // If we cannot parse the settings file, skip it silently — the walk
      // still returns whatever was already collected.
      continue;
    }

    for (const catalogEntry of settingsParseResult.catalogFiles) {
      const catalogPath = catalogEntry.path;
      if (collectedPathSet.has(catalogPath)) continue;

      const catalogExists = await fileExistsOnDisk(catalogPath);
      if (!catalogExists) continue;

      collectedPathSet.add(catalogPath);
      discoveredFiles.push({ path: catalogPath, isCatalogToml: true });
    }

    for (const repositoryUrl of settingsParseResult.pluginRepositories) {
      allSettingsRepositories.push(repositoryUrl);
    }
    for (const repositoryUrl of settingsParseResult.dependencyRepositories) {
      allSettingsRepositories.push(repositoryUrl);
    }
  }

  // Sort by path for deterministic ordering.
  discoveredFiles.sort((fileA, fileB) => fileA.path.localeCompare(fileB.path));

  return {
    files: discoveredFiles,
    settingsRepositories: [...new Set(allSettingsRepositories)],
  };
}
