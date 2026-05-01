import { mkdtemp, readFile, rm, cp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { run } from "../../src/cli/run.js";
import { walk } from "../../src/discover/index.js";
import { locateKotlin } from "../../src/formats/kotlin-dsl/locate.js";
import { locateVersionCatalog } from "../../src/formats/version-catalog/locate.js";
import { resolveRefs } from "../../src/refs/index.js";
import type { ParsedArgs } from "../../src/cli/args.js";
import type { Occurrence } from "../../src/types.js";

// ── Fixture path ──────────────────────────────────────────────────────────────
const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/version-catalog/real-project-mix",
);

// ── Repo URLs ─────────────────────────────────────────────────────────────────
const MAVEN_BASE = "https://repo.maven.apache.org/maven2/";
const GOOGLE_BASE = "https://maven.google.com/";
const GRADLE_BASE = "https://plugins.gradle.org/m2/";

const MAVEN_CENTRAL_URL = "https://repo.maven.apache.org/maven2/";

function metadataUrlFor(
  repoBase: string,
  groupId: string,
  artifactId: string,
): string {
  return `${repoBase}${groupId.replace(/\./g, "/")}/${artifactId}/maven-metadata.xml`;
}

// ── XML helpers ───────────────────────────────────────────────────────────────
const EMPTY_METADATA = `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`;

function buildMetadataXml(
  groupId: string,
  artifactId: string,
  versions: string[],
): string {
  const versionTags = versions.map((value) => `      <version>${value}</version>`).join("\n");
  const latest = versions[versions.length - 1] ?? "";
  return `<?xml version="1.0"?>
<metadata>
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <versioning>
    <latest>${latest}</latest>
    <release>${latest}</release>
    <versions>
${versionTags}
    </versions>
  </versioning>
</metadata>`;
}

// ── Bump current version into a small list of candidates ──────────────────────
/**
 * For an arbitrary current version literal, produce an upgrade candidate that
 * is guaranteed to be strictly greater under semantic comparison and shares the
 * same shape as the input. The strategy: parse the leading numeric segment and
 * increment the last numeric component, preserving any non-numeric suffix.
 */
function bumpVersion(currentRaw: string): string {
  // Split into numeric prefix and qualifier suffix.
  const match = currentRaw.match(/^([0-9]+(?:\.[0-9]+)*)(.*)$/);
  if (!match) return currentRaw;
  const numericPart = match[1] ?? "";
  const qualifier = match[2] ?? "";
  const segments = numericPart.split(".").map((segment) => Number(segment));
  if (segments.length === 0) return currentRaw;
  segments[segments.length - 1] = (segments[segments.length - 1] ?? 0) + 1;
  return `${segments.join(".")}${qualifier}`;
}

/**
 * Build a candidate-version array for a (group, artifact) pair given the
 * current literal. Returns [current, bumped] so the upgrade is always a
 * single patch step above the existing version.
 */
function candidatesFor(currentRaw: string): string[] {
  const bumped = bumpVersion(currentRaw);
  if (bumped === currentRaw) return [currentRaw];
  return [currentRaw, bumped];
}

// ── Walk fixture and gather every (group, artifact) we need to mock ──────────
type DependencyEntry = {
  group: string;
  artifact: string;
  candidates: string[];
};

async function readAllFiles(rootDir: string): Promise<string[]> {
  const collected: string[] = [];
  async function recurse(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden / common build dirs to mirror the walker
        if (entry.name.startsWith(".") || entry.name === "build" || entry.name === "node_modules") {
          continue;
        }
        await recurse(fullPath);
      } else if (entry.isFile()) {
        collected.push(fullPath);
      }
    }
  }
  const rootStat = await stat(rootDir);
  if (rootStat.isDirectory()) await recurse(rootDir);
  return collected;
}

/**
 * Run discover + locate + ref-resolve against the fixture so the integration
 * test can construct a complete mock map without hand-listing every coordinate
 * (the catalog has 76 libraries plus plugins plus three force() entries plus a
 * settings plugin).
 */
async function gatherFixtureDependencies(rootDir: string): Promise<DependencyEntry[]> {
  const walkResult = await walk(rootDir);
  const allOccurrences: Occurrence[] = [];

  for (const discoveredFile of walkResult.files) {
    const contents = await readFile(discoveredFile.path, "utf8");
    if (discoveredFile.isCatalogToml) {
      allOccurrences.push(...locateVersionCatalog(discoveredFile.path, contents));
    } else if (discoveredFile.path.endsWith(".gradle.kts")) {
      allOccurrences.push(...locateKotlin(discoveredFile.path, contents));
    }
  }

  const { occurrences: resolved } = resolveRefs(allOccurrences);

  const byKey = new Map<string, DependencyEntry>();
  for (const occurrence of resolved) {
    const dependencyKey = `${occurrence.group}:${occurrence.artifact}`;
    if (byKey.has(dependencyKey)) continue;
    byKey.set(dependencyKey, {
      group: occurrence.group,
      artifact: occurrence.artifact,
      candidates: candidatesFor(occurrence.currentRaw),
    });
  }
  return [...byKey.values()];
}

/**
 * Build a mock map covering every (dep, repo) tuple. Library/dep coordinates
 * resolve in mavenCentral; plugin marker artifacts (`*.gradle.plugin`) resolve
 * in the gradle plugin portal. All other (dep, repo) tuples return
 * EMPTY_METADATA so the no-network guard never fires.
 */
function buildFullMockMap(dependencies: DependencyEntry[]): Record<string, string> {
  const mockMap: Record<string, string> = {};
  for (const dependency of dependencies) {
    const isPluginMarker = dependency.artifact.endsWith(".gradle.plugin");
    const populatedXml = buildMetadataXml(
      dependency.group,
      dependency.artifact,
      dependency.candidates,
    );

    const mavenUrl = metadataUrlFor(MAVEN_BASE, dependency.group, dependency.artifact);
    const googleUrl = metadataUrlFor(GOOGLE_BASE, dependency.group, dependency.artifact);
    const gradleUrl = metadataUrlFor(GRADLE_BASE, dependency.group, dependency.artifact);

    if (isPluginMarker) {
      mockMap[mavenUrl] = EMPTY_METADATA;
      mockMap[googleUrl] = EMPTY_METADATA;
      mockMap[gradleUrl] = populatedXml;
    } else {
      mockMap[mavenUrl] = populatedXml;
      mockMap[googleUrl] = EMPTY_METADATA;
      mockMap[gradleUrl] = EMPTY_METADATA;
    }
  }
  return mockMap;
}

// ── ParsedArgs factory ────────────────────────────────────────────────────────
function buildArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    directory: FIXTURE_ROOT,
    upgrade: false,
    interactive: false,
    target: "major",
    pre: true, // allow prereleases so 2.23.0-alpha → 2.23.1-alpha is reachable
    cooldown: 0,
    allowDowngrade: false,
    include: [],
    exclude: [],
    format: "text",
    errorOnOutdated: false,
    verboseLevel: 0,
    noCache: false,
    clearCache: false,
    concurrency: 5,
    ...overrides,
  };
}

// ── Stream capture helper ─────────────────────────────────────────────────────
function makeWritable(): { stream: NodeJS.WritableStream; get output(): string } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    get output() {
      return chunks.join("");
    },
  };
}

// ── Temp dir for write tests ──────────────────────────────────────────────────
let tempDir: string;

async function copyFixtureToTemp(): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), "gcu-real-project-mix-"));
  await cp(FIXTURE_ROOT, destination, { recursive: true });
  return destination;
}

beforeEach(() => {
  tempDir = "";
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("real-project-mix: detection coverage (preview)", () => {
  it("detects catalog deps, force() entries, and settings plugins; excludes module project versions", async () => {
    const dependencies = await gatherFixtureDependencies(FIXTURE_ROOT);
    mockRepo(buildFullMockMap(dependencies));

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    const output = stdout.output;

    // Settings plugin (top-level plugins {} block of settings.gradle.kts)
    expect(output).toContain("foojay-resolver-convention");

    // protobuf-java appears via both the catalog ([versions] protobuf) and
    // hardcoded `force(...)` calls in the root build.gradle.kts.
    expect(output).toContain("protobuf-java");

    // nimbus-jose-jwt is catalog-absent — it only appears via force() in
    // build.gradle.kts. Its presence proves force() occurrences are detected.
    expect(output).toContain("nimbus-jose-jwt");

    // A handful of catalog-only entries to ensure the non-standard catalog
    // path was actually located, parsed, and ref-resolved end-to-end.
    expect(output).toContain("kotlinx-coroutines-core");
    expect(output).toContain("hibernate-vector");
    expect(output).toContain("logstash-logback-encoder");

    // Module project versions must never appear as a dependency literal
    expect(output).not.toContain("1.0.0-SNAPSHOT");
  });
});

describe("real-project-mix: catalog discovery from settings", () => {
  it("discovers gradle/libs/versions.toml at non-standard path and collects mavenCentral as a settings repository", async () => {
    const walkResult = await walk(FIXTURE_ROOT);

    const catalogTomlFiles = walkResult.files.filter((file) => file.isCatalogToml);
    const expectedCatalogSuffix = join("gradle", "libs", "versions.toml");
    const hasNonStandardCatalog = catalogTomlFiles.some((file) =>
      file.path.endsWith(expectedCatalogSuffix),
    );
    expect(hasNonStandardCatalog).toBe(true);

    expect(walkResult.settingsRepositories).toContain(MAVEN_CENTRAL_URL);
  });
});

describe("real-project-mix: module project versions are not dependency occurrences", () => {
  it("never produces an occurrence for `version = \"1.0.0-SNAPSHOT\"` in submodule build files", async () => {
    const walkResult = await walk(FIXTURE_ROOT);
    const allOccurrences: Occurrence[] = [];

    for (const discoveredFile of walkResult.files) {
      if (!discoveredFile.path.endsWith(".gradle.kts")) continue;
      const contents = await readFile(discoveredFile.path, "utf8");
      allOccurrences.push(...locateKotlin(discoveredFile.path, contents));
    }

    const snapshotMatches = allOccurrences.filter(
      (occurrence) => occurrence.currentRaw === "1.0.0-SNAPSHOT",
    );
    expect(snapshotMatches).toEqual([]);
  });
});

describe("real-project-mix: -u mode rewrites the catalog file", () => {
  it("upgrades versions.toml in place but leaves module build files untouched", async () => {
    tempDir = await copyFixtureToTemp();

    const dependencies = await gatherFixtureDependencies(tempDir);
    mockRepo(buildFullMockMap(dependencies));

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(
      buildArgs({ directory: tempDir, upgrade: true }),
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);

    const originalToml = await readFile(
      join(FIXTURE_ROOT, "gradle", "libs", "versions.toml"),
      "utf8",
    );
    const updatedToml = await readFile(
      join(tempDir, "gradle", "libs", "versions.toml"),
      "utf8",
    );

    // At least one version literal should have been rewritten.
    expect(updatedToml).not.toBe(originalToml);

    // Module build files must still contain `version = "1.0.0-SNAPSHOT"` verbatim.
    const moduleBuildFiles = (await readAllFiles(join(tempDir, "app"))).filter(
      (filePath) => filePath.endsWith(`${sep}build.gradle.kts`),
    );
    expect(moduleBuildFiles.length).toBeGreaterThan(0);
    for (const moduleFile of moduleBuildFiles) {
      const moduleContents = await readFile(moduleFile, "utf8");
      expect(moduleContents).toContain('version = "1.0.0-SNAPSHOT"');
    }
  });
});

describe("real-project-mix: --include filter narrows results", () => {
  it("only reports kotlin-stdlib group coordinates when filtered by org.jetbrains.kotlin*", async () => {
    const dependencies = await gatherFixtureDependencies(FIXTURE_ROOT);
    mockRepo(buildFullMockMap(dependencies));

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(
      buildArgs({ include: ["org.jetbrains.kotlin*"] }),
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    const output = stdout.output;

    // Filtered-out deps must not appear in the report.
    expect(output).not.toContain("jackson-bom");
    expect(output).not.toContain("protobuf-java");
    expect(output).not.toContain("nimbus-jose-jwt");
    expect(output).not.toContain("hibernate-vector");
    expect(output).not.toContain("postgresql");
  });
});

describe("real-project-mix: repository discovery validation", () => {
  it("uses mavenCentral from settings without producing unexpected-request errors", async () => {
    const dependencies = await gatherFixtureDependencies(FIXTURE_ROOT);
    mockRepo(buildFullMockMap(dependencies));

    const stdout = makeWritable();
    const stderr = makeWritable();

    // Auto-discovery is always active; settings-declared repos always enter the URL list.
    const exitCode = await run(buildArgs(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    // The mockRepo helper throws on any unmocked URL — surfacing as a thrown
    // error before this assertion. Reaching here proves every requested URL
    // (including the settings-declared mavenCentral) was in the mock map.
    expect(stderr.output).not.toContain("unexpected request");

    const walkResult = await walk(FIXTURE_ROOT);
    expect(walkResult.settingsRepositories).toContain(MAVEN_CENTRAL_URL);
  });
});
