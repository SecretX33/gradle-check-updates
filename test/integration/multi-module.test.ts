import { mkdtemp, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { run } from "../../src/cli/run.js";
import type { ParsedArgs } from "../../src/cli/args.js";

// ── Fixture path ──────────────────────────────────────────────────────────────
const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/projects/multi-module",
);

// ── Metadata URLs ─────────────────────────────────────────────────────────────
const MAVEN_BASE = "https://repo.maven.apache.org/maven2/";
const GOOGLE_BASE = "https://maven.google.com/";
const GRADLE_BASE = "https://plugins.gradle.org/m2/";

function mavenUrl(groupId: string, artifactId: string): string {
  return `${MAVEN_BASE}${groupId.replace(/\./g, "/")}/${artifactId}/maven-metadata.xml`;
}
function googleUrl(groupId: string, artifactId: string): string {
  return `${GOOGLE_BASE}${groupId.replace(/\./g, "/")}/${artifactId}/maven-metadata.xml`;
}
function gradleUrl(groupId: string, artifactId: string): string {
  return `${GRADLE_BASE}${groupId.replace(/\./g, "/")}/${artifactId}/maven-metadata.xml`;
}

// ── XML helpers ───────────────────────────────────────────────────────────────
const EMPTY_METADATA = `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`;

function buildMetadataXml(
  groupId: string,
  artifactId: string,
  versions: string[],
): string {
  const versionTags = versions.map((v) => `      <version>${v}</version>`).join("\n");
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

// ── All deps used in the fixture ──────────────────────────────────────────────
const DEPS = [
  {
    group: "org.jetbrains.kotlin",
    artifact: "kotlin-stdlib",
    versions: ["1.9.0", "2.0.0", "2.0.21"],
  },
  {
    group: "com.squareup.retrofit2",
    artifact: "retrofit",
    versions: ["2.9.0", "2.11.0"],
  },
  {
    group: "com.google.code.gson",
    artifact: "gson",
    versions: ["2.10.0", "2.10.1"],
  },
  {
    group: "com.squareup.okhttp3",
    artifact: "okhttp",
    versions: ["4.11.0", "4.12.0"],
  },
  {
    group: "androidx.compose",
    artifact: "compose-bom",
    versions: ["2024.02.00", "2024.10.01"],
  },
] as const;

function buildFullMockMap(): Record<string, string> {
  const mockMap: Record<string, string> = {};
  for (const dep of DEPS) {
    mockMap[mavenUrl(dep.group, dep.artifact)] = buildMetadataXml(
      dep.group,
      dep.artifact,
      dep.versions as unknown as string[],
    );
    mockMap[googleUrl(dep.group, dep.artifact)] = EMPTY_METADATA;
    mockMap[gradleUrl(dep.group, dep.artifact)] = EMPTY_METADATA;
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
    pre: false,
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
  const destination = await mkdtemp(join(tmpdir(), "gcu-multi-module-"));
  await cp(FIXTURE_ROOT, destination, { recursive: true });
  return destination;
}

beforeEach(async () => {
  tempDir = "";
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("multi-module: preview mode", () => {
  it("reports all expected upgrades in the table", async () => {
    mockRepo(buildFullMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    const output = stdout.output;

    // kotlin-stdlib: shared var kotlinVersion upgraded to 2.0.21
    expect(output).toContain("kotlin-stdlib");
    expect(output).toContain("2.0.21");

    // retrofit: 2.9.0 → 2.11.0
    expect(output).toContain("retrofit");
    expect(output).toContain("2.11.0");

    // gson: 2.10.0 → 2.10.1
    expect(output).toContain("gson");
    expect(output).toContain("2.10.1");

    // okhttp: 4.11.0 → 4.12.0
    expect(output).toContain("okhttp");
    expect(output).toContain("4.12.0");

    // compose-bom: 2024.02.00 → 2024.10.01
    expect(output).toContain("compose-bom");
    expect(output).toContain("2024.10.01");
  });
});

describe("multi-module: -u mode", () => {
  it("rewrites gradle.properties with updated kotlinVersion", async () => {
    tempDir = await copyFixtureToTemp();
    mockRepo(buildFullMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(
      buildArgs({ directory: tempDir, upgrade: true }),
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);

    const propertiesContent = await readFile(
      join(tempDir, "gradle.properties"),
      "utf8",
    );
    // Only the version value should have changed; the key and newline must be intact
    expect(propertiesContent).toBe("kotlinVersion=2.0.21\n");
  });
});

describe("multi-module: --target patch", () => {
  it("holds major upgrades and proposes only patch-level changes", async () => {
    mockRepo(buildFullMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(
      buildArgs({ target: "patch" }),
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    const output = stdout.output;

    // kotlin: 1.9.0 — no 1.9.x patch upgrade available → held or no-change, not 2.x
    expect(output).not.toContain("2.0.21");
    // retrofit: 2.9.0 — no patch upgrade in 2.9.x range → held or no-change
    expect(output).not.toContain("2.11.0");
    // gson: 2.10.0 → 2.10.1 is a patch upgrade → should appear
    expect(output).toContain("2.10.1");
    // okhttp: 4.11.0 — 4.12.0 is a minor upgrade → should be held
    expect(output).not.toContain("4.12.0");
  });
});

describe("multi-module: --include filter", () => {
  it("only shows okhttp when included by coordinate", async () => {
    mockRepo(buildFullMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(
      buildArgs({ include: ["com.squareup.okhttp3:okhttp"] }),
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    const output = stdout.output;

    expect(output).toContain("okhttp");
    expect(output).toContain("4.12.0");

    // All other deps should be excluded
    expect(output).not.toContain("retrofit");
    expect(output).not.toContain("gson");
    expect(output).not.toContain("compose-bom");
  });
});
