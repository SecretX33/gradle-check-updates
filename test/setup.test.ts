import { describe, expect, it } from "vitest";
import * as undici from "undici";

describe("no-network guard (setup.ts)", () => {
  it("throws a guard error when undici.request is called without mock-repo", async () => {
    await expect(
      (undici as unknown as { request: (url: string) => Promise<unknown> }).request(
        "https://example.com/api",
      ),
    ).rejects.toThrow("no-network guard");
  });

  it("error message includes the requested URL", async () => {
    const targetUrl = "https://repo1.maven.org/maven2/some/dep";
    await expect(
      (undici as unknown as { request: (url: string) => Promise<unknown> }).request(targetUrl),
    ).rejects.toThrow(targetUrl);
  });

  it("error message matches the exact expected format", async () => {
    const targetUrl = "https://plugins.gradle.org/m2/org/example/plugin/1.0/plugin-1.0.pom";
    await expect(
      (undici as unknown as { request: (url: string) => Promise<unknown> }).request(targetUrl),
    ).rejects.toThrow(
      `[no-network guard] Unexpected real HTTP request to: ${targetUrl}. Import mock-repo and register a response first.`,
    );
  });
});
