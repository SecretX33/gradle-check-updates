import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { run } from "../../src/cli/run.js";
import type { ParsedArgs } from "../../src/cli/args.js";

// ── Fixture path ──────────────────────────────────────────────────────────────
const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/projects/target-major-minor-patch",
);

// ── Metadata URLs ─────────────────────────────────────────────────────────────
const MAVEN_BASE = "https://repo.maven.apache.org/maven2/";
const GOOGLE_BASE = "https://maven.google.com/";
const GRADLE_BASE = "https://plugins.gradle.org/m2/";

const VERSIONED_GROUP = "com.example";
const VERSIONED_ARTIFACT = "versioned";
const VERSIONED_MAVEN_URL = `${MAVEN_BASE}com/example/versioned/maven-metadata.xml`;
const VERSIONED_GOOGLE_URL = `${GOOGLE_BASE}com/example/versioned/maven-metadata.xml`;
const VERSIONED_GRADLE_URL = `${GRADLE_BASE}com/example/versioned/maven-metadata.xml`;

const EMPTY_METADATA = `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`;

const VERSIONED_METADATA = `<?xml version="1.0"?>
<metadata>
  <groupId>${VERSIONED_GROUP}</groupId>
  <artifactId>${VERSIONED_ARTIFACT}</artifactId>
  <versioning>
    <latest>3.0.0</latest>
    <release>3.0.0</release>
    <versions>
      <version>1.2.3</version>
      <version>1.2.9</version>
      <version>1.3.0</version>
      <version>1.5.0</version>
      <version>2.0.0</version>
      <version>3.0.0</version>
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
    verbose: false,
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
    [VERSIONED_MAVEN_URL]: VERSIONED_METADATA,
    [VERSIONED_GOOGLE_URL]: EMPTY_METADATA,
    [VERSIONED_GRADLE_URL]: EMPTY_METADATA,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("target-ceilings: --target major (default)", () => {
  it("proposes 3.0.0 as the absolute latest version", async () => {
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs({ target: "major" }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("versioned");
    expect(stdout.output).toContain("3.0.0");
  });
});

describe("target-ceilings: --target minor", () => {
  it("proposes 1.5.0 (highest within the same major as current 1.2.3)", async () => {
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs({ target: "minor" }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("versioned");
    expect(stdout.output).toContain("1.5.0");
    // Should not propose a major bump
    expect(stdout.output).not.toContain("2.0.0");
    expect(stdout.output).not.toContain("3.0.0");
  });
});

describe("target-ceilings: --target patch", () => {
  it("proposes 1.2.9 (highest within the same major.minor as current 1.2.3)", async () => {
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs({ target: "patch" }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("versioned");
    expect(stdout.output).toContain("1.2.9");
    // Should not propose minor or major bumps
    expect(stdout.output).not.toContain("1.3.0");
    expect(stdout.output).not.toContain("1.5.0");
    expect(stdout.output).not.toContain("2.0.0");
    expect(stdout.output).not.toContain("3.0.0");
  });
});
