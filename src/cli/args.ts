import cac from "cac";

export type ParsedArgs = {
  directory: string;
  upgrade: boolean;
  interactive: boolean;
  target: "major" | "minor" | "patch";
  pre: boolean;
  cooldown: number;
  allowDowngrade: boolean;
  include: string[];
  exclude: string[];
  format: "text" | "json";
  errorOnOutdated: boolean;
  verboseLevel: 0 | 1 | 2;
  concurrency: number;
  noCache: boolean;
  clearCache: boolean;
};

export type ArgsParseResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: string };

const VALID_TARGETS = ["major", "minor", "patch"] as const;
const VALID_FORMATS = ["text", "json"] as const;

function normalizeToStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  const rawItems = Array.isArray(value) ? value.map(String) : [String(value)];
  return rawItems.flatMap((item) =>
    item
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ArgsParseResult {
  const cli = cac("gcu");

  cli
    .usage("[directory] [options]")
    .option("-u, --upgrade", "Write changes to disk", { default: false })
    .option("-i, --interactive", "TUI picker", { default: false })
    .option("-t, --target <target>", "Version ceiling: major, minor, or patch", {
      default: "major",
    })
    .option("--pre", "Allow prereleases as candidates", { default: false })
    .option("-c, --cooldown <days>", "Skip versions newer than N days", { default: 0 })
    .option("--allow-downgrade", "Cooldown escape hatch (requires --cooldown)", {
      default: false,
    })
    .option("--include <pattern>", "Include filter (repeatable)")
    .option("--exclude <pattern>", "Exclude filter (repeatable)")
    .option("--format <format>", "Output format: text or json", { default: "text" })
    .option("--error-on-outdated", "Exit 1 when upgrades available but -u not passed", {
      default: false,
    })
    .option(
      "--verbose [level]",
      "Verbosity: 1 = show held/skipped decisions (default when no number); 2 = also list every detected dependency, including those with no available updates",
    )
    .option("--concurrency <n>", "Max concurrent HTTP requests to registry", {
      default: 5,
    })
    .option("--no-cache", "Bypass the local metadata cache")
    .option("--clear-cache", "Clear the local cache before running", { default: false });

  // cac auto-assigns config.default=true for --no-* flags, causing "(default: true)" in help.
  // Patch it out so the flag appears without a misleading default annotation.
  const noCacheOpt = cli.globalCommand.options.find((o) => o.rawName === "--no-cache");
  if (noCacheOpt) delete (noCacheOpt.config as Record<string, unknown>)["default"];

  cli.help();

  let parsed: ReturnType<typeof cli.parse>;

  try {
    parsed = cli.parse(["node", "gcu", ...argv]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (parsed.options["help"]) process.exit(0);

  const options = parsed.options;
  const args = parsed.args;

  const directory = typeof args[0] === "string" ? args[0] : ".";

  const target = options["target"] as string;
  if (!VALID_TARGETS.includes(target as "major" | "minor" | "patch")) {
    return {
      ok: false,
      error: `Invalid --target value "${target}". Must be one of: major, minor, patch.`,
    };
  }

  let format = options["format"] as string;

  // cac doesn't expose a way to hide a flag from --help while keeping it functional, so we
  // detect the legacy --json flag by scanning raw argv rather than registering it as an option.
  if (argv.includes("--json")) {
    process.stderr.write(
      "gcu: warning: --json is deprecated. Please use --format json instead.\n",
    );
    format = "json";
  }

  if (!VALID_FORMATS.includes(format as "text" | "json")) {
    return {
      ok: false,
      error: `Invalid --format value "${format}". Must be one of: text, json.`,
    };
  }

  const rawCooldown = options["cooldown"];
  const cooldown = Number(rawCooldown);
  // cac parses `--cooldown -1` as boolean true plus a stray `-1` flag; typeof guards against that before Number() hides it
  if (typeof rawCooldown !== "number" || !Number.isInteger(cooldown) || cooldown < 0) {
    return {
      ok: false,
      error: `Invalid --cooldown value "${rawCooldown}". Must be a non-negative integer.`,
    };
  }

  const allowDowngrade = options["allowDowngrade"] as boolean;
  if (allowDowngrade && cooldown <= 0) {
    return {
      ok: false,
      error: `--allow-downgrade requires --cooldown to be set to a value greater than 0.`,
    };
  }

  const rawVerbose = options["verbose"];
  let verboseLevel: 0 | 1 | 2;
  if (rawVerbose === undefined || rawVerbose === false) {
    verboseLevel = 0;
  } else if (rawVerbose === true) {
    verboseLevel = 1;
  } else if (rawVerbose === 1 || rawVerbose === 2) {
    verboseLevel = rawVerbose;
  } else {
    return {
      ok: false,
      error: `Invalid --verbose value "${rawVerbose}". Must be 1 or 2 (or pass --verbose alone for level 1).`,
    };
  }

  const rawConcurrency = options["concurrency"];
  const concurrency = Number(rawConcurrency);
  if (
    typeof rawConcurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1
  ) {
    return {
      ok: false,
      error: `Invalid --concurrency value "${rawConcurrency}". Must be a positive integer.`,
    };
  }

  return {
    ok: true,
    args: {
      directory,
      upgrade: options["upgrade"] as boolean,
      interactive: options["interactive"] as boolean,
      target: target as "major" | "minor" | "patch",
      pre: options["pre"] as boolean,
      cooldown,
      allowDowngrade,
      include: normalizeToStringArray(options["include"]),
      exclude: normalizeToStringArray(options["exclude"]),
      format: format as "text" | "json",
      errorOnOutdated: options["errorOnOutdated"] as boolean,
      verboseLevel,
      concurrency,
      noCache: options["cache"] === false,
      clearCache: Boolean(options["clearCache"]),
    },
  };
}
