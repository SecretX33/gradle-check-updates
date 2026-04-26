import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLastRequestOptions, mockRepo } from "../../test/helpers/mock-repo.js";
import { Cache } from "./cache.js";
import { fetchMetadata, fetchVersionTimestamp, RepoNetworkError } from "./client.js";

const REPO_URL = "https://repo.example.com/maven2";
const SPRING_METADATA_URL = `${REPO_URL}/org/springframework/boot/spring-boot-starter/maven-metadata.xml`;

const SAMPLE_METADATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter</artifactId>
  <versioning>
    <versions>
      <version>3.1.0</version>
      <version>3.2.0</version>
    </versions>
    <lastUpdated>20240101120000</lastUpdated>
  </versioning>
</metadata>`;

let tempCacheDir: string;
let cache: Cache;

beforeEach(async () => {
  tempCacheDir = await mkdtemp(join(tmpdir(), "gcu-client-test-"));
  cache = new Cache(tempCacheDir);
});

afterEach(async () => {
  await rm(tempCacheDir, { recursive: true, force: true });
});

describe("fetchMetadata", () => {
  it("fetches and parses metadata from mock repo", async () => {
    mockRepo({ [SPRING_METADATA_URL]: SAMPLE_METADATA_XML });
    const result = await fetchMetadata(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      { cache },
    );
    expect(result.versions).toEqual(["3.1.0", "3.2.0"]);
    expect(result.lastUpdated).toBe("20240101120000");
  });

  it("returns empty versions on 404", async () => {
    mockRepo({ [SPRING_METADATA_URL]: { status: 404, body: "" } });
    const result = await fetchMetadata(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      { cache },
    );
    expect(result.versions).toEqual([]);
  });

  it("uses cache on second call and does not call mock twice", async () => {
    mockRepo({ [SPRING_METADATA_URL]: SAMPLE_METADATA_XML });
    // First call: fetches from mock and writes to cache
    await fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
      cache,
    });
    // Clear mock so any new request would throw
    mockRepo({});
    // Second call: must be served from cache, not from mock
    const result = await fetchMetadata(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      { cache },
    );
    expect(result.versions).toEqual(["3.1.0", "3.2.0"]);
  });

  it("skips cache read when noCache is true", async () => {
    // Pre-populate cache with stale data
    await cache.set(
      SPRING_METADATA_URL,
      `<?xml version="1.0"?><metadata><versioning><versions><version>1.0.0</version></versions></versioning></metadata>`,
    );
    mockRepo({ [SPRING_METADATA_URL]: SAMPLE_METADATA_XML });
    const result = await fetchMetadata(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      { cache, noCache: true },
    );
    // Should return fresh data from mock, not stale cached data
    expect(result.versions).toEqual(["3.1.0", "3.2.0"]);
  });

  it("adds Authorization: Bearer header when token credentials match repo URL", async () => {
    mockRepo({ [SPRING_METADATA_URL]: SAMPLE_METADATA_XML });
    const credentials = new Map([["https://repo.example.com", { token: "my-token" }]]);
    const result = await fetchMetadata(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      { cache, credentials, noCache: true },
    );
    expect(result.versions).toEqual(["3.1.0", "3.2.0"]);
    expect(getLastRequestOptions().headers).toMatchObject({
      authorization: "Bearer my-token",
    });
  });

  it("adds Authorization: Basic header when username+password credentials match", async () => {
    mockRepo({ [SPRING_METADATA_URL]: SAMPLE_METADATA_XML });
    const credentials = new Map([
      ["https://repo.example.com", { username: "user", password: "pass" }],
    ]);
    const result = await fetchMetadata(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      { cache, credentials, noCache: true },
    );
    expect(result.versions).toEqual(["3.1.0", "3.2.0"]);
    expect(getLastRequestOptions().headers).toMatchObject({
      authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
    });
  });

  it("throws RepoNetworkError on HTTP 500", async () => {
    mockRepo({ [SPRING_METADATA_URL]: { status: 500, body: "Server Error" } });
    await expect(
      fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
        cache,
        noCache: true,
      }),
    ).rejects.toThrow(RepoNetworkError);
  });

  it("no-network safety: throws when URL is not registered in mock", async () => {
    mockRepo({}); // empty mock — any URL throws
    await expect(
      fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
        cache,
        noCache: true,
      }),
    ).rejects.toThrow("mock-repo: unexpected request");
  });

  describe("logging", () => {
    function makeStderr(): { stream: NodeJS.WritableStream; output: () => string } {
      const chunks: string[] = [];
      const stream = {
        write(chunk: string) {
          chunks.push(chunk);
          return true;
        },
      } as unknown as NodeJS.WritableStream;
      return { stream, output: () => chunks.join("") };
    }

    it("cache hit — no stderr output", async () => {
      // Pre-populate cache
      await cache.set(SPRING_METADATA_URL, SAMPLE_METADATA_XML);
      const { stream, output } = makeStderr();
      await fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
        cache,
        stderr: stream,
      });
      expect(output()).toBe("");
    });

    it("HTTP 404 — no stderr output", async () => {
      mockRepo({ [SPRING_METADATA_URL]: { status: 404, body: "" } });
      const { stream, output } = makeStderr();
      const result = await fetchMetadata(
        REPO_URL,
        "org.springframework.boot",
        "spring-boot-starter",
        { cache, noCache: true, stderr: stream },
      );
      expect(result.versions).toEqual([]);
      expect(output()).toBe("");
    });

    it("HTTP 500 — always logs status line", async () => {
      mockRepo({ [SPRING_METADATA_URL]: { status: 500, body: "Internal Server Error" } });
      const { stream, output } = makeStderr();
      await expect(
        fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
          cache,
          noCache: true,
          stderr: stream,
        }),
      ).rejects.toThrow(RepoNetworkError);
      expect(output()).toContain(`gcu: warning: HTTP 500 from ${SPRING_METADATA_URL}`);
    });

    it("HTTP 500 with verbose=false — logs status but not response body", async () => {
      mockRepo({ [SPRING_METADATA_URL]: { status: 500, body: "Internal Server Error" } });
      const { stream, output } = makeStderr();
      await expect(
        fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
          cache,
          noCache: true,
          verbose: false,
          stderr: stream,
        }),
      ).rejects.toThrow(RepoNetworkError);
      expect(output()).toContain("gcu: warning: HTTP 500");
      expect(output()).not.toContain("Internal Server Error");
    });

    it("HTTP 500 with verbose=true — logs status and response body", async () => {
      mockRepo({ [SPRING_METADATA_URL]: { status: 500, body: "Internal Server Error" } });
      const { stream, output } = makeStderr();
      await expect(
        fetchMetadata(REPO_URL, "org.springframework.boot", "spring-boot-starter", {
          cache,
          noCache: true,
          verbose: true,
          stderr: stream,
        }),
      ).rejects.toThrow(RepoNetworkError);
      expect(output()).toContain("gcu: warning: HTTP 500");
      expect(output()).toContain("Internal Server Error");
    });

    it("successful request — no stderr output", async () => {
      mockRepo({ [SPRING_METADATA_URL]: SAMPLE_METADATA_XML });
      const { stream, output } = makeStderr();
      const result = await fetchMetadata(
        REPO_URL,
        "org.springframework.boot",
        "spring-boot-starter",
        { cache, noCache: true, stderr: stream },
      );
      expect(result.versions).toEqual(["3.1.0", "3.2.0"]);
      expect(output()).toBe("");
    });
  });
});

describe("fetchVersionTimestamp", () => {
  const SPRING_POM_URL = `${REPO_URL}/org/springframework/boot/spring-boot-starter/3.2.0/spring-boot-starter-3.2.0.pom`;

  it("returns Last-Modified from mock response headers as ISO 8601", async () => {
    mockRepo({
      [SPRING_POM_URL]: {
        status: 200,
        body: "",
        headers: { "last-modified": "Wed, 01 Jan 2025 12:00:00 GMT" },
      },
    });
    const result = await fetchVersionTimestamp(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      "3.2.0",
      { cache },
    );
    expect(result).toBe("2025-01-01T12:00:00.000Z");
  });

  it("returns undefined when Last-Modified header is absent", async () => {
    mockRepo({ [SPRING_POM_URL]: { status: 200, body: "" } });
    const result = await fetchVersionTimestamp(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      "3.2.0",
      { cache },
    );
    expect(result).toBeUndefined();
  });

  it("caches the result so a second call does not hit the mock", async () => {
    mockRepo({
      [SPRING_POM_URL]: {
        status: 200,
        body: "",
        headers: { "last-modified": "Wed, 01 Jan 2025 12:00:00 GMT" },
      },
    });
    // First call populates cache
    await fetchVersionTimestamp(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      "3.2.0",
      { cache },
    );
    // Clear mock so any new request would throw
    mockRepo({});
    // Second call must come from cache
    const result = await fetchVersionTimestamp(
      REPO_URL,
      "org.springframework.boot",
      "spring-boot-starter",
      "3.2.0",
      { cache },
    );
    expect(result).toBe("2025-01-01T12:00:00.000Z");
  });
});
