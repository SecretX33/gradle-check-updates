import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { run } from "../../src/cli/run.js";
import { parseArgs, type ParsedArgs } from "../../src/cli/args.js";

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
    target: undefined,
    pre: false,
    cooldown: 0,
    allowDowngrade: false,
    include: [],
    exclude: [],
    format: "text",
    errorOnOutdated: false,
    verboseLevel: 0,
    concurrency: 5,
    noCache: true,
    clearCache: false,
    ...overrides,
  };
}

// Build ParsedArgs by going through the real cac-driven CLI parser. This is the
// only way to exercise the actual CLI defaults — direct buildArgs() bypasses
// cac entirely and hides bugs where a cac default shadows a .gcu.json field
// (see commit a44aad1 for the original target-merge bug). Use this helper for
// tests that need to verify "what happens when the user *doesn't* pass a flag".
function buildRealArgs(directory: string, cliFlags: string[] = []): ParsedArgs {
  const result = parseArgs(cliFlags);
  if (!result.ok) {
    throw new Error(`parseArgs failed in test setup: ${result.error}`);
  }
  return { ...result.args, directory, format: "json", noCache: true };
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

// Like runJson, but routes the args through the real parseArgs() so cac
// defaults are exercised. Pass `cliFlags` exactly as a user would type them
// after `gcu`, e.g. ["--target", "patch", "--pre"].
async function runJsonCli(
  directory: string,
  cliFlags: string[] = [],
): Promise<{ exitCode: number; report: JsonReport; stderr: string }> {
  const stdout = makeWritable();
  const stderr = makeWritable();
  const exitCode = await run(buildRealArgs(directory, cliFlags), {
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

function pomUrl(group: string, artifact: string, version: string): string {
  return `${MAVEN_BASE}${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.pom`;
}

// ── Tier 1: Cardinal correctness ──────────────────────────────────────────────

describe("multi-config hierarchy: per-Occurrence target override", () => {
  const fixture = join(FIXTURES_ROOT, "target-override");

  // Root .gcu.json: target=major. Submodule .gcu.json: target=patch.
  // Root has gson 2.10.0 (next: 2.10.1, 3.0.0); submodule has okhttp 4.11.0 (next: 4.11.1, 5.0.0).
  // With per-Occurrence config flowing through, root must select 3.0.0 and submodule 4.11.1.
  it("each module's target is taken from its own .gcu.json when CLI does not pass --target", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "3.0.0"],
        },
        {
          group: "com.squareup.okhttp3",
          artifact: "okhttp",
          versions: ["4.11.0", "4.11.1", "5.0.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    expect(findDep(report, "com.google.code.gson", "gson")?.updated).toBe("3.0.0");
    expect(findDep(report, "com.squareup.okhttp3", "okhttp")?.updated).toBe("4.11.1");
  });

  // CLI --target wins over every chained .gcu.json target.
  it("CLI --target overrides chained .gcu.json target for every Occurrence", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "3.0.0"],
        },
        {
          group: "com.squareup.okhttp3",
          artifact: "okhttp",
          versions: ["4.11.0", "4.11.1", "5.0.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture, { target: "patch" });

    expect(exitCode).toBe(0);
    expect(findDep(report, "com.google.code.gson", "gson")?.updated).toBe("2.10.1");
    expect(findDep(report, "com.squareup.okhttp3", "okhttp")?.updated).toBe("4.11.1");
  });

  // Regression guard: if args.target ever stops being undefined-when-absent,
  // root and submodule will both select the CLI default and this test will fail.
  it("ParsedArgs.target is undefined when --target is not passed (regression guard)", async () => {
    const { parseArgs } = await import("../../src/cli/args.js");
    const result = parseArgs([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.target).toBeUndefined();
    }
  });
});

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

// ── Tier 2 (continued): Behavior interactions ─────────────────────────────────

describe("multi-config hierarchy: cooldown inherits across submodules", () => {
  const fixture = join(FIXTURES_ROOT, "cooldown-allow-downgrade-mix");

  // Root .gcu.json: cooldown=99999. Submodule .gcu.json: empty {}.
  // Mock the new gson 2.10.1 with a recent Last-Modified so cooldown blocks it.
  // If the submodule inherited cooldown=99999, both modules' gson 2.10.1 is blocked.
  // If submodule fell through to default cooldown=0, submodule's gson would be upgraded.
  it("submodule inherits cooldown=99999 from root and blocks recent versions", async () => {
    const mockMap = buildMockMap([
      {
        group: "com.google.code.gson",
        artifact: "gson",
        versions: ["2.10.0", "2.10.1"],
      },
    ]);
    // Add a per-version POM HEAD response with a recent Last-Modified so the
    // 2.10.1 candidate falls inside the cooldown window.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toUTCString();
    mockMap[pomUrl("com.google.code.gson", "gson", "2.10.1")] = JSON.stringify({
      status: 200,
      body: "",
      headers: { "last-modified": yesterday },
    });
    // mockRepo accepts MockResponse objects directly — re-pass the structured form
    // for the POM URL only.
    mockRepo({
      ...mockMap,
      [pomUrl("com.google.code.gson", "gson", "2.10.1")]: {
        status: 200,
        body: "",
        headers: { "last-modified": yesterday },
      },
    });

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    // Both modules' gson must be cooldown-blocked → no entries in updates[].
    expect(report.updates.filter((entry) => entry.artifact === "gson")).toHaveLength(0);
  });
});

describe("multi-config hierarchy: mixed formats in one project", () => {
  const fixture = join(FIXTURES_ROOT, "mixed-formats");

  // Root .gcu.json: target=major (governs the root catalog at gradle/libs.versions.toml).
  // groovy-mod/.gcu.json: target=patch (Groovy DSL build.gradle).
  // kotlin-mod/.gcu.json: target=minor (Kotlin DSL build.gradle.kts).
  // catalog-mod consumes libs.gson — but the catalog literal lives at the root,
  // so the root config (major) governs that bump.
  it("each format in each module honors its own resolved target", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "org.apache.commons",
          artifact: "commons-lang3",
          versions: ["3.12.0", "3.12.1", "3.14.0", "4.0.0"],
        },
        {
          group: "com.squareup.okhttp3",
          artifact: "okhttp",
          versions: ["4.11.0", "4.11.1", "4.12.0", "5.0.0"],
        },
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "3.0.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    // Groovy submodule, target=patch, current 3.12.0 → 3.12.1.
    expect(findDep(report, "org.apache.commons", "commons-lang3")?.updated).toBe(
      "3.12.1",
    );
    // Kotlin submodule, target=minor, current 4.11.0 → 4.12.0 (5.0.0 is major).
    expect(findDep(report, "com.squareup.okhttp3", "okhttp")?.updated).toBe("4.12.0");
    // Catalog literal at root, target=major (root config) → 3.0.0.
    expect(findDep(report, "com.google.code.gson", "gson")?.updated).toBe("3.0.0");
  });
});

describe("multi-config hierarchy: per-submodule gradle.properties", () => {
  const fixture = join(FIXTURES_ROOT, "properties-per-submodule");

  // submodule/gradle.properties defines gsonVersion. submodule/build.gradle.kts
  // references $gsonVersion. The variable resolves to the submodule's own
  // gradle.properties (the edit site), and submodule .gcu.json has target=patch.
  // Root has empty .gcu.json (no target). With submodule's target=patch, current
  // 2.10.0 must bump to 2.10.1, never 3.0.0.
  it("submodule .gcu.json governs an edit in the submodule's own gradle.properties", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "3.0.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    expect(findDep(report, "com.google.code.gson", "gson")?.updated).toBe("2.10.1");
  });
});

// ── Tier 3 (continued): Validation & UX ───────────────────────────────────────

describe("multi-config hierarchy: --format json across mixed-config tree", () => {
  const fixture = join(FIXTURES_ROOT, "target-override");

  // Verify the JSON contract under hierarchical configs: stdout is parseable JSON,
  // updates[] entries have the expected shape, post-policy winners only.
  it("emits a valid JSON document with one entry per upgraded Occurrence", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "3.0.0"],
        },
        {
          group: "com.squareup.okhttp3",
          artifact: "okhttp",
          versions: ["4.11.0", "4.11.1", "5.0.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    // Two upgrades, both winners — no skipped/held entries.
    expect(report.updates).toHaveLength(2);
    for (const entry of report.updates) {
      expect(typeof entry.group).toBe("string");
      expect(typeof entry.artifact).toBe("string");
      expect(typeof entry.current).toBe("string");
      expect(typeof entry.updated).toBe("string");
      // 'direction' is omitted when 'up' (the default).
      expect(entry.direction).not.toBe("up");
    }
  });
});

describe("multi-config hierarchy: rich-version block + per-submodule target", () => {
  const fixture = join(FIXTURES_ROOT, "rich-version-target");

  // submodule has version { strictly("2.10.0"); prefer("2.10.0") } and target=patch.
  // Root config target=major would lift to 3.0.0; submodule's patch must keep both
  // sibling occurrences (strictly + prefer) coherent at 2.10.1.
  it("submodule target governs both halves of a rich-version block coherently", async () => {
    mockRepo(
      buildMockMap([
        {
          group: "com.google.code.gson",
          artifact: "gson",
          versions: ["2.10.0", "2.10.1", "3.0.0"],
        },
      ]),
    );

    const { exitCode, report } = await runJson(fixture);

    expect(exitCode).toBe(0);
    const gsonEntries = report.updates.filter((entry) => entry.artifact === "gson");
    // One logical dependency, one update entry per Occurrence — both halves bump
    // to 2.10.1 (patch), never 3.0.0 (which would be major).
    expect(gsonEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of gsonEntries) {
      expect(entry.updated).toBe("2.10.1");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Field-by-field merge matrix
//
// Every ProjectConfig field that influences policy decisions is tested twice:
//   (a) "file-only flows through" — .gcu.json sets the field, CLI does NOT
//       pass it; behavior must reflect the file value.
//   (b) "CLI overrides file" — .gcu.json sets one value, CLI passes a
//       different value; behavior must reflect the CLI value.
//
// This is the contract for "CLI > .gcu.json > defaults". A regression of the
// historical `args.X ?? fileConfig.X` bug pattern in src/cli/run.ts will fail
// the (a) test for the affected field. A regression of CLI precedence will
// fail the (b) test.
//
// `cacheDir` and `noCache` are excluded — they affect filesystem behavior, not
// policy decisions, and have separate cache-layer tests.
// ─────────────────────────────────────────────────────────────────────────────

const LIB_VERSIONS_STABLE_PRE = ["1.0.0", "1.0.1", "1.1.0-alpha"];
const LIB_VERSIONS_MAJOR = ["1.0.0", "1.0.1", "1.1.0", "2.0.0"];
const LIB_VERSIONS_DOWNGRADE = ["1.0.0", "1.0.1", "1.0.5", "1.0.6"];

function recentDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toUTCString();
}

function ancientDate(): string {
  return new Date("2010-01-01T00:00:00Z").toUTCString();
}

describe("field-merge matrix: target", () => {
  // (a) file-only — .gcu.json sets target=patch, CLI does not pass --target.
  //     With versions [1.0.0, 1.0.1, 1.1.0, 2.0.0] and current 1.0.0, target=patch
  //     must select 1.0.1 (not 1.1.0 or 2.0.0).
  it("(a) file-only: .gcu.json target flows through when CLI omits --target", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
      ]),
    );
    // runJsonCli routes through parseArgs([]) — the user did NOT pass --target.
    // If a future regression re-introduces a cac default for --target, args.target
    // will be "major" and shadow .gcu.json's "patch", and this test will fail.
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-target-file"),
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")?.updated).toBe("1.0.1");
  });

  // (b) CLI override — .gcu.json target=patch, but CLI passes --target major.
  //     Must select 2.0.0.
  it("(b) CLI override: --target wins over .gcu.json target", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-target-file"),
      ["--target", "major"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")?.updated).toBe("2.0.0");
  });
});

describe("field-merge matrix: pre", () => {
  // (a) file-only — .gcu.json sets pre=true. With stable [1.0.0, 1.0.1] and
  //     pre [1.1.0-alpha], pre=true should accept 1.1.0-alpha.
  it("(a) file-only: .gcu.json pre flows through when CLI omits --pre", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_STABLE_PRE },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-pre-file"),
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")?.updated).toBe("1.1.0-alpha");
  });

  // (b) CLI override — .gcu.json empty (or pre absent), CLI passes --pre.
  //     Must select 1.1.0-alpha.
  it("(b) CLI override: --pre wins when .gcu.json does not set pre", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_STABLE_PRE },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-empty"),
      ["--pre"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")?.updated).toBe("1.1.0-alpha");
  });

  // (c) Sanity — neither file nor CLI sets pre → pre version must NOT be picked.
  it("(c) sanity: neither set → stable version wins", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_STABLE_PRE },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-empty"),
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")?.updated).toBe("1.0.1");
  });
});

describe("field-merge matrix: cooldown", () => {
  function buildCooldownMockMap(): Record<string, string | { status: number; body: string; headers?: Record<string, string> }> {
    const map: Record<
      string,
      string | { status: number; body: string; headers?: Record<string, string> }
    > = buildMockMap([
      { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
    ]);
    // 1.0.1 is recent → falls inside any non-trivial cooldown window.
    map[pomUrl("com.example", "lib", "1.0.1")] = {
      status: 200,
      body: "",
      headers: { "last-modified": recentDate() },
    };
    return map;
  }

  // (a) file-only — .gcu.json cooldown=99999. CLI omits --cooldown. 1.0.1 is
  //     recent and must be cooldown-blocked. No upgrade in updates[].
  it("(a) file-only: .gcu.json cooldown flows through when CLI omits --cooldown", async () => {
    mockRepo(buildCooldownMockMap());
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-cooldown-file"),
      ["--target", "patch"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeUndefined();
  });

  // (b) CLI override — .gcu.json empty, CLI passes --cooldown 99999. Must block.
  it("(b) CLI override: --cooldown wins when .gcu.json does not set cooldown", async () => {
    mockRepo(buildCooldownMockMap());
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-empty"),
      ["--target", "patch", "--cooldown", "99999"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeUndefined();
  });

  // (c) Sanity — neither file nor CLI sets cooldown → 1.0.1 passes through.
  it("(c) sanity: neither set → upgrade not blocked", async () => {
    mockRepo(buildCooldownMockMap());
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-empty"),
      ["--target", "patch"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")?.updated).toBe("1.0.1");
  });
});

describe("field-merge matrix: allowDowngrade", () => {
  function buildDowngradeMockMap(): Record<string, string | { status: number; body: string; headers?: Record<string, string> }> {
    const map: Record<
      string,
      string | { status: number; body: string; headers?: Record<string, string> }
    > = buildMockMap([
      { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_DOWNGRADE },
    ]);
    // Current 1.0.5, candidates 1.0.6 (newer): all recent and inside cooldown.
    // Older versions 1.0.0, 1.0.1 are ancient (outside cooldown).
    // With cooldown blocking everything ≥ current and current itself recent,
    // allowDowngrade can pick the highest cooldown-eligible version below current.
    map[pomUrl("com.example", "lib", "1.0.5")] = {
      status: 200,
      body: "",
      headers: { "last-modified": recentDate() },
    };
    map[pomUrl("com.example", "lib", "1.0.6")] = {
      status: 200,
      body: "",
      headers: { "last-modified": recentDate() },
    };
    map[pomUrl("com.example", "lib", "1.0.0")] = {
      status: 200,
      body: "",
      headers: { "last-modified": ancientDate() },
    };
    map[pomUrl("com.example", "lib", "1.0.1")] = {
      status: 200,
      body: "",
      headers: { "last-modified": ancientDate() },
    };
    return map;
  }

  // (a) file-only — .gcu.json: { cooldown: 99999, allowDowngrade: true }.
  //     CLI passes neither flag. Must produce a downgrade to 1.0.1.
  it("(a) file-only: .gcu.json allowDowngrade flows through when CLI omits flags", async () => {
    mockRepo(buildDowngradeMockMap());
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-downgrade-file"),
      ["--target", "patch"],
    );
    expect(exitCode).toBe(0);
    const entry = findDep(report, "com.example", "lib");
    expect(entry?.updated).toBe("1.0.1");
    expect(entry?.direction).toBe("down");
  });

  // (b) CLI override — .gcu.json empty, CLI passes both --cooldown 30 and
  //     --allow-downgrade. Same downgrade behavior must result.
  it("(b) CLI override: --allow-downgrade + --cooldown wins when .gcu.json is silent", async () => {
    mockRepo(buildDowngradeMockMap());
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-downgrade-empty"),
      ["--target", "patch", "--cooldown", "30", "--allow-downgrade"],
    );
    expect(exitCode).toBe(0);
    const entry = findDep(report, "com.example", "lib");
    expect(entry?.updated).toBe("1.0.1");
    expect(entry?.direction).toBe("down");
  });

  // (c) Sanity — cooldown set but allowDowngrade omitted → cooldown-blocked,
  //     no entry in updates[]. Uses the downgrade fixture (current 1.0.5) so
  //     all newer versions are inside the cooldown window.
  it("(c) sanity: cooldown alone → cooldown-blocked, no downgrade", async () => {
    mockRepo(buildDowngradeMockMap());
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-downgrade-empty"),
      ["--target", "patch", "--cooldown", "30"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeUndefined();
  });
});

describe("field-merge matrix: include", () => {
  // (a) file-only — .gcu.json include=[com.example:lib], CLI omits --include.
  //     Only `lib` reaches the report; `other` is filtered.
  it("(a) file-only: .gcu.json include flows through when CLI omits --include", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
        { group: "com.example", artifact: "other", versions: LIB_VERSIONS_MAJOR },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-include-file"),
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeDefined();
    expect(findDep(report, "com.example", "other")).toBeUndefined();
  });

  // (b) CLI override — .gcu.json include=[com.example:lib], CLI passes
  //     --include com.example:other. Now only `other` reaches the report.
  it("(b) CLI override: --include wins over .gcu.json include", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
        { group: "com.example", artifact: "other", versions: LIB_VERSIONS_MAJOR },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-include-file"),
      ["--include", "com.example:other"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeUndefined();
    expect(findDep(report, "com.example", "other")).toBeDefined();
  });
});

describe("field-merge matrix: exclude", () => {
  // (a) file-only — .gcu.json exclude=[com.example:lib], CLI omits --exclude.
  //     `lib` is filtered, `other` reaches the report.
  it("(a) file-only: .gcu.json exclude flows through when CLI omits --exclude", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
        { group: "com.example", artifact: "other", versions: LIB_VERSIONS_MAJOR },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-exclude-file"),
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeUndefined();
    expect(findDep(report, "com.example", "other")).toBeDefined();
  });

  // (b) CLI override — .gcu.json exclude=[com.example:lib], CLI passes
  //     --exclude com.example:other. `other` filtered, `lib` reaches the report.
  it("(b) CLI override: --exclude wins over .gcu.json exclude", async () => {
    mockRepo(
      buildMockMap([
        { group: "com.example", artifact: "lib", versions: LIB_VERSIONS_MAJOR },
        { group: "com.example", artifact: "other", versions: LIB_VERSIONS_MAJOR },
      ]),
    );
    const { exitCode, report } = await runJsonCli(
      join(FIXTURES_ROOT, "field-merge-exclude-file"),
      ["--exclude", "com.example:other"],
    );
    expect(exitCode).toBe(0);
    expect(findDep(report, "com.example", "lib")).toBeDefined();
    expect(findDep(report, "com.example", "other")).toBeUndefined();
  });
});
