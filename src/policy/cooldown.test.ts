import { describe, it, expect } from "vitest";
import { cooldownFilter } from "./cooldown.js";

const NOW = new Date("2024-06-01T00:00:00Z");
const DAYS_30_AGO = new Date("2024-05-02T00:00:00Z");
const DAYS_10_AGO = new Date("2024-05-22T00:00:00Z");
const DAYS_31_AGO = new Date("2024-05-01T00:00:00Z");
const YESTERDAY = new Date("2024-05-31T00:00:00Z");

function makePublishedAt(map: Record<string, Date | undefined>) {
  return (version: string): Date | undefined => map[version];
}

describe("cooldownFilter", () => {
  it("cooldown 0 → all candidates pass through", () => {
    const publishedAt = makePublishedAt({ "2.0.0": YESTERDAY });
    expect(cooldownFilter(["2.0.0", "1.5.0"], publishedAt, 0, NOW)).toEqual([
      "2.0.0",
      "1.5.0",
    ]);
  });

  it("negative cooldown → all candidates pass through", () => {
    const publishedAt = makePublishedAt({ "2.0.0": YESTERDAY });
    expect(cooldownFilter(["2.0.0"], publishedAt, -5, NOW)).toEqual(["2.0.0"]);
  });

  it("candidate published before cutoff → included", () => {
    const publishedAt = makePublishedAt({ "2.0.0": DAYS_31_AGO });
    expect(cooldownFilter(["2.0.0"], publishedAt, 30, NOW)).toEqual(["2.0.0"]);
  });

  it("candidate published exactly on cutoff → included", () => {
    const publishedAt = makePublishedAt({ "2.0.0": DAYS_30_AGO });
    expect(cooldownFilter(["2.0.0"], publishedAt, 30, NOW)).toEqual(["2.0.0"]);
  });

  it("candidate published after cutoff (too recent) → excluded", () => {
    const publishedAt = makePublishedAt({ "2.0.0": DAYS_10_AGO });
    expect(cooldownFilter(["2.0.0"], publishedAt, 30, NOW)).toEqual([]);
  });

  it("candidate published yesterday under 30-day cooldown → excluded", () => {
    const publishedAt = makePublishedAt({ "2.0.0": YESTERDAY });
    expect(cooldownFilter(["2.0.0"], publishedAt, 30, NOW)).toEqual([]);
  });

  it("unknown timestamp (publishedAt returns undefined) → included (conservative)", () => {
    const publishedAt = makePublishedAt({});
    expect(cooldownFilter(["2.0.0"], publishedAt, 30, NOW)).toEqual(["2.0.0"]);
  });

  it("all within cooldown → empty result", () => {
    const publishedAt = makePublishedAt({
      "2.0.0": YESTERDAY,
      "1.5.0": DAYS_10_AGO,
    });
    expect(cooldownFilter(["2.0.0", "1.5.0"], publishedAt, 30, NOW)).toEqual([]);
  });

  it("mixed: some in cooldown, some past it", () => {
    const publishedAt = makePublishedAt({
      "2.0.0": DAYS_31_AGO,
      "1.5.0": YESTERDAY,
      "1.4.0": DAYS_30_AGO,
    });
    const result = cooldownFilter(["2.0.0", "1.5.0", "1.4.0"], publishedAt, 30, NOW);
    expect(result).toContain("2.0.0");
    expect(result).toContain("1.4.0");
    expect(result).not.toContain("1.5.0");
  });
});
