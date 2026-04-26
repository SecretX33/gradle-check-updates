import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepo } from "../helpers/mock-repo.js";
import { ProjectConfigSchema, CredentialsFileSchema } from "../../src/config/schema.js";
import { run } from "../../src/cli/run.js";
import type { ParsedArgs } from "../../src/cli/args.js";

// ── ParsedArgs factory ────────────────────────────────────────────────────────
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
    json: false,
    errorOnOutdated: false,
    verbose: false,
    concurrency: 5,
    noCache: false,
    clearCache: false,
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

// ── Temp dir ──────────────────────────────────────────────────────────────────
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gcu-config-validation-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Schema unit tests ─────────────────────────────────────────────────────────

describe("ProjectConfigSchema: validation", () => {
  it("rejects an unknown key", () => {
    expect(() => ProjectConfigSchema.parse({ unknownKey: true })).toThrow();
  });

  it("rejects an invalid target value", () => {
    expect(() => ProjectConfigSchema.parse({ target: "invalid" })).toThrow();
  });

  it("accepts a valid empty config", () => {
    expect(() => ProjectConfigSchema.parse({})).not.toThrow();
  });

  it("accepts all valid target values", () => {
    for (const target of ["major", "minor", "patch"] as const) {
      expect(() => ProjectConfigSchema.parse({ target })).not.toThrow();
    }
  });
});

describe("CredentialsFileSchema: validation", () => {
  it("rejects an entry with both username/password and token (both auth modes)", () => {
    expect(() =>
      CredentialsFileSchema.parse({
        repositories: [
          {
            url: "https://example.com/",
            username: "user",
            password: "pass",
            token: "tok",
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts a valid username+password entry", () => {
    expect(() =>
      CredentialsFileSchema.parse({
        repositories: [
          { url: "https://example.com/", username: "user", password: "pass" },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts a valid token entry", () => {
    expect(() =>
      CredentialsFileSchema.parse({
        repositories: [{ url: "https://example.com/", token: "mytoken" }],
      }),
    ).not.toThrow();
  });
});

// ── Integration test: .gcu.json with unknown key causes run() to return 2 ──

describe("run() with invalid .gcu.json", () => {
  it("returns exit 2 when the project .gcu.json contains an unknown key", async () => {
    // Write an invalid .gcu.json into the temp project directory
    await writeFile(
      join(tempDir, ".gcu.json"),
      JSON.stringify({ unknownField: true }),
      "utf8",
    );

    // No build files — the config validation must fire before walking
    // Actually, config is resolved per-occurrence during policy, so we need at least
    // one build file with a dependency to trigger config resolution.
    await writeFile(
      join(tempDir, "build.gradle.kts"),
      `dependencies {\n    implementation("com.example:lib:1.0.0")\n}\n`,
      "utf8",
    );

    mockRepo({
      "https://repo.maven.apache.org/maven2/com/example/lib/maven-metadata.xml": `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`,
      "https://maven.google.com/com/example/lib/maven-metadata.xml": `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`,
      "https://plugins.gradle.org/m2/com/example/lib/maven-metadata.xml": `<?xml version="1.0"?><metadata><groupId>g</groupId><artifactId>a</artifactId><versioning><versions/></versioning></metadata>`,
    });

    const stdout = makeWritable();
    const stderr = makeWritable();

    const exitCode = await run(buildArgs({ directory: tempDir }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(2);
  });
});
