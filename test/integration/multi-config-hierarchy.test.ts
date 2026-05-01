import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { run } from "../../src/cli/run.js";
import type { ParsedArgs } from "../../src/cli/args.js";

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/projects/multi-config/integration",
);

const MAVEN_BASE = "https://repo.maven.apache.org/maven2/";
const GOOGLE_BASE = "https://maven.google.com/";
const GRADLE_BASE = "https://plugins.gradle.org/m2/";

function mavenUrl(group: string, artifact: string): string {
  return `${MAVEN_BASE}${group.replace(/\./g, "/")}/${artifact}/maven-metadata.xml`;
}

function googleUrl(group: string, artifact: string): string {
  return `${GOOGLE_BASE}${group.replace(/\./g, "/")}/${artifact}/maven-metadata.xml`;
}

function gradleUrl(group: string, artifact: string): string {
  return `${GRADLE_BASE}${group.replace(/\./g, "/")}/${artifact}/maven-metadata.xml`;
}

const EMPTY_METADATA = `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`;

function metadataXml(group: string, artifact: string, versions: string[]): string {
  const tags = versions.map((version) => `      <version>${version}</version>`).join("\n");
  const latest = versions[versions.length - 1] ?? "";
  return `<?xml version="1.0"?>
<metadata>
  <groupId>${group}</groupId>
  <artifactId>${artifact}</artifactId>
  <versioning>
    <latest>${latest}</latest>
    <release>${latest}</release>
    <versions>
${tags}
    </versions>
  </versioning>
</metadata>`;
}

type Dep = { group: string; artifact: string; versions: string[] };

function buildMockMap(deps: Dep[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const dep of deps) {
    map[mavenUrl(dep.group, dep.artifact)] = metadataXml(
      dep.group,
      dep.artifact,
      dep.versions,
    );
    map[googleUrl(dep.group, dep.artifact)] = EMPTY_METADATA;
    map[gradleUrl(dep.group, dep.artifact)] = EMPTY_METADATA;
  }
  return map;
}

function buildArgs(directory: string, overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    directory,
    upgrade: false,
    interactive: false,
    target: "major",
    pre: false,
    cooldown: 0,
    allowDowngrade: false,
    include: [],
    exclude: [],
    format: "text",
    errorOnOutdated: false,
    verboseLevel: 0,
    concurrency: 5,
    noCache: false,
    clearCache: false,
    ...overrides,
  };
}

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

type JsonReport = {
  updates: Array<{
    group: string;
    artifact: string;
    current: string;
    updated: string;
    direction?: "up" | "down";
  }>;
};

async function runJson(
  directory: string,
  overrides: Partial<ParsedArgs> = {},
): Promise<{ exitCode: number; report: JsonReport; stderr: string }> {
  const stdout = makeWritable();
  const stderr = makeWritable();
  const exitCode = await run(buildArgs(directory, { ...overrides, format: "json" }), {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  const report = JSON.parse(stdout.output) as JsonReport;
  return { exitCode, report, stderr: stderr.output };
}

function findDep(report: JsonReport, group: string, artifact: string) {
  return report.updates.find(
    (entry) => entry.group === group && entry.artifact === artifact,
  );
}

// ── Tier 1: Cardinal correctness ──────────────────────────────────────────────

describe("multi-config hierarchy: per-Occurrence include override", () => {
  const fixture = join(FIXTURES_ROOT, "per-occurrence-include");

  // Root has include=[com.google.*]; submodule has include=[org.apache.*].
  // Both modules declare gson + commons-lang3. Each module's include must
  // gate which dep appears in the report.
  it("root and submodule each apply their own include filter", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "2.11.0"],
        },
        {
          group: "org.apache.commons",
          artifact: "commons-lang3",
          versions: ["3.12.0", "3.14.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);

    const gsonEntries = report.updates.filter(
      (entry) => entry.artifact === "gson",
    );
    const commonsEntries = report.updates.filter(
      (entry) => entry.artifact === "commons-lang3",
    );

    // gson appears once: from the root module (root config includes com.google.*).
    // The submodule's gson is filtered out (its include is org.apache.* only).
    expect(gsonEntries).toHaveLength(1);

    // commons-lang3 appears once: from the submodule (its include).
    // The root module's commons-lang3 is filtered out.
    expect(commonsEntries).toHaveLength(1);
  });

  // CLI --include should fully replace any chained .gcu.json includes for every Occurrence.
  it("CLI --include overrides chained .gcu.json includes for every Occurrence", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "2.11.0"],
        },
        {
          group: "org.apache.commons",
          artifact: "commons-lang3",
          versions: ["3.12.0", "3.14.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture, {
      include: ["com.google.code.gson:*"],
    });

    expect(exitCode).toBe(0);

    // Both modules now share the CLI include — only gson appears, twice.
    const gsonEntries = report.updates.filter(
      (entry) => entry.artifact === "gson",
    );
    const commonsEntries = report.updates.filter(
      (entry) => entry.artifact === "commons-lang3",
    );
    expect(gsonEntries).toHaveLength(2);
    expect(commonsEntries).toHaveLength(0);
  });
});

describe("multi-config hierarchy: edit-site rule for variable indirection", () => {
  const fixture = join(FIXTURES_ROOT, "variable-indirection");

  // Submodule build.gradle.kts references $kotlinVersion, defined in root gradle.properties.
  // Submodule .gcu.json excludes org.jetbrains.kotlin:*. Root .gcu.json is empty.
  // The Occurrence's edit site is gradle.properties (the root), so the root's empty
  // exclude must govern — kotlin-stdlib MUST appear in the report.
  it("submodule config does not govern an edit that lands in root gradle.properties", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "org.jetbrains.kotlin",
          artifact: "kotlin-stdlib",
          versions: ["1.9.0", "1.9.21", "2.0.21"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    // The submodule's exclude is irrelevant because the edit site is in the root.
    expect(findDep(report, "org.jetbrains.kotlin", "kotlin-stdlib")).toBeDefined();
  });
});

describe("multi-config hierarchy: array fields are replaced, not merged", () => {
  const fixture = join(FIXTURES_ROOT, "array-replace-runtime");

  // Root excludes org.apache.*; submodule excludes com.google.*. Each module declares
  // both groups. If the arrays were merged the reports would be empty for both groups
  // in both modules — but the contract says arrays REPLACE, so each module excludes
  // only what its own innermost config says.
  it("submodule exclude array replaces root exclude (does not merge)", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1"],
        },
        {
          group: "org.apache.commons",
          artifact: "commons-lang3",
          versions: ["3.12.0", "3.14.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);

    // Root: excludes org.apache.* → only gson appears.
    // Submodule: excludes com.google.* → only commons-lang3 appears.
    expect(report.updates.filter((entry) => entry.artifact === "gson")).toHaveLength(1);
    expect(
      report.updates.filter((entry) => entry.artifact === "commons-lang3"),
    ).toHaveLength(1);
  });
});

describe("multi-config hierarchy: catalog cardinal rule", () => {
  const fixture = join(FIXTURES_ROOT, "catalog-cardinal");

  // Catalog at gradle/libs.versions.toml. Root .gcu.json (next to gradle/) is empty.
  // Submodule .gcu.json excludes com.google.code.gson:*. Submodule consumes libs.gson.
  // Catalog's walk-up never sees the submodule config, so the catalog literal must
  // be considered for upgrade (gson appears in the report).
  it("submodule config never reaches the catalog edit site", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "2.11.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    // Catalog literal (group=com.google.code.gson, artifact=gson) must appear.
    expect(findDep(report, "com.google.code.gson", "gson")).toBeDefined();
  });
});

// ── Tier 2: Behavior interactions ─────────────────────────────────────────────

describe("multi-config hierarchy: deep-chain (4 levels) through run()", () => {
  const fixture = join(FIXTURES_ROOT, "deep-chain-runtime");

  // Chain (outermost→innermost) for a/b/c/build.gradle.kts:
  //   root:   exclude=[org.legacy:*]
  //   a:      include=[com.google.*, org.apache.*]
  //   a/b:    {}
  //   a/b/c:  exclude=[org.apache.*]    ← replaces root's exclude
  // Merged: include from a, exclude from c, root's exclude is dropped.
  // Build file at a/b/c declares gson + commons-lang3 + legacy.
  //   gson      → passes include + exclude → reported
  //   commons   → passes include, fails exclude → filtered
  //   legacy    → fails include → filtered
  it("inherits non-overridden fields and replaces overridden array fields", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1"],
        },
        {
          group: "org.apache.commons",
          artifact: "commons-lang3",
          versions: ["3.12.0", "3.14.0"],
        },
        { group: "org.legacy", artifact: "legacy", versions: ["1.0.0", "1.1.0"] },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    expect(findDep(report, "com.google.code.gson", "gson")).toBeDefined();
    expect(findDep(report, "org.apache.commons", "commons-lang3")).toBeUndefined();
    expect(findDep(report, "org.legacy", "legacy")).toBeUndefined();
  });
});

// ── Tier 3: Validation & UX ───────────────────────────────────────────────────

describe("multi-config hierarchy: schema validation across hierarchy", () => {
  const fixture = join(FIXTURES_ROOT, "submodule-bad-key");

  // submodule/.gcu.json has a typo ("targt") — schema strict mode must reject it,
  // exit 2, and the error message must name the submodule's config path so the
  // user knows where to look (not the root config).
  it("unknown key in submodule .gcu.json reports the submodule path", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1"],
        },
      ]),
    );

    const stdout = makeWritable();
    const stderr = makeWritable();
    const exitCode = await run(buildArgs(fixture), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(2);
    const errorOutput = stderr.output;
    // The error must surface the submodule context (so the user knows which
    // config to fix) and the offending key name.
    expect(errorOutput).toMatch(/submodule/);
    expect(errorOutput).toMatch(/targt/);
    expect(errorOutput).toMatch(/[Uu]nrecognized/);
  });
});
