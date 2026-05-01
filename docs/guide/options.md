# Command Line Options

All options for `gradle-check-updates` (`gcu`).

## Core Actions

| Option                  | Default | Description                                                    |
|-------------------------|---------|----------------------------------------------------------------|
| `[directory]`           | `.`     | Root directory to scan.                                        |
| `-u, --upgrade`         | `false` | Write changes to disk. Without this, `gcu` runs a dry-run.     |
| `-i, --interactive`     | `false` | Launch a TUI picker to selectively choose which deps to upgrade. |

## Upgrade Policy

| Option                  | Default | Description                                                    |
|-------------------------|---------|----------------------------------------------------------------|
| `-t, --target <target>` | `major` | Version ceiling for upgrades: `major`, `minor`, or `patch`.    |
| `-c, --cooldown <days>` | `0`     | Security feature: skip versions published newer than N days.   |
| `--allow-downgrade`     | `false` | Enforce cooldowns by allowing rollbacks (requires `--cooldown`). |
| `--pre`                 | `false` | Allow prereleases (e.g. betas, RCs) as upgrade candidates.     |

## Filtering

| Option                  | Default | Description                                                    |
|-------------------------|---------|----------------------------------------------------------------|
| `--include <pattern>`   |         | Include filter, repeatable. Accepts comma-separated patterns (e.g. `--include "com.google.*,org.jetbrains:*"`) or multiple flags. |
| `--exclude <pattern>`   |         | Exclude filter, repeatable. Accepts comma-separated patterns (e.g. `--exclude "junit:*,org.legacy:*"`) or multiple flags.  |

## Output & CI

| Option                  | Default | Description                                                    |
|-------------------------|---------|----------------------------------------------------------------|
| `--format <format>`     | `text`  | Output format: `text` or `json`. When `json`, human output goes to stderr and JSON to stdout. |
| `--error-on-outdated`   | `false` | Exit code 1 when upgrades are available but `-u` was not passed. Excellent for CI gates. |
| `--verbose [level]`     | `0`     | Verbosity. `--verbose 1` shows held/skipped entries. `--verbose 2` lists *every* detected dependency, including those already at the latest version. |

## Network & Cache

| Option                  | Default | Description                                                    |
|-------------------------|---------|----------------------------------------------------------------|
| `--concurrency <n>`     | `5`     | Max number of concurrent HTTP requests to the registry.        |
| `--no-cache`            | `false` | Bypass the local metadata cache for this run.                  |
| `--clear-cache`         | `false` | Delete the local cache before running, then fetch fresh data.  |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success - no upgrades available, or `-u` applied all upgrades |
| `1`  | Upgrades available but `-u` was not passed (only when `--error-on-outdated` is set) |
| `2`  | Usage or config validation error |
| `3`  | Project file parse error |
| `4`  | Network / repository error |
| `5`  | Rich-block coherence conflict prevented a rewrite |
