// src/cli/run.ts

import { access, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

import kleur from "kleur";

import type { ParsedArgs } from "./args.js";
import type { DiscoveredFile, WalkResult } from "../discover/index.js";
import { extractRepositoryUrls, walk } from "../discover/index.js";
import { locateGroovy } from "../formats/groovy-dsl/locate.js";
import { locateKotlin } from "../formats/kotlin-dsl/locate.js";
import { locateVersionCatalog } from "../formats/version-catalog/locate.js";
import { locateProperties } from "../formats/properties/locate.js";
import { resolveRefs } from "../refs/index.js";
import { ConfigError, loadCredentials } from "../config/index.js";
import type { UserConfig } from "../config/schema.js";
import { UserConfigSchema } from "../config/schema.js";
import { ConfigResolver } from "../config/resolve.js";
import type { MavenMetadata, RepoCredentials } from "../repos/index.js";
import {
  Cache,
  fetchMetadata,
  fetchVersionTimestamp,
  RepoNetworkError,
} from "../repos/index.js";
import { compareVersions } from "../version/compare.js";
import { runPolicy } from "../policy/index.js";
import type { MetadataAccessor, PolicyOptions } from "../policy/policy.js";
import { renderTable } from "../report/table.js";
import { renderJson } from "../report/json.js";
import { runInteractivePicker } from "../report/interactive.js";
import { rewriteFile } from "../rewrite/file.js";
import { renderReplacement } from "../policy/shape-rules.js";
import type { Decision, Edit, Occurrence } from "../types.js";
import { determineExitCode } from "./exit.js";
import { getErrorMessage, parseConfig } from "../util/error.js";

const DEFAULT_REPOS = [
  "https://repo.maven.apache.org/maven2/",
  "https://maven.google.com/",
  "https://plugins.gradle.org/m2/",
];

const DEFAULT_TARGET = "major" as const;

export type RunOptions = {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** Override the gcu home directory (defaults to ~/.gcu). Used in tests to isolate caches. */
  gcuHome?: string;
};

function detectLocator(
  filePath: string,
): ((file: string, contents: string) => Occurrence[]) | null {
  if (filePath.endsWith(".gradle.kts")) return locateKotlin;
  if (filePath.endsWith(".gradle")) return locateGroovy;
  if (filePath.endsWith(".toml")) return locateVersionCatalog;
  if (filePath.endsWith(".properties")) return locateProperties;
  return null;
}

async function loadUserConfig(configPath: string): Promise<UserConfig | undefined> {
  try {
    const text = await readFile(configPath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return parseConfig(UserConfigSchema, parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function run(args: ParsedArgs, options?: RunOptions): Promise<number> {
  const stdout = options?.stdout ?? process.stdout;
  const stderr = options?.stderr ?? process.stderr;
  const isStderrTTY = Boolean((stderr as NodeJS.WriteStream).isTTY);
  const quietMode = args.format === "json";

  // Progress bar state — declared early so the stderrForClient closure can reference them.
  let progressActive = false;
  let timestampProgressActive = false;

  // Stderr wrapper passed to repo clients: moves off the progress bar line before any
  // verbose log message so GET/HEAD lines never get appended to the bar's line.
  const stderrForClient: NodeJS.WritableStream = {
    write(chunk: string | Uint8Array): boolean {
      if (isStderrTTY && (progressActive || timestampProgressActive)) {
        // Move off the active progress bar line so the log message doesn't overwrite it.
        // Keep the flags live — the bar continues on the next line after this message.
        stderr.write("\n");
      }
      return stderr.write(chunk as string);
    },
  } as unknown as NodeJS.WritableStream;

  const projectRoot = resolve(args.directory);

  const gradleRootFiles = [
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
  ];
  const rootFileChecks = await Promise.all(
    gradleRootFiles.map((name) =>
      access(join(projectRoot, name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (!rootFileChecks.some(Boolean)) {
    const bold = (text: string): string => (isStderrTTY ? kleur.bold(text) : text);
    stderr.write(
      `gcu: did not find ${bold("build.gradle")} or ${bold("build.gradle.kts")} in ${bold(projectRoot)}, aborting...\n`,
    );
    return 2;
  }

  const gcuHome = options?.gcuHome ?? join(homedir(), ".gcu");

  let userConfig: UserConfig | undefined;
  try {
    userConfig = await loadUserConfig(join(gcuHome, "config.json"));
  } catch (error) {
    if (error instanceof ConfigError) {
      stderr.write(
        `gcu: invalid config at '~/.gcu/config.json': ${getErrorMessage(error)}\n`,
      );
      return 2;
    }
    throw error;
  }
  if (args.verboseLevel >= 1 && userConfig !== undefined) {
    stderr.write(`Loaded user config: ${join(gcuHome, "config.json")}\n`);
  }

  let credentials: Map<string, RepoCredentials>;
  try {
    credentials = await loadCredentials(join(gcuHome, "credentials.json"));
  } catch (error) {
    if (error instanceof ConfigError) {
      stderr.write(
        `gcu: invalid credentials at '~/.gcu/credentials.json': ${getErrorMessage(error)}\n`,
      );
      return 2;
    }
    throw error;
  }
  if (args.verboseLevel >= 1 && credentials.size > 0) {
    stderr.write(
      `Loaded credentials for ${credentials.size} ${credentials.size === 1 ? "repository" : "repositories"}\n`,
    );
  }

  const configResolver = new ConfigResolver(
    projectRoot,
    userConfig,
    args.verboseLevel >= 1
      ? (configPath, config) => {
          stderr.write(`Found config file: ${configPath}\n`);
          const entries = Object.entries(config).filter(
            ([, value]) => value !== undefined,
          );
          for (const [key, value] of entries) {
            stderr.write(`  ${key}: ${JSON.stringify(value)}\n`);
          }
        }
      : undefined,
    (configPath, error) => {
      stderr.write(
        `gcu: warning: could not load config file ${configPath}: ${getErrorMessage(error)}\n`,
      );
    },
  );

  // ── File scanning phase (walk + parse) ──────────────────────────────────────
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerFrameIndex = 0;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;

  if (!quietMode) {
    if (isStderrTTY && args.verboseLevel === 0) {
      // In TTY non-verbose mode: animated braille spinner on its own line.
      // Initial write has no \r so it appears cleanly; subsequent updates use \x1b[2K\r to
      // erase and rewrite the same line.
      stderr.write(`Scanning files... ${SPINNER_FRAMES[0]!}`);
      spinnerInterval = setInterval(() => {
        spinnerFrameIndex = (spinnerFrameIndex + 1) % SPINNER_FRAMES.length;
        stderr.write(`\x1b[2K\rScanning files... ${SPINNER_FRAMES[spinnerFrameIndex]!}`);
      }, 80);
    } else {
      stderr.write("Scanning files...\n");
    }
  }

  function clearSpinner(): void {
    if (spinnerInterval !== null) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      if (!quietMode && isStderrTTY) stderr.write("\x1b[2K\rScanning files... done\n");
    }
  }

  let walkResult: WalkResult;
  try {
    walkResult = await walk(projectRoot);
  } catch (error) {
    clearSpinner();
    stderr.write(`gcu: discovery error: ${(error as Error).message}\n`);
    return 3;
  }
  const discoveredFiles: DiscoveredFile[] = walkResult.files;
  const settingsRepositories: string[] = walkResult.settingsRepositories;

  const allOccurrences: Occurrence[] = [];
  const autoDiscoveredRepoUrls = new Set<string>();

  for (const discoveredFile of discoveredFiles) {
    const { path: buildFile, isCatalogToml } = discoveredFile;

    // For catalog TOMLs discovered via settings declarations, force the
    // version-catalog locator regardless of file extension.
    const locator = isCatalogToml ? locateVersionCatalog : detectLocator(buildFile);
    if (locator === null) continue;

    let contents: string;
    try {
      contents = await readFile(buildFile, "utf8");
    } catch (error) {
      clearSpinner();
      stderr.write(`gcu: could not read ${buildFile}: ${(error as Error).message}\n`);
      return 3;
    }

    let fileOccurrences: Occurrence[];
    try {
      fileOccurrences = locator(buildFile, contents);
    } catch (error) {
      clearSpinner();
      stderr.write(`gcu: parse error in ${buildFile}: ${(error as Error).message}\n`);
      return 3;
    }
    allOccurrences.push(...fileOccurrences);

    if (args.verboseLevel >= 1) {
      const relPath = relative(projectRoot, buildFile).replace(/\\/g, "/");
      const count = fileOccurrences.length;
      stderr.write(
        `  ${relPath}  (${count} ${count === 1 ? "occurrence" : "occurrences"})\n`,
      );
    }

    if (buildFile.endsWith(".gradle") || buildFile.endsWith(".gradle.kts")) {
      const fileType = buildFile.endsWith(".gradle.kts") ? "kotlin-dsl" : "groovy-dsl";
      const discoveredUrls = extractRepositoryUrls(contents, fileType);
      for (const url of discoveredUrls) {
        autoDiscoveredRepoUrls.add(url);
      }
    }
  }

  clearSpinner();

  const { occurrences: resolvedOccurrences, errors: refErrors } =
    resolveRefs(allOccurrences);

  for (const refError of refErrors) {
    stderr.write(
      `gcu: warning: unresolved variable reference \$${refError.varName} in ${refError.consumer.file}\n`,
    );
  }

  // Filter: definition stubs are edit-site placeholders; consumers carry proper group/artifact
  const policyOccurrences = resolvedOccurrences.filter(
    (occurrence) =>
      !occurrence.dependencyKey.startsWith("catalog-version:") &&
      !occurrence.dependencyKey.startsWith("prop:"),
  );

  const repoList = [
    ...DEFAULT_REPOS,
    ...[...autoDiscoveredRepoUrls],
    ...settingsRepositories,
  ];
  const uniqueRepos = [...new Set(repoList)];

  const uniqueDependencies = new Map<string, { group: string; artifact: string }>();
  for (const occurrence of policyOccurrences) {
    const dependencyKey = `${occurrence.group}:${occurrence.artifact}`;
    if (!uniqueDependencies.has(dependencyKey)) {
      uniqueDependencies.set(dependencyKey, {
        group: occurrence.group,
        artifact: occurrence.artifact,
      });
    }
  }

  if (args.verboseLevel >= 1) {
    const fileCount = new Set(policyOccurrences.map((occurrence) => occurrence.file))
      .size;
    const depCount = uniqueDependencies.size;
    stderr.write(
      `Found ${depCount} unique ${depCount === 1 ? "dependency" : "dependencies"} across ${fileCount} ${fileCount === 1 ? "file" : "files"}\n`,
    );
    stderr.write(
      `\nQuerying ${uniqueRepos.length} ${uniqueRepos.length === 1 ? "repository" : "repositories"}:\n`,
    );
    for (const repoUrl of uniqueRepos) {
      stderr.write(`  ${repoUrl}\n`);
    }
    stderr.write("\n");
  }

  const cacheDir = userConfig?.cacheDir
    ? resolve(userConfig.cacheDir)
    : join(gcuHome, "cache");

  if (args.clearCache) {
    await rm(cacheDir, { recursive: true, force: true });
    if (args.verboseLevel >= 1) stderr.write("Cache cleared.\n");
  }

  const cache = new Cache(join(cacheDir, "metadata"));
  const clientOptions = {
    cache,
    credentials,
    noCache: args.noCache || (userConfig?.noCache ?? false),
    verbose: args.verboseLevel >= 1,
    stderr: stderrForClient,
  };

  // Build config map before the metadata fetch loop so cooldown settings are available
  const occurrenceConfigMap = new Map<Occurrence, PolicyOptions>();
  for (const occurrence of policyOccurrences) {
    let fileConfig: UserConfig;
    try {
      fileConfig = await configResolver.resolveForFile(occurrence.file);
    } catch (error) {
      if (error instanceof ConfigError) {
        stderr.write(
          `gcu: invalid config at '${occurrence.file}': ${getErrorMessage(error)}\n`,
        );
        return 2;
      }
      throw error;
    }
    occurrenceConfigMap.set(occurrence, {
      target: args.target ?? fileConfig.target ?? DEFAULT_TARGET,
      pre: args.pre || (fileConfig.pre ?? false),
      cooldownDays: args.cooldown > 0 ? args.cooldown : (fileConfig.cooldown ?? 0),
      allowDowngrade: args.allowDowngrade || (fileConfig.allowDowngrade ?? false),
      includes: args.include.length > 0 ? args.include : (fileConfig.include ?? []),
      excludes: args.exclude.length > 0 ? args.exclude : (fileConfig.exclude ?? []),
    });
  }
  const getConfig = (occurrence: Occurrence): PolicyOptions =>
    occurrenceConfigMap.get(occurrence) ?? {
      target: args.target ?? DEFAULT_TARGET,
      pre: args.pre,
      cooldownDays: args.cooldown,
      allowDowngrade: args.allowDowngrade,
      includes: args.include,
      excludes: args.exclude,
    };

  const aggregatedVersions = new Map<string, string[]>();
  const totalDeps = uniqueDependencies.size;
  let completedDeps = 0;

  const maxConcurrency = args.concurrency;
  let concurrentCount = 0;
  const concurrentWaiters: Array<() => void> = [];
  function acquireSlot(): Promise<void> {
    return new Promise((resolve) => {
      if (concurrentCount < maxConcurrency) {
        concurrentCount++;
        resolve();
      } else {
        concurrentWaiters.push(() => {
          concurrentCount++;
          resolve();
        });
      }
    });
  }
  function releaseSlot(): void {
    concurrentCount--;
    const next = concurrentWaiters.shift();
    if (next) next();
  }

  function writeProgress(): void {
    if (quietMode || !isStderrTTY || totalDeps === 0) return;
    progressActive = true;
    const barWidth = 22;
    const filled = Math.round((completedDeps / totalDeps) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const pct = Math.round((completedDeps / totalDeps) * 100);
    stderr.write(
      `\x1b[2K\rFetching metadata...  [${bar}]  ${completedDeps}/${totalDeps} (${pct}%)`,
    );
  }

  if (!quietMode && !isStderrTTY && totalDeps > 0) {
    stderr.write("Fetching metadata from Maven repositories...\n");
  }

  let hadNetworkError = false;

  await Promise.all(
    [...uniqueDependencies].map(async ([dependencyKey, { group, artifact }]) => {
      const allVersions: string[] = [];
      let depNetworkErrorCount = 0;

      for (const repoUrl of uniqueRepos) {
        await acquireSlot();
        let metadata: MavenMetadata;
        try {
          metadata = await fetchMetadata(repoUrl, group, artifact, clientOptions);
        } catch (error) {
          releaseSlot();
          if (error instanceof RepoNetworkError) {
            if (progressActive) {
              stderr.write("\x1b[2K\n");
              progressActive = false;
            }
            stderr.write(
              `gcu: warning: network error fetching ${group}:${artifact} from ${repoUrl}: ${error.message}\n`,
            );
            depNetworkErrorCount++;
            hadNetworkError = true;
            continue;
          }
          throw error;
        }
        releaseSlot();
        allVersions.push(...metadata.versions);
      }

      completedDeps++;
      writeProgress();

      if (allVersions.length === 0 && depNetworkErrorCount > 0) {
        // All repos failed for this dep — propagate as fatal network error after full run
        aggregatedVersions.set(dependencyKey, []);
      } else {
        const deduplicatedVersions = [...new Set(allVersions)];
        aggregatedVersions.set(dependencyKey, deduplicatedVersions);
      }
    }),
  );

  if (progressActive) {
    stderr.write("\n");
    progressActive = false;
  }

  const hasAnyVersions = [...aggregatedVersions.values()].some(
    (versions) => versions.length > 0,
  );
  if (hadNetworkError && !hasAnyVersions && uniqueDependencies.size > 0) {
    return 4;
  }

  // Step 2: Identify deps with active cooldown
  const cooldownDeps = new Set<string>();
  for (const occurrence of policyOccurrences) {
    if ((getConfig(occurrence).cooldownDays ?? 0) > 0) {
      cooldownDeps.add(`${occurrence.group}:${occurrence.artifact}`);
    }
  }

  // Step 3: Lazy cascade timestamp fetch — newest-first, stop once a soaked version found
  const timestampCache = new Cache(join(cacheDir, "timestamps"));
  const timestampOptions = { ...clientOptions, cache: timestampCache };
  const publishedAtMap = new Map<string, number>(); // "group:artifact:version" → ms since epoch

  // Phase 2 — timestamp cascade (reuses shared semaphore; concurrentCount is 0 here)
  let completedTimestampDeps = 0;
  const totalTimestampDeps = cooldownDeps.size;

  function writeTimestampProgress(): void {
    if (quietMode || !isStderrTTY || totalTimestampDeps === 0) return;
    timestampProgressActive = true;
    const barWidth = 22;
    const filled = Math.round((completedTimestampDeps / totalTimestampDeps) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const pct = Math.round((completedTimestampDeps / totalTimestampDeps) * 100);
    stderr.write(
      `\x1b[2K\rFetching timestamps... [${bar}]  ${completedTimestampDeps}/${totalTimestampDeps} (${pct}%)`,
    );
  }

  if (cooldownDeps.size > 0) {
    if (!quietMode && !isStderrTTY) {
      stderr.write("Fetching timestamps...\n");
    }

    async function fetchOneTimestamp(
      group: string,
      artifact: string,
      version: string,
    ): Promise<void> {
      const mapKey = `${group}:${artifact}:${version}`;
      if (publishedAtMap.has(mapKey)) return; // already resolved (in-memory dedup)
      for (const repoUrl of uniqueRepos) {
        await acquireSlot();
        try {
          const lastModified = await fetchVersionTimestamp(
            repoUrl,
            group,
            artifact,
            version,
            timestampOptions,
          );
          if (lastModified !== undefined) {
            const ms = new Date(lastModified).getTime();
            if (!isNaN(ms)) {
              publishedAtMap.set(mapKey, ms);
              return; // found from this repo, skip remaining repos
            }
          }
        } finally {
          releaseSlot();
        }
      }
    }

    // Per-dep cascade: newest → oldest, stop once a soaked version is found
    const cascadePromises: Promise<void>[] = [];
    for (const [depKey, { group, artifact }] of uniqueDependencies) {
      if (!cooldownDeps.has(depKey)) continue;
      const maxCooldownDays = Math.max(
        ...[...policyOccurrences]
          .filter((occurrence) => `${occurrence.group}:${occurrence.artifact}` === depKey)
          .map((occurrence) => getConfig(occurrence).cooldownDays ?? 0),
      );
      const cutoffMs = Date.now() - maxCooldownDays * 86_400_000;
      const sortedVersions = [...(aggregatedVersions.get(depKey) ?? [])].sort((a, b) =>
        compareVersions(b, a),
      ); // descending (newest first)

      cascadePromises.push(
        (async () => {
          for (const version of sortedVersions) {
            await fetchOneTimestamp(group, artifact, version);
            const ts = publishedAtMap.get(`${group}:${artifact}:${version}`);
            if (ts !== undefined && ts <= cutoffMs) break; // found soaked version, stop
          }
          completedTimestampDeps++;
          writeTimestampProgress();
        })(),
      );
    }
    await Promise.all(cascadePromises);

    if (timestampProgressActive) {
      stderr.write("\n");
      timestampProgressActive = false;
    }
  }

  const metadataAccessor: MetadataAccessor = {
    getVersions(group: string, artifact: string): string[] {
      return aggregatedVersions.get(`${group}:${artifact}`) ?? [];
    },
    getPublishedAt(group: string, artifact: string, version: string): number | undefined {
      return publishedAtMap.get(`${group}:${artifact}:${version}`);
    },
  };

  const decisions = runPolicy(policyOccurrences, metadataAccessor, getConfig, new Date());

  let interactiveSelectedDecisions: Decision[] | null = null;

  if (args.format === "json") {
    const jsonOutput = renderJson(decisions);
    stdout.write(jsonOutput + "\n");
  } else if (args.interactive) {
    try {
      const pickerResult = await runInteractivePicker(decisions);
      interactiveSelectedDecisions = pickerResult.selectedDecisions;
    } catch (error) {
      if ((error as Error)?.name === "ExitPromptError") return 0;
      throw error;
    }
  } else {
    const tableOutput = renderTable(
      decisions,
      args.verboseLevel,
      projectRoot,
      args.upgrade,
    );
    stdout.write(tableOutput + "\n");
  }

  if (interactiveSelectedDecisions !== null) {
    if (interactiveSelectedDecisions.length > 0) {
      await applyDecisions(interactiveSelectedDecisions, stderr);
    }
  } else if (args.upgrade) {
    const upgradeDecisions = decisions.filter(
      (decision) => decision.status === "upgrade",
    );
    if (upgradeDecisions.length > 0) {
      await applyDecisions(upgradeDecisions, stderr);
    }
  }

  return determineExitCode(decisions, {
    upgradeMode: args.upgrade || interactiveSelectedDecisions !== null,
    errorOnOutdated: args.errorOnOutdated,
  });
}

async function applyDecisions(
  upgradeDecisions: Decision[],
  stderr: NodeJS.WritableStream,
): Promise<void> {
  // Use a Map keyed by "file:byteStart:byteEnd" to deduplicate edits that share the
  // same edit site (e.g. two consumers of the same gradle.properties variable both
  // resolving to the same byte range after ref resolution).
  const editsByFile = new Map<string, Map<string, Edit>>();

  for (const decision of upgradeDecisions) {
    if (decision.status !== "upgrade" || decision.newVersion === undefined) continue;

    const { occurrence, newVersion } = decision;
    const replacement = renderReplacement(occurrence, newVersion);
    const edit: Edit = {
      byteStart: occurrence.byteStart,
      byteEnd: occurrence.byteEnd,
      replacement,
    };

    const editSiteKey = `${occurrence.byteStart}:${occurrence.byteEnd}`;
    const fileEdits = editsByFile.get(occurrence.file) ?? new Map<string, Edit>();
    fileEdits.set(editSiteKey, edit);
    editsByFile.set(occurrence.file, fileEdits);
  }

  for (const [filePath, editMap] of editsByFile) {
    try {
      await rewriteFile(filePath, [...editMap.values()]);
    } catch (error) {
      stderr.write(`gcu: failed to rewrite ${filePath}: ${(error as Error).message}\n`);
    }
  }
}
