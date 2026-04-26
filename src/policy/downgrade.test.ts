import { describe, it, expect } from "vitest";
import { isAllowDowngradeValid, attemptAllowDowngrade } from "./downgrade.js";

const NOW = new Date("2024-06-01T00:00:00Z");

function msAgo(days: number): number {
  return NOW.getTime() - days * 86_400_000;
}

describe("isAllowDowngradeValid", () => {
  it("allowDowngrade=true with cooldownDays=7 → valid", () => {
    expect(isAllowDowngradeValid({ allowDowngrade: true, cooldownDays: 7 })).toBe(true);
  });

  it("allowDowngrade=true with cooldownDays=undefined → invalid (usage error)", () => {
    expect(isAllowDowngradeValid({ allowDowngrade: true, cooldownDays: undefined })).toBe(
      false,
    );
  });

  it("allowDowngrade=true with cooldownDays=0 → invalid (usage error)", () => {
    expect(isAllowDowngradeValid({ allowDowngrade: true, cooldownDays: 0 })).toBe(false);
  });

  it("allowDowngrade=false with cooldownDays=undefined → valid (flag not set)", () => {
    expect(
      isAllowDowngradeValid({ allowDowngrade: false, cooldownDays: undefined }),
    ).toBe(true);
  });
});

describe("attemptAllowDowngrade", () => {
  it("BOOTSTRAP.md worked example: current 3d old, older candidates available, cooldown=7 → picks highest below current", () => {
    const publishedAt = new Map<string, number>([
      ["2.0.21", msAgo(3)],
      ["2.0.20", msAgo(10)],
      ["2.0.10", msAgo(40)],
    ]);
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.20", "2.0.10"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: msAgo(3),
      now: NOW,
    });
    expect(result).toBe("2.0.20");
  });

  it("current is soaked (published 20d ago, cooldown=7) → undefined (no downgrade warranted)", () => {
    const publishedAt = new Map<string, number>([["2.0.20", msAgo(40)]]);
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.20"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: msAgo(20),
      now: NOW,
    });
    expect(result).toBeUndefined();
  });

  it("all older candidates have unknown timestamp → undefined (cannot verify soaked)", () => {
    const publishedAt = new Map<string, number>();
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.20", "2.0.10"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: msAgo(3),
      now: NOW,
    });
    expect(result).toBeUndefined();
  });

  it("all older candidates are inside cooldown window (too recent) → undefined", () => {
    const publishedAt = new Map<string, number>([
      ["2.0.20", msAgo(2)],
      ["2.0.10", msAgo(4)],
    ]);
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.20", "2.0.10"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: msAgo(3),
      now: NOW,
    });
    expect(result).toBeUndefined();
  });

  it("multiple candidates outside cooldown window → picks highest (not oldest)", () => {
    const publishedAt = new Map<string, number>([
      ["2.0.20", msAgo(10)],
      ["2.0.15", msAgo(15)],
      ["2.0.10", msAgo(40)],
    ]);
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.20", "2.0.15", "2.0.10"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: msAgo(3),
      now: NOW,
    });
    expect(result).toBe("2.0.20");
  });

  it("candidate >= current in input list is excluded → only strictly-below versions selected", () => {
    const publishedAt = new Map<string, number>([
      ["2.0.21", msAgo(10)],
      ["2.0.20", msAgo(10)],
    ]);
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.21", "2.0.20"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: msAgo(3),
      now: NOW,
    });
    expect(result).toBe("2.0.20");
  });

  it("currentPublishedAt=undefined (unknown) → treated as inside window → downgrade proceeds if valid candidates exist", () => {
    const publishedAt = new Map<string, number>([["2.0.20", msAgo(10)]]);
    const result = attemptAllowDowngrade({
      currentVersion: "2.0.21",
      candidates: ["2.0.20"],
      publishedAt,
      cooldownDays: 7,
      currentPublishedAt: undefined,
      now: NOW,
    });
    expect(result).toBe("2.0.20");
  });
});
