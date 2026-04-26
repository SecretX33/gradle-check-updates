import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { run } from "../../src/cli/run.js";
import type { ParsedArgs } from "../../src/cli/args.js";

// ── Fixture path ──────────────────────────────────────────────────────────────
const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/projects/pre-track",
);

// ── Metadata URLs ─────────────────────────────────────────────────────────────
const MAVEN_BASE = "https://repo.maven.apache.org/maven2/";
const GOOGLE_BASE = "https://maven.google.com/";
const GRADLE_BASE = "https://plugins.gradle.org/m2/";

const MYLIB_GROUP = "com.example";
const MYLIB_ARTIFACT = "mylib";
const MYLIB_MAVEN_URL = `${MAVEN_BASE}com/example/mylib/maven-metadata.xml`;
const MYLIB_GOOGLE_URL = `${GOOGLE_BASE}com/example/mylib/maven-metadata.xml`;
const MYLIB_GRADLE_URL = `${GRADLE_BASE}com/example/mylib/maven-metadata.xml`;

const EMPTY_METADATA = `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`;

const MYLIB_METADATA = `<?xml version="1.0"?>
<metadata>
  <groupId>${MYLIB_GROUP}</groupId>
  <artifactId>${MYLIB_ARTIFACT}</artifactId>
  <versioning>
    <latest>1.4.0</latest>
    <release>1.4.0</release>
    <versions>
      <version>1.3.0-beta3</version>
      <version>1.3.0-beta5</version>
      <version>1.4.0-beta1</version>
      <version>1.4.0</version>
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
    [MYLIB_MAVEN_URL]: MYLIB_METADATA,
    [MYLIB_GOOGLE_URL]: EMPTY_METADATA,
    [MYLIB_GRADLE_URL]: EMPTY_METADATA,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("pre-track: without --pre flag", () => {
  it("proposes 1.4.0 (stable) because current is pre-release and stable wins over beta", async () => {
    // Current: 1.3.0-beta3 (prerelease track)
    // Per spec: "If current is prerelease/snapshot: keep newer prereleases AND newer stables."
    // Candidates after track filter: 1.3.0-beta5, 1.4.0-beta1, 1.4.0
    // Max = 1.4.0 (stable beats beta)
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("mylib");
    expect(stdout.output).toContain("1.4.0");
  });
});

describe("pre-track: with --pre flag", () => {
  it("still proposes 1.4.0 (stable) over 1.4.0-beta1 because stable sorts higher", async () => {
    // --pre adds prereleases as candidates; current is already prerelease so track already includes them.
    // Candidates: 1.3.0-beta5, 1.4.0-beta1, 1.4.0
    // Max is still 1.4.0 (stable > beta)
    mockRepo(buildMockMap());

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs({ pre: true }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("1.4.0");
    // 1.4.0-beta1 must not win over 1.4.0
    expect(stdout.output).not.toContain("1.4.0-beta1");
  });
});
