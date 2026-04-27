import { mkdtemp, rm } from "node:fs/promises";
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
  "../fixtures/projects/cooldown-stairstep",
);

// ── Metadata URLs ─────────────────────────────────────────────────────────────
const MAVEN_BASE = "https://repo.maven.apache.org/maven2/";
const GOOGLE_BASE = "https://maven.google.com/";
const GRADLE_BASE = "https://plugins.gradle.org/m2/";

const STAIRSTEP_GROUP = "com.example";
const STAIRSTEP_ARTIFACT = "stairstep";
const STAIRSTEP_MAVEN_URL = `${MAVEN_BASE}com/example/stairstep/maven-metadata.xml`;
const STAIRSTEP_GOOGLE_URL = `${GOOGLE_BASE}com/example/stairstep/maven-metadata.xml`;
const STAIRSTEP_GRADLE_URL = `${GRADLE_BASE}com/example/stairstep/maven-metadata.xml`;

const EMPTY_METADATA = `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`;

const STAIRSTEP_METADATA = `<?xml version="1.0"?>
<metadata>
  <groupId>${STAIRSTEP_GROUP}</groupId>
  <artifactId>${STAIRSTEP_ARTIFACT}</artifactId>
  <versioning>
    <latest>2.3.0</latest>
    <release>2.3.0</release>
    <versions>
      <version>2.0.0</version>
      <version>2.1.0</version>
      <version>2.2.0</version>
      <version>2.3.0</version>
    </versions>
  </versioning>
</metadata>`;

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
    json: false,
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

function buildMockMap(): Record<string, string> {
  return {
    [STAIRSTEP_MAVEN_URL]: STAIRSTEP_METADATA,
    [STAIRSTEP_GOOGLE_URL]: EMPTY_METADATA,
    [STAIRSTEP_GRADLE_URL]: EMPTY_METADATA,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gcu-cooldown-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("cooldown-stairstep: without cooldown", () => {
  it("proposes 2.3.0 as the latest available upgrade", async () => {
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
      gcuHome: tempDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("stairstep");
    expect(stdout.output).toContain("2.3.0");
  });
});

describe("cooldown-stairstep: with cooldown", () => {
  it("proposes 2.3.0 when all timestamps are unknown (unknown timestamp passes through)", async () => {
    // No POM HEAD mocks — fetchVersionTimestamp returns undefined for all versions.
    // Unknown timestamp → cooldownFilter passes the candidate through.
    // So 2.3.0 is still proposed as the upgrade winner.
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs({ cooldown: 3 }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
      gcuHome: tempDir,
    });

    expect(exitCode).toBe(0);
    expect(stderr.output).not.toContain("no effect");
    expect(stdout.output).toContain("2.3.0");
  });
});
