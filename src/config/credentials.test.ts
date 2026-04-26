import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadCredentials } from "./credentials.js";

const TEST_TEMP_DIR = join(tmpdir(), `gcu-credentials-test-${process.pid}`);

async function writeTempCredentials(filename: string, content: string): Promise<string> {
  const filePath = join(TEST_TEMP_DIR, filename);
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

beforeEach(async () => {
  await mkdir(TEST_TEMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_TEMP_DIR, { recursive: true, force: true });
});

describe("loadCredentials", () => {
  it("returns an empty Map when the file does not exist", async () => {
    const result = await loadCredentials(join(TEST_TEMP_DIR, "nonexistent.json"));
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("parses literal username + password credentials", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({
        repositories: [
          { url: "https://nexus.example.com/", username: "alice", password: "secret123" },
        ],
      }),
    );
    const result = await loadCredentials(credentialsPath);
    expect(result.size).toBe(1);
    expect(result.get("https://nexus.example.com/")).toEqual({
      username: "alice",
      password: "secret123",
    });
  });

  it("parses literal token credentials", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({
        repositories: [{ url: "https://artifactory.example.com/", token: "mytoken123" }],
      }),
    );
    const result = await loadCredentials(credentialsPath);
    expect(result.size).toBe(1);
    expect(result.get("https://artifactory.example.com/")).toEqual({
      token: "mytoken123",
    });
  });

  it("resolves $VARNAME from process.env for token", async () => {
    process.env["GCU_TEST_TOKEN"] = "resolved-token-value";
    try {
      const credentialsPath = await writeTempCredentials(
        "credentials.json",
        JSON.stringify({
          repositories: [
            { url: "https://private.example.com/", token: "$GCU_TEST_TOKEN" },
          ],
        }),
      );
      const result = await loadCredentials(credentialsPath);
      expect(result.get("https://private.example.com/")).toEqual({
        token: "resolved-token-value",
      });
    } finally {
      delete process.env["GCU_TEST_TOKEN"];
    }
  });

  it("resolves $VARNAME from process.env for username and password", async () => {
    process.env["GCU_TEST_USER"] = "envuser";
    process.env["GCU_TEST_PASS"] = "envpass";
    try {
      const credentialsPath = await writeTempCredentials(
        "credentials.json",
        JSON.stringify({
          repositories: [
            {
              url: "https://nexus.example.com/",
              username: "$GCU_TEST_USER",
              password: "$GCU_TEST_PASS",
            },
          ],
        }),
      );
      const result = await loadCredentials(credentialsPath);
      expect(result.get("https://nexus.example.com/")).toEqual({
        username: "envuser",
        password: "envpass",
      });
    } finally {
      delete process.env["GCU_TEST_USER"];
      delete process.env["GCU_TEST_PASS"];
    }
  });

  it("throws ConfigError when referenced env var is not set", async () => {
    delete process.env["GCU_MISSING_VAR"];
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({
        repositories: [
          { url: "https://private.example.com/", token: "$GCU_MISSING_VAR" },
        ],
      }),
    );
    await expect(loadCredentials(credentialsPath)).rejects.toThrow(ConfigError);
    await expect(loadCredentials(credentialsPath)).rejects.toThrow("GCU_MISSING_VAR");
  });

  it("throws a Zod validation error when both username+password and token are present", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({
        repositories: [
          {
            url: "https://nexus.example.com/",
            username: "alice",
            password: "secret",
            token: "extratoken",
          },
        ],
      }),
    );
    await expect(loadCredentials(credentialsPath)).rejects.toThrow();
  });

  it("result Map keys are the URL values from each entry", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({
        repositories: [
          { url: "https://nexus.example.com/maven2/", token: "tok1" },
          {
            url: "https://artifactory.example.com/repo/",
            username: "bob",
            password: "pass2",
          },
        ],
      }),
    );
    const result = await loadCredentials(credentialsPath);
    expect([...result.keys()].sort()).toEqual([
      "https://artifactory.example.com/repo/",
      "https://nexus.example.com/maven2/",
    ]);
  });

  it("throws when the file contains invalid JSON", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      "{ not valid json",
    );
    await expect(loadCredentials(credentialsPath)).rejects.toThrow();
  });

  it("throws Zod error when a non-URL value is used in an entry", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({ repositories: [{ url: "not-a-url", token: "tok" }] }),
    );
    await expect(loadCredentials(credentialsPath)).rejects.toThrow();
  });

  it("throws Zod error when the top-level structure is missing the repositories key", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({ "https://nexus.example.com/": { token: "tok" } }),
    );
    await expect(loadCredentials(credentialsPath)).rejects.toThrow();
  });

  it("throws Zod error when repositories is not an array", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({
        repositories: { "https://nexus.example.com/": { token: "tok" } },
      }),
    );
    await expect(loadCredentials(credentialsPath)).rejects.toThrow();
  });

  it("accepts an empty repositories array", async () => {
    const credentialsPath = await writeTempCredentials(
      "credentials.json",
      JSON.stringify({ repositories: [] }),
    );
    const result = await loadCredentials(credentialsPath);
    expect(result.size).toBe(0);
  });
});
