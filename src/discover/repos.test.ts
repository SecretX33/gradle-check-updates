// src/discover/repos.test.ts
import { describe, it, expect } from "vitest";
import { extractRepositoryUrls } from "./repos.js";

// ── Groovy DSL tests ─────────────────────────────────────────────────────────

describe("extractRepositoryUrls — groovy-dsl", () => {
  it("recognizes mavenCentral()", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  mavenCentral()\n}`,
      "groovy-dsl",
    );
    expect(urls).toEqual(["https://repo.maven.apache.org/maven2/"]);
  });

  it("recognizes google()", () => {
    const urls = extractRepositoryUrls(`repositories {\n  google()\n}`, "groovy-dsl");
    expect(urls).toEqual(["https://maven.google.com/"]);
  });

  it("recognizes gradlePluginPortal()", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  gradlePluginPortal()\n}`,
      "groovy-dsl",
    );
    expect(urls).toEqual(["https://plugins.gradle.org/m2/"]);
  });

  it("ignores mavenLocal()", () => {
    const urls = extractRepositoryUrls(`repositories {\n  mavenLocal()\n}`, "groovy-dsl");
    expect(urls).toEqual([]);
  });

  it("extracts maven { url 'https://...' } with single quotes", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  maven { url 'https://jitpack.io' }\n}`,
      "groovy-dsl",
    );
    expect(urls).toEqual(["https://jitpack.io"]);
  });

  it('extracts maven { url "https://..." } with double quotes', () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  maven { url "https://jitpack.io" }\n}`,
      "groovy-dsl",
    );
    expect(urls).toEqual(["https://jitpack.io"]);
  });

  it("extracts maven { url = uri('...') } assignment form", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  maven { url = uri('https://example.com/repo') }\n}`,
      "groovy-dsl",
    );
    expect(urls).toEqual(["https://example.com/repo"]);
  });

  it("extracts multiple repositories in one block", () => {
    const urls = extractRepositoryUrls(
      `repositories {
  mavenCentral()
  google()
  maven { url 'https://jitpack.io' }
}`,
      "groovy-dsl",
    );
    expect(urls).toContain("https://repo.maven.apache.org/maven2/");
    expect(urls).toContain("https://maven.google.com/");
    expect(urls).toContain("https://jitpack.io");
    expect(urls).toHaveLength(3);
  });

  it("returns empty array when no repositories block exists", () => {
    const urls = extractRepositoryUrls(
      `dependencies {\n  implementation 'org.foo:bar:1.0'\n}`,
      "groovy-dsl",
    );
    expect(urls).toEqual([]);
  });

  it("deduplicates identical URLs", () => {
    const urls = extractRepositoryUrls(
      `repositories {
  mavenCentral()
  mavenCentral()
  maven { url 'https://repo.maven.apache.org/maven2/' }
}`,
      "groovy-dsl",
    );
    expect(urls).toEqual(["https://repo.maven.apache.org/maven2/"]);
  });

  it("ignores repositories block inside a comment", () => {
    const urls = extractRepositoryUrls(
      `// repositories { mavenCentral() }
dependencies {}`,
      "groovy-dsl",
    );
    expect(urls).toEqual([]);
  });

  it("handles repositories block with trailing comment on same line", () => {
    const urls = extractRepositoryUrls(
      `repositories {
  mavenCentral() // primary
  google() // Android deps
}`,
      "groovy-dsl",
    );
    expect(urls).toContain("https://repo.maven.apache.org/maven2/");
    expect(urls).toContain("https://maven.google.com/");
    expect(urls).toHaveLength(2);
  });
});

// ── Kotlin DSL tests ─────────────────────────────────────────────────────────

describe("extractRepositoryUrls — kotlin-dsl", () => {
  it("recognizes mavenCentral()", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  mavenCentral()\n}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://repo.maven.apache.org/maven2/"]);
  });

  it("recognizes google()", () => {
    const urls = extractRepositoryUrls(`repositories {\n  google()\n}`, "kotlin-dsl");
    expect(urls).toEqual(["https://maven.google.com/"]);
  });

  it("recognizes gradlePluginPortal()", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  gradlePluginPortal()\n}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://plugins.gradle.org/m2/"]);
  });

  it("ignores mavenLocal()", () => {
    const urls = extractRepositoryUrls(`repositories {\n  mavenLocal()\n}`, "kotlin-dsl");
    expect(urls).toEqual([]);
  });

  it("extracts maven { url = uri('...') } Kotlin assignment form", () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  maven { url = uri("https://example.com/repo") }\n}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://example.com/repo"]);
  });

  it('extracts maven("https://...") Kotlin shorthand form', () => {
    const urls = extractRepositoryUrls(
      `repositories {\n  maven("https://jitpack.io")\n}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://jitpack.io"]);
  });

  it('extracts maven { url = uri("...") } with double-quoted uri', () => {
    const urls = extractRepositoryUrls(
      `repositories {
  maven {
    url = uri("https://packages.example.com/maven")
  }
}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://packages.example.com/maven"]);
  });

  it("returns empty array when no repositories block exists", () => {
    const urls = extractRepositoryUrls(
      `dependencies {\n  implementation("org.foo:bar:1.0")\n}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual([]);
  });

  it("deduplicates identical URLs", () => {
    const urls = extractRepositoryUrls(
      `repositories {
  mavenCentral()
  mavenCentral()
}`,
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://repo.maven.apache.org/maven2/"]);
  });

  it('extracts maven { url = "https://..." } direct string assignment', () => {
    const urls = extractRepositoryUrls(
      'repositories {\n  maven { url = "https://jitpack.io" }\n}',
      "kotlin-dsl",
    );
    expect(urls).toEqual(["https://jitpack.io"]);
  });

  it("handles multiple repositories", () => {
    const urls = extractRepositoryUrls(
      `repositories {
  mavenCentral()
  google()
  gradlePluginPortal()
  maven("https://jitpack.io")
}`,
      "kotlin-dsl",
    );
    expect(urls).toContain("https://repo.maven.apache.org/maven2/");
    expect(urls).toContain("https://maven.google.com/");
    expect(urls).toContain("https://plugins.gradle.org/m2/");
    expect(urls).toContain("https://jitpack.io");
    expect(urls).toHaveLength(4);
  });
});
