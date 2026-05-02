import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("returns defaults when no arguments are provided", () => {
    const result = parseArgs([]);

    expect(result).toEqual({
      ok: true,
      args: {
        directory: ".",
        upgrade: false,
        interactive: false,
        target: undefined,
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
      },
    });
  });

  it("sets directory from positional argument", () => {
    const result = parseArgs(["/path/to/project"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ directory: "/path/to/project" }),
    });
  });

  it("enables --upgrade with -u flag", () => {
    const result = parseArgs(["-u"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ upgrade: true }),
    });
  });

  it("enables --interactive with long-form flag", () => {
    const result = parseArgs(["--interactive"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ interactive: true }),
    });
  });

  it("enables --interactive with -i shorthand", () => {
    const result = parseArgs(["-i"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ interactive: true }),
    });
  });

  it("accepts --target patch", () => {
    const result = parseArgs(["--target", "patch"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ target: "patch" }),
    });
  });

  it("accepts --target minor", () => {
    const result = parseArgs(["--target", "minor"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ target: "minor" }),
    });
  });

  it("accepts --target major", () => {
    const result = parseArgs(["--target", "major"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ target: "major" }),
    });
  });

  it("returns error for invalid --target value", () => {
    const result = parseArgs(["--target", "latest"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/target/i);
    }
  });

  it("accepts --cooldown with a non-negative integer", () => {
    const result = parseArgs(["--cooldown", "7"]);

    expect(result).toEqual({ ok: true, args: expect.objectContaining({ cooldown: 7 }) });
  });

  it("returns error for negative --cooldown value", () => {
    const result = parseArgs(["--cooldown", "-1"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cooldown/i);
    }
  });

  it("returns error for non-integer --cooldown value", () => {
    const result = parseArgs(["--cooldown", "1.5"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cooldown/i);
    }
  });

  it("returns error for --allow-downgrade without --cooldown", () => {
    const result = parseArgs(["--allow-downgrade"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cooldown/i);
    }
  });

  it("returns error for --allow-downgrade when --cooldown is 0", () => {
    const result = parseArgs(["--cooldown", "0", "--allow-downgrade"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cooldown/i);
    }
  });

  it("accepts --allow-downgrade when --cooldown > 0", () => {
    const result = parseArgs(["--allow-downgrade", "--cooldown", "7"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ allowDowngrade: true, cooldown: 7 }),
    });
  });

  it("collects repeatable --include flags", () => {
    const result = parseArgs(["--include", "foo", "--include", "bar"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ include: ["foo", "bar"] }),
    });
  });

  it("collects repeatable --exclude flags", () => {
    const result = parseArgs(["--exclude", "foo", "--exclude", "bar"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ exclude: ["foo", "bar"] }),
    });
  });

  it("normalizes single --include value to array", () => {
    const result = parseArgs(["--include", "com.example"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ include: ["com.example"] }),
    });
  });

  it("normalizes single --exclude value to array", () => {
    const result = parseArgs(["--exclude", "com.example"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ exclude: ["com.example"] }),
    });
  });

  it("splits comma-separated --include into multiple patterns", () => {
    const result = parseArgs(["--include", "group1:name1,group2:name2,group3:name3"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({
        include: ["group1:name1", "group2:name2", "group3:name3"],
      }),
    });
  });

  it("splits comma-separated --exclude into multiple patterns", () => {
    const result = parseArgs(["--exclude", "group1:name1,group2:name2"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ exclude: ["group1:name1", "group2:name2"] }),
    });
  });

  it("mixes comma-separated and repeated --include flags", () => {
    const result = parseArgs([
      "--include",
      "group1:name1,group2:name2",
      "--include",
      "group3:name3",
    ]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({
        include: ["group1:name1", "group2:name2", "group3:name3"],
      }),
    });
  });

  it("trims whitespace from comma-separated --include values", () => {
    const result = parseArgs(["--include", "group1:name1, group2:name2 , group3:name3"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({
        include: ["group1:name1", "group2:name2", "group3:name3"],
      }),
    });
  });

  it("enables --pre flag", () => {
    const result = parseArgs(["--pre"]);

    expect(result).toEqual({ ok: true, args: expect.objectContaining({ pre: true }) });
  });

  it("enables --format json flag via --json fallback", () => {
    const result = parseArgs(["--json"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ format: "json" }),
    });
  });

  it("enables --format json flag directly", () => {
    const result = parseArgs(["--format", "json"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ format: "json" }),
    });
  });

  it("rejects --json and --format used together", () => {
    const result = parseArgs(["--json", "--format", "text"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--json and --format cannot be used together/);
    }
  });

  it("rejects --json and --format=json used together (--format=value form)", () => {
    const result = parseArgs(["--json", "--format=json"]);

    expect(result.ok).toBe(false);
  });

  it("accepts --format text explicitly", () => {
    const result = parseArgs(["--format", "text"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ format: "text" }),
    });
  });

  it("returns error for invalid --format value", () => {
    const result = parseArgs(["--format", "yaml"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/format/i);
      expect(result.error).toMatch(/text/);
      expect(result.error).toMatch(/json/);
    }
  });

  it("enables --error-on-outdated flag", () => {
    const result = parseArgs(["--error-on-outdated"]);

    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ errorOnOutdated: true }),
    });
  });

  it("defaults --concurrency to 5", () => {
    const result = parseArgs([]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ concurrency: 5 }),
    });
  });

  it("accepts a custom --concurrency value", () => {
    const result = parseArgs(["--concurrency", "10"]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ concurrency: 10 }),
    });
  });

  it("returns error for --concurrency of zero", () => {
    const result = parseArgs(["--concurrency", "0"]);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("concurrency") });
  });

  it("returns error for negative --concurrency", () => {
    const result = parseArgs(["--concurrency", "-2"]);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("concurrency") });
  });

  it("defaults --no-cache to false", () => {
    const result = parseArgs([]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ noCache: false }),
    });
  });

  it("enables --no-cache flag", () => {
    const result = parseArgs(["--no-cache"]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ noCache: true }),
    });
  });

  it("defaults --clear-cache to false", () => {
    const result = parseArgs([]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ clearCache: false }),
    });
  });

  it("enables --clear-cache flag", () => {
    const result = parseArgs(["--clear-cache"]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ clearCache: true }),
    });
  });

  it("--verbose alone is verbose level 1", () => {
    const result = parseArgs(["--verbose"]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ verboseLevel: 1 }),
    });
  });

  it("--verbose 1 is verbose level 1", () => {
    const result = parseArgs(["--verbose", "1"]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ verboseLevel: 1 }),
    });
  });

  it("--verbose 2 is verbose level 2", () => {
    const result = parseArgs(["--verbose", "2"]);
    expect(result).toEqual({
      ok: true,
      args: expect.objectContaining({ verboseLevel: 2 }),
    });
  });

  it("returns error for --verbose 3", () => {
    const result = parseArgs(["--verbose", "3"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/verbose/i);
    }
  });

  it("returns error for --verbose 0", () => {
    const result = parseArgs(["--verbose", "0"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/verbose/i);
    }
  });

  it("returns error for non-numeric --verbose value", () => {
    const result = parseArgs(["--verbose", "foo"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/verbose/i);
    }
  });
});
