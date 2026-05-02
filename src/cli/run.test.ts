// src/cli/run.test.ts

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepo } from "../../test/helpers/mock-repo.js";
import type { MockResponse } from "../../test/helpers/mock-repo.js";
import { run } from "./run.js";
import type { ParsedArgs } from "./args.js";

const KOTLIN_STDLIB_METADATA_URL =
  "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml";

const GOOGLE_METADATA_URL =
  "https://maven.google.com/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml";

const GRADLE_PLUGINS_METADATA_URL =
  "https://plugins.gradle.org/m2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml";

const KOTLIN_STDLIB_METADATA_XML = `<?xml version="1.0"?>
<metadata>
  <groupId>org.jetbrains.kotlin</groupId>
  <artifactId>kotlin-stdlib</artifactId>
  <versioning>
    <latest>2.0.21</latest>
    <release>2.0.21</release>
    <versions>
      <version>1.9.0</version>
      <version>2.0.0</version>
      <version>2.0.21</version>
    </versions>
  </versioning>
</metadata>`;

const EMPTY_METADATA_XML = `<?xml version="1.0"?>
<metadata>
  <versioning>
    <versions></versions>
  </versioning>
</metadata>`;

const SAMPLE_BUILD_GRADLE_KTS = `dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.0")
}
`;

function buildArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    directory: ".",
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

function mockAllDefaultRepos(metadata: string): void {
  mockRepo({
    [KOTLIN_STDLIB_METADATA_URL]: metadata,
    [GOOGLE_METADATA_URL]: EMPTY_METADATA_XML,
    [GRADLE_PLUGINS_METADATA_URL]: EMPTY_METADATA_XML,
  });
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gcu-run-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("run() — table output", () => {
  it("reports available upgrade in table output", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const errorChunks: string[] = [];
    const fakeStderr = {
      write(chunk: string) {
        errorChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    const output = outputChunks.join("");
    expect(exitCode).toBe(0);
    expect(output).toContain("kotlin-stdlib");
    expect(output).toContain("1.9.0");
    expect(output).toContain("2.0.21");
    expect(output).toContain("1 upgrade");
  });

  it("returns exit 1 when upgrades available and --error-on-outdated is set", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, errorOnOutdated: true }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    expect(exitCode).toBe(1);
  });
});

describe("run() — JSON output", () => {
  it("writes valid JSON to stdout", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const stdoutChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        stdoutChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, format: "json" }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    const jsonOutput = stdoutChunks.join("");
    const parsed = JSON.parse(jsonOutput) as { updates: unknown[] };

    expect(exitCode).toBe(0);
    expect(parsed).toHaveProperty("updates");
    expect(Array.isArray(parsed.updates)).toBe(true);
    expect(parsed.updates).toHaveLength(1);

    const firstUpdate = parsed.updates[0] as {
      group: string;
      artifact: string;
      current: string;
      updated: string;
    };
    expect(firstUpdate.group).toBe("org.jetbrains.kotlin");
    expect(firstUpdate.artifact).toBe("kotlin-stdlib");
    expect(firstUpdate.current).toBe("1.9.0");
    expect(firstUpdate.updated).toBe("2.0.21");
  });
});

describe("run() — --format json quiet mode", () => {
  it("writes nothing to stderr during a normal run", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const fakeStdout = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const stderrChunks: string[] = [];
    const fakeStderr = {
      write(chunk: string) {
        stderrChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, format: "json" }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
  });

  it("does not write human table output to stderr", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const fakeStdout = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const stderrChunks: string[] = [];
    const fakeStderr = {
      write(chunk: string) {
        stderrChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    await run(buildArgs({ directory: tempDir, format: "json" }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    const stderrOutput = stderrChunks.join("");
    expect(stderrOutput).not.toContain("kotlin-stdlib");
    expect(stderrOutput).not.toContain("→");
    expect(stderrOutput).not.toContain("upgrade");
  });

  it("does not write scanning or metadata progress messages to stderr", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const fakeStdout = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const stderrChunks: string[] = [];
    const fakeStderr = {
      write(chunk: string) {
        stderrChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    await run(buildArgs({ directory: tempDir, format: "json" }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    const stderrOutput = stderrChunks.join("");
    expect(stderrOutput).not.toContain("Scanning files");
    expect(stderrOutput).not.toContain("Fetching metadata");
    expect(stderrOutput).not.toContain("Fetching timestamps");
  });

  it("still writes genuine error messages to stderr", async () => {
    mockRepo({});

    const fakeStdout = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const stderrChunks: string[] = [];
    const fakeStderr = {
      write(chunk: string) {
        stderrChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, format: "json" }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    expect(exitCode).toBe(2);
    expect(stderrChunks.join("")).toContain("build.gradle");
    expect(stderrChunks.join("")).toContain("aborting");
  });
});

describe("run() — -u (upgrade) flag", () => {
  it("rewrites the file in place with the correct version", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const fakeStdout = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, upgrade: true }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    expect(exitCode).toBe(0);

    const updatedContents = await readFile(buildFile, "utf8");
    expect(updatedContents).toContain("2.0.21");
    expect(updatedContents).not.toContain("1.9.0");

    // Verify byte-level preservation: only the version string changed, structure intact
    const expectedContents = SAMPLE_BUILD_GRADLE_KTS.replace("1.9.0", "2.0.21");
    expect(updatedContents).toBe(expectedContents);
  });

  it("does not modify files when no upgrades are available", async () => {
    const upToDateContent = `dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.0.21")
}
`;
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, upToDateContent, "utf8");

    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const fakeStdout = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, upgrade: true }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
    });

    expect(exitCode).toBe(0);
    const contents = await readFile(buildFile, "utf8");
    expect(contents).toBe(upToDateContent);
  });
});

describe("run() — no Gradle files", () => {
  it("exits 2 with an error message when no Gradle build files exist in the target directory", async () => {
    mockRepo({});

    const errorChunks: string[] = [];
    const fakeStderr = {
      write(chunk: string) {
        errorChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir }), {
      stderr: fakeStderr,
    });

    expect(exitCode).toBe(2);
    expect(errorChunks.join("")).toContain("build.gradle");
    expect(errorChunks.join("")).toContain("aborting");
  });
});

const KOTLIN_POM_BASE =
  "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib";
const GOOGLE_POM_BASE = "https://maven.google.com/org/jetbrains/kotlin/kotlin-stdlib";
const GRADLE_POM_BASE =
  "https://plugins.gradle.org/m2/org/jetbrains/kotlin/kotlin-stdlib";

function pomUrl(base: string, version: string): string {
  return `${base}/${version}/kotlin-stdlib-${version}.pom`;
}

function noLastModified(
  mavenCentralBase: string,
  version: string,
): Record<string, MockResponse> {
  return {
    [pomUrl(mavenCentralBase, version)]: { status: 200, body: "" },
    [pomUrl(GOOGLE_POM_BASE, version)]: { status: 404, body: "" },
    [pomUrl(GRADLE_POM_BASE, version)]: { status: 404, body: "" },
  };
}

describe("run() — cooldown", () => {
  it("holds back latest version within cooldown; selects older soaked version", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    const now = Date.now();
    const recentDate = new Date(now - 3 * 86_400_000); // 3 days ago
    const soakedDate = new Date(now - 30 * 86_400_000); // 30 days ago

    mockRepo({
      [KOTLIN_STDLIB_METADATA_URL]: KOTLIN_STDLIB_METADATA_XML,
      [GOOGLE_METADATA_URL]: EMPTY_METADATA_XML,
      [GRADLE_PLUGINS_METADATA_URL]: EMPTY_METADATA_XML,
      // POM HEAD requests — newest first per cascade logic
      [pomUrl(KOTLIN_POM_BASE, "2.0.21")]: {
        status: 200,
        body: "",
        headers: { "last-modified": recentDate.toUTCString() },
      },
      [pomUrl(GOOGLE_POM_BASE, "2.0.21")]: { status: 404, body: "" },
      [pomUrl(GRADLE_POM_BASE, "2.0.21")]: { status: 404, body: "" },
      [pomUrl(KOTLIN_POM_BASE, "2.0.0")]: {
        status: 200,
        body: "",
        headers: { "last-modified": soakedDate.toUTCString() },
      },
      [pomUrl(GOOGLE_POM_BASE, "2.0.0")]: { status: 404, body: "" },
      [pomUrl(GRADLE_POM_BASE, "2.0.0")]: { status: 404, body: "" },
    });

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, cooldown: 7 }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      gcuHome: tempDir,
    });

    const output = outputChunks.join("");
    expect(exitCode).toBe(0);
    expect(output).toContain("2.0.0");
    expect(output).not.toContain("2.0.21");
  });

  it("reports cooldown-blocked when all upgrade candidates are within cooldown", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    const twoVersionMetadata = `<?xml version="1.0"?>
<metadata>
  <groupId>org.jetbrains.kotlin</groupId>
  <artifactId>kotlin-stdlib</artifactId>
  <versioning>
    <latest>2.0.21</latest>
    <release>2.0.21</release>
    <versions>
      <version>1.9.0</version>
      <version>2.0.21</version>
    </versions>
  </versioning>
</metadata>`;

    const now = Date.now();
    const recentDate = new Date(now - 3 * 86_400_000); // 3 days ago — within 7-day cooldown

    mockRepo({
      [KOTLIN_STDLIB_METADATA_URL]: twoVersionMetadata,
      [GOOGLE_METADATA_URL]: EMPTY_METADATA_XML,
      [GRADLE_PLUGINS_METADATA_URL]: EMPTY_METADATA_XML,
      [pomUrl(KOTLIN_POM_BASE, "2.0.21")]: {
        status: 200,
        body: "",
        headers: { "last-modified": recentDate.toUTCString() },
      },
      [pomUrl(GOOGLE_POM_BASE, "2.0.21")]: { status: 404, body: "" },
      [pomUrl(GRADLE_POM_BASE, "2.0.21")]: { status: 404, body: "" },
      // 1.9.0 is current — cascade stops before fetching it
    });

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(
      buildArgs({ directory: tempDir, cooldown: 7, verboseLevel: 1 }),
      {
        stdout: fakeStdout,
        stderr: fakeStderr,
        gcuHome: tempDir,
      },
    );

    const output = outputChunks.join("");
    expect(exitCode).toBe(0);
    expect(output).toContain("0 upgrades");
    expect(output).toContain("held by cooldown");
  });

  it("proposes upgrade when release is older than the cooldown window", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    const now = Date.now();
    const soakedDate = new Date(now - 30 * 86_400_000); // 30 days ago — past 7-day cooldown

    mockRepo({
      [KOTLIN_STDLIB_METADATA_URL]: KOTLIN_STDLIB_METADATA_XML,
      [GOOGLE_METADATA_URL]: EMPTY_METADATA_XML,
      [GRADLE_PLUGINS_METADATA_URL]: EMPTY_METADATA_XML,
      [pomUrl(KOTLIN_POM_BASE, "2.0.21")]: {
        status: 200,
        body: "",
        headers: { "last-modified": soakedDate.toUTCString() },
      },
      [pomUrl(GOOGLE_POM_BASE, "2.0.21")]: { status: 404, body: "" },
      [pomUrl(GRADLE_POM_BASE, "2.0.21")]: { status: 404, body: "" },
    });

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, cooldown: 7 }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      gcuHome: tempDir,
    });

    const output = outputChunks.join("");
    expect(exitCode).toBe(0);
    expect(output).toContain("2.0.21");
    expect(output).toContain("1 upgrade");
  });

  it("skips all timestamp fetches when cooldown is 0 (default)", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    // No POM HEAD routes registered — any attempt would throw from mock-repo
    mockAllDefaultRepos(KOTLIN_STDLIB_METADATA_XML);

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    // Default args: cooldown=0
    const exitCode = await run(buildArgs({ directory: tempDir }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      gcuHome: tempDir,
    });

    const output = outputChunks.join("");
    expect(exitCode).toBe(0);
    expect(output).toContain("2.0.21");
    expect(output).toContain("1 upgrade");
  });

  it("passes through upgrade when POM HEAD returns no Last-Modified header", async () => {
    const buildFile = join(tempDir, "build.gradle.kts");
    await writeFile(buildFile, SAMPLE_BUILD_GRADLE_KTS, "utf8");

    mockRepo({
      [KOTLIN_STDLIB_METADATA_URL]: KOTLIN_STDLIB_METADATA_XML,
      [GOOGLE_METADATA_URL]: EMPTY_METADATA_XML,
      [GRADLE_PLUGINS_METADATA_URL]: EMPTY_METADATA_XML,
      // POM HEAD returns 200 but NO last-modified header for all versions
      // Cascade iterates all versions (never finds a soaked one), so all three need mocks
      ...noLastModified(KOTLIN_POM_BASE, "2.0.21"),
      ...noLastModified(KOTLIN_POM_BASE, "2.0.0"),
      ...noLastModified(KOTLIN_POM_BASE, "1.9.0"),
    });

    const outputChunks: string[] = [];
    const fakeStdout = {
      write(chunk: string) {
        outputChunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const fakeStderr = {
      write(_chunk: string) {
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const exitCode = await run(buildArgs({ directory: tempDir, cooldown: 7 }), {
      stdout: fakeStdout,
      stderr: fakeStderr,
      gcuHome: tempDir,
    });

    const output = outputChunks.join("");
    expect(exitCode).toBe(0);
    // Unknown timestamp → not filtered → upgrade should be proposed
    expect(output).toContain("2.0.21");
    expect(output).toContain("1 upgrade");
  });
});
