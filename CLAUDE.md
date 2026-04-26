# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

`gcu` (gradle-check-updates) is a CLI that ports `npm-check-updates` to the Gradle ecosystem: scan a project's build files, find available dependency upgrades, and rewrite version strings in place. As of the latest design draft (2026-04-25) the repository contains only `docs/BOOTSTRAP.md` and `package.json` — no source, no tests yet. Implementation work should follow the design doc; treat it as the source of truth.

## Commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm test` | Full Vitest suite (unit + fixture + integration) |
| `pnpm test <path>` | Run a single test file |
| `pnpm build` | `tsdown` bundle to `dist/` |
| `pnpm dev` | Watch build (development mode) |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm format` | Check formatting |
| `pnpm format:write` | Auto-fix formatting |
| `node dist/index.js [args]` | Run the built CLI locally |

## Cardinal rule — preserve the user's file exactly

The rewriter MUST NOT reorder, reformat, change indentation, or lose comments. The only bytes that change are the version string itself. This rules out parse → AST → regenerate. Strategy is **byte-precise, in-place string replacement**:

- Each format locator emits `Occurrence` records that point to the exact location of the version literal.
- A single rewriter (`rewrite/`) splices the new bytes in, leaving the rest of the buffer untouched.
- Tests must assert byte-for-byte equality on unchanged regions, including CRLF vs LF, tabs vs spaces, trailing newlines, and adjacent comments.

When in doubt about whether a transformation is allowed, the answer is no — emit a report-only entry instead.

## Pipeline

```
discover → locate → resolve refs → discover repos → fetch metadata
        → decide upgrade (policy) → render report → apply (if -u)
```

The split that matters: **the locator is the only format-specific stage.** Everything downstream (`refs/`, `repos/`, `policy/`, `report/`, `rewrite/`) consumes the uniform `Occurrence` type defined in `docs/BOOTSTRAP.md` and operates identically across Groovy DSL, Kotlin DSL, version catalogs, and `gradle.properties`. When adding a new format, write only a locator — do not push format-specific logic downstream.

`Occurrence` carries both the canonical edit site and a `via` indirection chain for reporting. Variable references (`$kotlinVersion`, `version.ref`, `ext`, `val`) resolve to the *definition* site so edits land in `gradle.properties` / `[versions]` / wherever the literal actually lives — not at the consumer.

## Rich-version coherence

Multiple `Occurrence`s sharing a `dependencyKey` represent one logical dependency (e.g. a `version { strictly(...); prefer(...) }` block). Policy uses the strongest constraint (`strictly` > `require` > `prefer`) for the target measurement, then bumps siblings to stay coherent. A sibling `reject(...)` matching the winner aborts the whole block's update with exit code 5. `richReject` is **never** auto-modified — it encodes a deliberate "never use this".

## Version shape eligibility

The shape inventory in `docs/BOOTSTRAP.md` is the contract for what's rewritable vs report-only. Notable opt-outs: `snapshot`, `latestQualifier`, `mavenRange` (v1), `richReject`, `richStrictly` when the value is a range, BOM-managed deps. `prefix` keeps the same depth (`1.3.+` → `1.5.+`, never `2.+`). `strictlyShorthand` preserves `!!`. `strictlyPreferShort` keeps both halves coherent.

## Update policy ordering

Policy is a deterministic 6-stage pipeline per `Occurrence`: track filter → cooldown → user include/exclude → target ceiling → per-shape eligibility → pick max. **The tool never downgrades a dependency by default** — candidates `< current` are filtered out before any stage runs. The single exception is `--allow-downgrade`, which is only meaningful with `--cooldown`: when cooldown empties everything `≥ current` *and* the current version itself is inside the cooldown window, the policy may select the highest cooldown-eligible candidate strictly below current. Bare `--allow-downgrade` (without `--cooldown`) is a usage error (exit `2`). Without that flag, if cooldown empties everything strictly above current, the dep is reported as `cooldown-blocked` and stays put. When a shared variable has consumers that disagree, take the **lowest** of the per-dep winners and warn naming the dependency that constrained the choice.

## Discovery skip list

The walker prunes well-known directories anywhere in the tree: `.gradle`, `.idea`, `.vscode`, `.git`, `.hg`, `.svn`, `build`, `out`, `target`, `node_modules`, `.pnpm-store`, `.yarn`, `.gcu`, `__pycache__`, `.venv`, `venv`. Plus any directory whose name starts with `.` (allow-list extension point exists but is empty in v1). Hardcoded — no `.gcuignore`, no `--ignore` flag.

`settings.gradle(.kts)` is parsed (via the kotlin-dsl tokenizer) for: version catalog imports (`versionCatalogs { create() { from(files()) } }`), repository URLs from `pluginManagement { repositories { ... } }` and `dependencyResolutionManagement { repositories { ... } }`, and plugin declarations from both the top-level `plugins {}` block and `pluginManagement { plugins {} }`.

## Multi-config overrides

Each `Occurrence` is governed by **chained inheritance**: all `.gcu.json` files from `projectRoot` down to the `Occurrence`'s edit site are merged outermost-first, so inner (closer) configs override specific fields while inheriting the rest from parent configs. A submodule config can never reach upward to override how a parent file's literal is treated — the rule is "inner config inherits parent fields and overrides only what it sets." Catalog rule: `gradle/libs.versions.toml` walks up from `gradle/`'s parent, so a `.gcu.json` adjacent to the `gradle/` folder is included in the chain. Per-Occurrence merge: CLI flags > chained project `.gcu.json` (outermost→innermost, innermost wins per field) > user `~/.gcu/config.json` > built-in defaults. The resolver memoizes `directory → fully-merged ResolvedConfig`. Required fixtures live under `test/fixtures/projects/multi-config/`.

## Config validation

All JSON config (`config.json`, `.gcu.json`, `credentials.json`) is validated by Zod schemas in `config/schema.ts` on load. Unknown keys are rejected so typos surface immediately. Validation failure → exit `2` with a clean message naming the file and field.

## Naming conventions

Use descriptive, full-word variable names in all source code under `src/`. Single-letter or abbreviated names (`v`, `b`, `s`, `m`, `t`, `c`, `r`) are not acceptable in application code — use names that make the intent clear without requiring context (`version`, `buffer`, `match`, `token`, `candidate`, `edit`, `result`). This rule is strict for `src/**/*.ts` files and do not apply to the error variable in `catch` blocks; test files (`*.test.ts`) may use short names in narrow helper closures where the type is immediately obvious.

## Tech stack

TypeScript, ESM, **pnpm**, Vitest, `tsdown` bundle, `cac` for args, `kleur`, `@inquirer/prompts`, `picomatch`, `fast-xml-parser`, `undici`, `zod`. Groovy and Kotlin DSL parsing — and version-catalog TOML extraction — are **hand-written tokenizers**; a full Groovy/Kotlin/TOML parser is explicitly out of scope. We only need string-literal-aware scanning that handles regular strings, raw triple-quoted strings, line/block comments, `$`-interpolation, and balanced braces. `settings.gradle(.kts)` is parsed via the kotlin-dsl tokenizer for `versionCatalogs`, `pluginManagement`, and `dependencyResolutionManagement` blocks.

## Testing layout

- **Unit tests** live next to source as `*.test.ts`.
- **Fixture/golden tests** under `test/fixtures/<format>/<case>/` follow `input.<ext>` + `expected.<ext>` + `edits.json`. The rewriter assertion is byte-for-byte equality.
- **Integration tests** under `test/integration/` mock HTTP at the `repos/` boundary via `test/helpers/mock-repo.ts`. Tests must fail loudly if anything attempts a real network call — no-network safety is a required behavior.

When adding a new shape or format, add the corresponding fixture from the inventory in `docs/BOOTSTRAP.md` §Test fixture inventory before writing code. The fixture *is* the spec.

## CLI surface notes

- Default human output renders per file with a `Checking <relative-path>` header. All entries are flat, sorted alphabetically by `group:artifact`, with right-aligned version columns so the `→` arrow sits in a fixed column. Color palette (via `kleur`): patch=green, minor=cyan, major=red, downgrade=magenta; arrows and held-version dim. Severity annotations (`(patch)`, `(minor)`, `(major)`) are hidden by default and shown only with `--verbose`. There is **no `--no-color` flag** — color and Unicode glyphs auto-degrade to ASCII when `process.stdout.isTTY` is false.
- A TTY progress bar (`[████░░░░]  N/total`) is rendered to stderr during metadata fetching and erased before the report prints. In non-TTY mode a single "Fetching metadata..." line is written instead.
- When adding or removing CLI flags, always update `README.md`'s Flags table to match.
- `--json` sends human-readable output to **stderr** so stdout stays a clean JSON document. The `updates[]` array contains only the post-policy winners (skipped/held/errored items are omitted). Entries gain `"direction": "down"` when `--allow-downgrade` triggered the choice; `"up"` is the default and is omitted.
- Exit codes are meaningful: `1` = upgrades available without `-u` (only when `--error-on-outdated` is set), `2` = usage / config validation failure, `3` = parse error, `4` = network, `5` = rich-block coherence conflict.
- Filter flags are `-i, --include` and `-x, --exclude` (renamed from the old `--filter` / `--skip`). `--interactive` is long-form only — `-i` belongs to `--include`.
- User state lives under a single `~/.gcu/` directory (`config.json`, `credentials.json`, `cache/`) on all OSes — no XDG indirection. All gcu config is JSON. Credentials use longest-prefix URL matching; values starting with `$` resolve from `process.env`. `username`+`password` xor `token` per entry — both is a validation error.
- Config precedence is **per Occurrence**: CLI flags > chained project `.gcu.json` (all configs from projectRoot down to edit site, innermost wins per field) > user `~/.gcu/config.json` > built-in defaults.
