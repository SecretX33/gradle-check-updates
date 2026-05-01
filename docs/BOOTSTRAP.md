# gradle-check-updates (`gcu`) — design

> Status: design draft, 2026-04-25
> Inspiration: [`npm-check-updates`](https://github.com/raineorshine/npm-check-updates) — same idea, ported to the Gradle ecosystem.

## Context

Java/Kotlin projects on Gradle have no tool that plays the role `npm-check-updates` plays in the Node world: a fast, scriptable CLI that scans every dependency in a project, finds available upgrades, and applies them with a single flag. Gradle's own `dependencyUpdates` plugin (Ben Manes') is closer, but it requires editing `build.gradle`, runs inside a Gradle build (slow), and only reports — it doesn't write changes back. Existing IDE-only solutions (IntelliJ inspections) aren't usable in CI.

`gcu` fills that gap: a standalone CLI that reads Gradle build files directly, queries Maven repositories itself, and rewrites version strings in place — preserving the user's file structure exactly.

## Cardinal rule

**Preserve the user's file exactly.** No reordering. No reformatting. No indentation changes. No comment loss. The only bytes that change are the version string itself. Tests prove this byte-for-byte.

This rules out "parse → AST → regenerate" approaches. The strategy is **surgical, in-place string replacement**: each format's locator returns precise byte ranges; a single rewriter swaps just those bytes.

## High-level pipeline

```
1. Discover         walk project, find all build files we know
2. Locate           per-file locator emits Occurrence records
3. Resolve refs     follow $variable / version.ref to definition site
4. Discover repos   parse repositories { } blocks; merge with defaults
5. Fetch metadata   query each repo for available versions + publish dates
6. Decide upgrade   apply policy (target, pre, cooldown, filter, skip)
7. Render report    table (default), JSON (--json), or interactive (-i)
8. Apply (if -u)    surgical rewrite; never reorder or reformat
```

## Modules

| Module | Responsibility |
|---|---|
| `discover/` | File-system walk, project layout heuristics, hardcoded skip list |
| `formats/groovy-dsl/` | Locator for `build.gradle` |
| `formats/kotlin-dsl/` | Locator for `build.gradle.kts` |
| `formats/version-catalog/` | Locator for `libs.versions.toml` |
| `formats/properties/` | Locator for `gradle.properties` |
| `refs/` | Cross-file variable resolution (`$kotlinVersion`, `version.ref`, `ext`, `val`) |
| `version/` | Gradle version parsing, ordering, shape detection |
| `repos/` | Maven repository client; metadata fetch + on-disk cache |
| `policy/` | `--target`, `--pre`, `--cooldown`, `--allow-downgrade`, `--include`, `--exclude` |
| `config/` | Config discovery (per-Occurrence, upward walk), Zod validation, merge precedence |
| `report/` | Table renderer, JSON renderer, interactive picker |
| `rewrite/` | Surgical file editor — single function, single rule |
| `cli/` | Argument parsing, orchestration |
| `test/` | Fixtures, integration harness, HTTP mock layer |

The split matters because **the locator is the only thing that's format-specific.** Everything downstream operates on a uniform `Occurrence` type.

## Discovery

The walker recursively descends from the start directory and emits paths to known build files (`build.gradle`, `build.gradle.kts`, `gradle.properties`, `libs.versions.toml`, anything matching `*.gradle*` in `gradle/` for additional catalog files). It **prunes** the following directory names anywhere in the tree:

```
.gradle, .idea, .vscode, .git, .hg, .svn,
build, out, target,
node_modules, .pnpm-store, .yarn,
.gcu,
__pycache__, .venv, venv
```

In addition, any directory whose name starts with `.` is pruned unless it is on a (currently empty) allow-list. The allow-list is the documented extension point for future "I do want gcu to descend into `.foo/`" requests.

The skip list is **hardcoded in v1** — no `.gcuignore`, no `--ignore` flag. Rationale: simpler, predictable, covers all real cases. Revisit if users complain.

Test fixture: `projects/walk-skip-defaults/` seeds the project with `.gradle/`, `.idea/`, `node_modules/`, plus a real `build.gradle.kts`. Asserts only the real file is located.

## Fetching version metadata

Per repository declared in `repositories { }` or in built-in defaults (`mavenCentral`, `google`, `gradlePluginPortal`):

1. **Version list:** GET `<repo>/<group-as-path>/<artifact>/maven-metadata.xml`, parse `<versions>` via `fast-xml-parser`. Cached under `~/.gcu/cache/metadata/` keyed by URL with a 1-hour TTL (configurable via `cacheDir` / `noCache`). Version publish timestamps (for `--cooldown`) are cached permanently under `~/.gcu/cache/timestamps/`.
2. **Per-version timestamps (only when `cooldown > 0`):** parse `<lastUpdated>` from the same metadata document where present; fall back to a HEAD on the `.pom` for `Last-Modified` only if needed. Per-version timestamps are cached **indefinitely** — a published version's timestamp doesn't change.
3. **Auth:** longest-prefix match against `~/.gcu/credentials.json`. Repos without a credential entry are tried unauthenticated.

**We do not reuse the local Gradle (`~/.gradle/caches/`) or Maven (`~/.m2/repository/`) cache.** Both are keyed by what the local build resolved, not by "every published version of `group:artifact`," so they wouldn't answer the question we need. Their on-disk layouts are also undocumented and version-dependent. Hitting `maven-metadata.xml` directly is simpler, deterministic, offline-cacheable in our own cache, and doesn't depend on what the user happens to have downloaded.

## Version shapes covered

| # | Shape | Example | Eligible to rewrite? |
|---|---|---|---|
| 1 | Exact | `'org:lib:1.2.3'` | yes |
| 2 | Pre-release | `'1.3.0-beta3'`, `'1.0-rc1'`, `'1.0-M2'` | yes (track rules apply) |
| 3 | Snapshot | `'1.0-SNAPSHOT'` | report only |
| 4 | Prefix wildcard | `'1.+'`, `'1.3.+'`, `'+'` | yes; prefix depth preserved |
| 5 | Latest qualifier | `'latest.release'`, `'latest.integration'` | no — already auto-updating |
| 6 | Strictly shorthand | `'1.7.15!!'` | yes; `!!` preserved |
| 7 | Strictly+prefer shorthand | `'[1.7,1.8)!!1.7.25'` | yes; range bounds shifted to enclose new prefer |
| 8 | Maven range | `[1.0, 2.0)`, `(1.2, 1.5]`, `[1.0,)` | report only in v1 |
| 9 | `version { require(...) }` | rich block | yes |
| 10 | `version { strictly(...) }` | rich block | yes if value is a single version, else report |
| 11 | `version { prefer(...) }` | rich block | yes (coherence rule applies) |
| 12 | `version { reject(...) }` | rich block | **never** — encodes deliberate "never use this" |
| 13 | Combined rich block | multi-statement `version { ... }` | yes (with coherence rule) |
| 14 | Catalog `[versions]` entry | `kotlin = "1.9.0"` | yes |
| 15 | Catalog range entry | `kotlin = "[1.7, 1.8)"` | report only |
| 16 | Catalog rich table | `{ strictly = "...", prefer = "..." }` | yes (per field) |
| 17 | Catalog library inline version | `{ module = "...", version = "..." }` | yes |
| 18 | Catalog library `version.ref` | indirection to `[versions]` | yes — edit at the `[versions]` site |
| 19 | `gradle.properties` variable | `kotlinVersion=1.9.0` | yes — edit at definition |
| 20 | Kotlin DSL `val` | `val kotlinVersion = "1.9.0"` | yes — edit at definition |
| 21 | `ext` / `extra` properties | `ext.kotlinVersion = "1.9.0"` | yes — edit at definition |
| 24 | Plugin DSL versions | `plugins { id("...") version "..." }` | yes |

Out of scope for v1: BOM-managed (no version literal exists to update), build-timestamp versions (rare).

## The `Occurrence` type — the contract

Every locator emits these. Everything downstream operates on them.

```ts
type Occurrence = {
  // Identity
  group: string;
  artifact: string;

  // Canonical edit site — the only thing the rewriter needs
  file: string;        // absolute path
  byteStart: number;   // inclusive — start of the version literal
  byteEnd: number;     // exclusive — end of the version literal

  // Which build-file format this came from
  fileType: "groovy-dsl" | "kotlin-dsl" | "version-catalog" | "properties";

  // The literal currently at byteStart..byteEnd
  currentRaw: string;

  // What kind of version expression — drives policy + rewrite eligibility.
  // Closed discriminated union — one variant per shape inventory entry.
  shape:
    | "exact" | "prerelease" | "snapshot" | "prefix" | "latestQualifier"
    | "strictlyShorthand" | "strictlyPreferShort" | "mavenRange"
    | "richRequire" | "richStrictly" | "richPrefer" | "richReject";

  // Rich-version blocks emit multiple Occurrences sharing one dependencyKey
  // so the policy layer keeps siblings coherent.
  dependencyKey: string;   // canonical "group:artifact[@blockId]"

  // Optional indirection trail for reporting only (variable hop chain).
  // The canonical edit site is `file`/`byteStart`/`byteEnd`; this is just a
  // "traveled through" list of file paths that helps explain the resolution.
  via?: string[];
};
```

Reports compute `(line, column)` on demand from `byteStart` via a single `byteOffsetToLineCol(file, byte)` helper in `report/` (file contents cached for the duration of the run). Configuration name (`implementation` / `api`), catalog key, alias, and other DSL-position metadata are intentionally **not** carried on `Occurrence` — they don't affect policy, rewrite, or report output. Variable resolution happens before the locator emits, so the edit site is already canonical.

### Rewriter contract

```ts
type Edit = { byteStart: number; byteEnd: number; replacement: string };
function applyEdits(originalBytes: Buffer, edits: Edit[]): Buffer;
```

Edits are sorted descending by `byteStart` and applied to the byte buffer. Nothing else in the buffer is touched. Tests assert byte-for-byte equality on the unchanged regions.

## Update policy

Per `Occurrence`, the policy module turns the candidate list into a single winner — or no winner — through a deterministic pipeline.

**Never-downgrade invariant:** before any stage runs, candidates with version `< current` are filtered out. The tool never writes an older version *except* via the explicit `--allow-downgrade` escape hatch described below. This is unconditional and independent of every other flag.

| Stage | Filter | Rule |
|---|---|---|
| 1 | Track | If current is **stable**: keep stable only. If **prerelease**/**snapshot**: keep newer prereleases AND newer stables. `--pre` forces "include prereleases" regardless of current track. |
| 2 | Cooldown | Drop candidates published within the last N days (`--cooldown N`). Default 0. |
| 3 | User filter | Apply `--include` and `--exclude` globs/regex against `group:artifact`. |
| 4 | Target ceiling | Drop candidates exceeding `--target major\|minor\|patch` relative to the current effective version. Default `major`. |
| 5 | Per-shape eligibility | Some shapes opt out (see table above). |
| 6 | Pick max | Highest remaining version per Gradle's ordering rules. |

### `--allow-downgrade` (cooldown escape hatch)

`--allow-downgrade` is the **only** path by which gcu writes an older version. It is meaningful only in combination with `--cooldown`; specifying it alone is a usage error (exit `2`).

When `--allow-downgrade` is set:

1. The current installed version is itself evaluated against `--cooldown`. If it falls inside the cooldown window, it is treated as "not yet soaked."
2. If, *after* stage 2, no candidate `≥ current` remains *and* the current version is not yet soaked, the policy may select the **highest cooldown-eligible candidate strictly below `current`**. The chosen candidate must itself be outside the cooldown window.
3. If a candidate `≥ current` does survive cooldown, the policy proceeds normally — `--allow-downgrade` does not influence the choice.

Worked example:
- Current: `2.0.21` (3 days old).
- Available newer than current: none.
- Available older: `2.0.20` (10d), `2.0.10` (40d).
- With `--cooldown 7 --allow-downgrade`: cooldown filter empties everything `≥ current`, current itself is inside the window, fallback engages → pick `2.0.20` (highest cooldown-eligible older).
- Without `--allow-downgrade` (same other inputs): stay put, report `cooldown-blocked`.

### Current effective version (what `--target` measures against)

| Shape | Effective version |
|---|---|
| `exact`, `prerelease`, `snapshot`, `strictlyShorthand` | the literal as-is |
| `prefix` | highest currently-published version matching the prefix |
| `latestQualifier` | n/a — skipped |
| `strictlyPreferShort` | the `prefer` half |
| `mavenRange` | highest currently-published version inside the range |
| `richRequire`, `richStrictly`, `richPrefer` | `require` > `strictly` > `prefer` |

### Per-shape rewrite behavior

| Shape | What gets written |
|---|---|
| `exact`, `prerelease` | new version literal |
| `snapshot` | nothing — report only; suggest corresponding stable |
| `prefix` | updated prefix at the **same depth** (`1.3.+` → `1.5.+`, not `2.0.+`, unless target allows) |
| `strictlyShorthand` | new version + preserved `!!` |
| `strictlyPreferShort` | new range + new `prefer`; range bounds shifted to enclose the new prefer; halves stay coherent |
| `mavenRange` | nothing — report only in v1 |
| `richRequire` | rewrite string inside `require(...)` |
| `richStrictly` | rewrite if single version; report only if the value is a range |
| `richPrefer` | rewrite string inside `prefer(...)`; coherence rule applies |
| `richReject` | never auto-modified |

### Coherence rule for rich blocks

When multiple `Occurrence`s share a `dependencyKey`:

- Policy picks the winner using the **strongest** present constraint as the target measurement (`strictly` > `require` > `prefer`).
- Sibling rewrites in that block stay consistent: bumping `strictly("1.7.15")` to `2.0.1` also bumps a sibling `prefer("1.7.15")` to `2.0.1`.
- If a sibling `reject` would now match the winner → **abort that block's update** and report a conflict.

### Cooldown behavior — worked example

Given:
- Current: `1.9.0`
- Available (newest → oldest): `2.0.21` (3d ago), `2.0.20` (10d ago), `2.0.10` (40d ago), `1.9.25` (60d ago)
- `--cooldown 7`

Pipeline:
1. Stage 2 drops `2.0.21` (within window). Survivors: `2.0.20`, `2.0.10`, `1.9.25`.
2. Stage 6 picks `2.0.20`.

Cooldown obeys the never-downgrade invariant — without `--allow-downgrade`, it can only filter candidates strictly above current, never push the dependency back to an older version. If cooldown empties everything strictly above current and `--allow-downgrade` is *not* set, the dependency is reported as `cooldown-blocked` in the human output and omitted from the JSON.

### Edge cases

- Same dependency declared at two versions in different modules → reported separately, handled independently.
- A version variable used by two dependencies that disagree on the right upgrade → take the **lowest** of the per-dep winners; warn naming the dependency that constrained the choice.
- Pre-release ordering follows Gradle's documented order: `dev < alpha < rc < snapshot < final`. Implemented in `version/` with dedicated unit tests.

## CLI surface

```
gcu [options] [path]
```

`path` defaults to cwd. Walks down to find all known build files; multi-module projects handled in one pass.

### Flags

| Flag | Default | Behavior |
|---|---|---|
| `-u`, `--upgrade` | off | Write changes to disk. Without it: preview only. |
| `-i`, `--interactive` | off | TUI picker. Selected upgrades are written. |
| `-t`, `--target <major\|minor\|patch>` | `major` | Ceiling for how far a version may move. |
| `--pre` | off | Allow prereleases as candidates even when current is stable. |
| `-c`, `--cooldown <days>` | `0` | Skip versions published within the last N days. |
| `--allow-downgrade` | off | Permits selecting a cooldown-eligible candidate strictly below current when no candidate `≥ current` survives cooldown. Requires `--cooldown` — bare use exits `2`. |
| `--include <pattern>` | — | Include packages matching pattern. Repeatable. Strings, glob, or `/regex/`. |
| `--exclude <pattern>` | — | Exclude packages matching pattern. Repeatable. Same syntax as `--include`. |
| `--json` | off | Emit JSON to stdout instead of the table. |
| `--cache-dir <path>` | `~/.gcu/cache` | HTTP cache location. |
| `--no-cache` | off | Disable disk cache for this run. |
| `--error-on-outdated` | off | When upgrades are available but `-u` was not passed, exit with code `1` instead of `0`. Intended for CI gates. |
| `--verbose` | off | Log every HTTP request, file parsed, decision. |
| `--version` | — | Print tool version. |
| `-h`, `--help` | — | Help. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Ran cleanly. |
| `1` | Upgrades available but `-u` not passed. Only emitted when `--error-on-outdated` is set. |
| `2` | Usage error (includes `--allow-downgrade` without `--cooldown`, and any config/credentials validation failure). |
| `3` | Project parsing error. |
| `4` | Network / repository error after retries. |
| `5` | Conflict that prevented a rewrite (e.g., rich-block coherence violation). |

### Default (table) output

The renderer leverages the fact that many dependencies share a `group`. Within each file section, deps are bucketed by group:

- **2+ deps share a group** → render as a tree block, with the group as a bold header and artifacts as `├──`/`└──` branches (alphabetical within the group).
- **Exactly 1 dep in a group** → flat `group:artifact` line. A tree with a single branch looks empty; flat reads better.

Files always render in discovery order; trees and flat lines mix freely within a file based on the rule above.

```
file: app/build.gradle.kts

  org.springframework.boot
  ├── spring-boot-starter           3.2.0   →  3.2.5    (patch)
  ├── spring-boot-starter-actuator  3.2.0   →  3.2.5    (patch)
  └── spring-boot-starter-web       3.2.0   →  3.2.5    (patch)

  com.squareup.okhttp3
  ├── logging-interceptor           4.11.0  →  4.12.0   (minor)
  └── okhttp                        4.11.0  →  4.12.0   (minor)

  io.ktor:ktor-server-core          2.3.5   →  3.0.1    (major, blocked by --target=minor → 2.3.12)
  com.example:flaky                 2.0.21  ↓  2.0.20   (downgrade, cooldown)

file: gradle/libs.versions.toml

  androidx.compose:compose-bom      2024.02 →  2024.10  (major)

file: gradle.properties

  $kotlinVersion (used by 3 dependencies)  1.9.0  →  2.0.21  (major)

7 upgrades available, 1 held by --target, 0 held by cooldown, 1 downgrade.
Run with -u to apply.
```

#### Color palette

Color is applied via `kleur`. The palette is the only thing carrying severity information at a glance; everything else is structure.

| Element | Style | Rationale |
|---|---|---|
| Group header (`org.springframework.boot`) | **bold** | Visually anchors the tree; not colored because a group can contain mixed severities |
| Tree glyphs (`├──`, `└──`) | dim | Structure, not signal |
| Current version | default | Neutral baseline |
| Arrow (`→`, `↓`) | dim | Structure |
| Patch upgrade (new version) | green | Mirrors npm-check-updates: safe |
| Minor upgrade (new version) | cyan | Convention: mostly safe |
| Major upgrade (new version) | red | Convention: breaking |
| Downgrade (new version) | magenta | Distinct from any upgrade severity — "this is unusual" |
| Trailing annotation (`(patch)`, `(major, blocked by ...)`) | dim | Context, not signal |

#### Color and TTY detection

There is **no `--no-color` flag**. Color is enabled when `process.stdout.isTTY` is true and disabled otherwise. CI, pipes, and redirects therefore always get plain text without the user having to opt out. `kleur` honors this automatically; we don't override.

When stdout is not a TTY, Unicode arrows are also replaced with ASCII fallbacks (`→` → `->`, `↓` → `v`) and tree glyphs degrade to ASCII (`├──` → `|--`, `└──` → `\\--`).

### `--json` output

A single object with one field, `updates`, containing only the changes the tool would apply (after target/pre/cooldown/include/exclude):

```json
{
  "updates": [
    { "group": "org.jetbrains.kotlin",  "artifact": "kotlin-stdlib",     "current": "1.9.0",   "updated": "2.0.21" },
    { "group": "com.squareup.okhttp3",  "artifact": "okhttp",            "current": "4.11.0",  "updated": "4.12.0" },
    { "group": "io.ktor",               "artifact": "ktor-server-core",  "current": "2.3.5",   "updated": "2.3.12" },
    { "group": "com.example",           "artifact": "flaky",             "current": "2.0.21",  "updated": "2.0.20", "direction": "down" }
  ]
}
```

`updated` is the **winner** — the version we would actually move to, not the unconstrained latest on the server. Skipped/held/errored items don't appear in the array. When there's nothing to change: `{ "updates": [] }`.

`direction` is `"up"` when omitted. It is only ever set to `"down"` when `--allow-downgrade` triggered the selection.

When `--json` is set, all human-readable output goes to stderr so stdout stays a clean JSON document.

Stable contract: any future field additions are additive per object. Existing keys are never broken.

### Config files

Two locations, both optional:

- **Project config**: `.gcu.json` (or `.gcu.json5`). Discovered per `Occurrence` by walking upward from its edit site (see [Multi-config overrides](#multi-config-overrides)).
- **User config**: `~/.gcu/config.json` (or `.json5`), single fixed location.

Precedence (per `Occurrence`): **CLI flags > nearest project config > user config > built-in defaults.**

All fields are **optional**; missing fields take the default.

| Field | Type | Default | Notes |
|---|---|---|---|
| `target` | `"major" \| "minor" \| "patch"` | `"major"` | |
| `pre` | `boolean` | `false` | |
| `cooldown` | `number` (days, ≥ 0) | `0` | |
| `allowDowngrade` | `boolean` | `false` | only effective with `cooldown > 0` |
| `include` | `string[]` | `[]` (no inclusion filter) | |
| `exclude` | `string[]` | `[]` | |
| `cacheDir` | `string` | `"~/.gcu/cache"` | |
| `noCache` | `boolean` | `false` | |

Example:

```json
{
  "target": "minor",
  "cooldown": 7,
  "allowDowngrade": true,
  "include": ["org.springframework.*"],
  "exclude": ["io.experimental.*"]
}
```

### Multi-config overrides

Each `Occurrence` is governed by **chained inheritance**: all `.gcu.json` files from the project root down to the `Occurrence`'s edit-site directory are collected and merged outermost-first. Inner (closer) configs override specific fields while inheriting the rest from parent configs. The chain stops at the project root or the filesystem root.

A submodule's `.gcu.json` **cannot** override decisions for a literal that lives in a parent file. A submodule config can never change how the root `gradle.properties` is treated, because the walk from `gradle.properties` up to the root does not pass through the submodule directory. This rule is deliberate: only configs on the upward path from the literal to the project root participate in the chain.

**Catalog rule:** `gradle/libs.versions.toml` walks up from the `gradle/` folder's parent. A `.gcu.json` placed next to the `gradle/` folder is therefore in the chain and governs the catalog.

**Per-Occurrence merge:** CLI flags > chained project `.gcu.json` (outermost→innermost, innermost wins per field) > user `~/.gcu/config.json` > built-in defaults.

**Implementation note:** the resolver memoizes `directory → fully-merged ResolvedConfig`, so the upward walk runs at most once per directory across an entire run, regardless of how many Occurrences share a subtree.

Required test fixtures (must exist before policy tests are considered complete):

- `projects/multi-config/root-only/` — single root config governs everything.
- `projects/multi-config/submodule-override/` — root `--target major`, submodule `--target patch`; assert each module's deps respect their own ceiling.
- `projects/multi-config/properties-at-root/` — root `gradle.properties` consumed by both root and submodule; only the root config governs the rewrite (submodule config is not on the walk path for root literals).
- `projects/multi-config/catalog-adjacent/` — `.gcu.json` next to `gradle/`, asserting it governs `libs.versions.toml`.
- `projects/multi-config/chain-inherit/` — root sets `target:minor` and `pre:true`; submodule sets only `cooldown:7`; assert submodule files see all three fields merged.

### Settings.gradle.kts handling

`settings.gradle(.kts)` is parsed after discovery to extract additional catalog paths, repository URLs, and plugin occurrences. Parsing uses the kotlin-dsl tokenizer (works for both `.kts` and Groovy `.gradle` variants of the settings file).

#### Version catalog discovery

- `versionCatalogs { create("name") { from(files("path")) } }` declares catalog files at non-default paths.
- `path` is resolved relative to the settings file's directory to an absolute path.
- The declared file must exist on disk; non-existent paths are silently skipped (no error).
- Multiple `create(...)` blocks are supported.
- `from("group:artifact:version")` (published coordinates) is NOT supported in v1 — these entries are silently ignored with a warning log.
- The default discovery rule (`gradle/*.versions.toml`) still applies; settings-declared catalogs are added on top, deduplicated.

#### Repository discovery

- `pluginManagement { repositories { ... } }` and `dependencyResolutionManagement { repositories { ... } }` in settings files are parsed for repository URLs.
- Recognition patterns are the same as build-file repository extraction: `mavenCentral()`, `google()`, `gradlePluginPortal()`, `maven { url = "..." }`, `maven("...")`.
- Discovered URLs are merged with `DEFAULT_REPOS` and build-file repos, deduplicated, insertion-ordered.
- `mavenLocal()` is ignored (no network URL to query).
- `RepositoriesMode` (PREFER_SETTINGS, FAIL_ON_PROJECT_REPOS, etc.) is **not** honoured — repos are always merged unconditionally.
- Repository auto-discovery always runs; there is no flag to suppress it.

#### Plugin occurrence detection

- Top-level `plugins { id("...") version "..." }` in `settings.gradle.kts` is detected and updated identically to `build.gradle.kts`.
- `pluginManagement { plugins { id("...") version "..." } }` is also detected; such occurrences carry `via: ["pluginManagement"]` for reporting clarity.
- `force("group:artifact:version")` calls in `resolutionStrategy` blocks are detected and updated.

#### Limitations (v1)

- `from("group:artifact:version")` published catalog import: NOT supported.
- `RepositoriesMode`: NOT honoured — repos are always merged regardless of PREFER_SETTINGS etc.
- Per-occurrence repo routing: NOT implemented — all occurrences share the same deduplicated repo list.

### Config validation

Both `~/.gcu/config.json` and project `.gcu.json` are validated by a Zod schema (`config/schema.ts`) on load. Same schema for both files. Unknown keys are rejected, so typos surface immediately. Type errors surface as a clean message naming the field, the offending value, and the expected shape.

`~/.gcu/credentials.json` has its own Zod schema with the same rules.

On any validation failure the tool exits with code `2` and prints the path of the offending file alongside the validation error.

### User directory layout

`gcu` keeps all of its user-level state under a single directory in the user's home:

```
~/.gcu/
├── config.json        ← user-level config (fallback under project .gcu.json)
├── credentials.json   ← repo auth (optional)
└── cache/             ← HTTP response cache (Maven metadata + publish-date lookups)
```

`~` resolves via `os.homedir()`. Same path on macOS, Linux, and Windows (`C:\Users\<user>\.gcu\`). No XDG indirection — keep it simple, one place to look.

### Credentials file `~/.gcu/credentials.json`

Optional. Used to authenticate against private Maven repositories — including those auto-discovered from `repositories { }` blocks. No file → public-repo-only.

```json
{
  "https://nexus.example.com/repository/maven-public/": {
    "username": "ci-user",
    "password": "$NEXUS_PASSWORD"
  },
  "https://maven.pkg.github.com/myorg/": {
    "token": "$GITHUB_TOKEN"
  },
  "https://artifactory.example.com/libs-release/": {
    "username": "developer",
    "password": "literal-password"
  }
}
```

Rules:

- Each top-level key is a repository URL. Matching is **longest-prefix wins**: credentials for `https://nexus.example.com/repository/internal/` beat the more general `https://nexus.example.com/repository/` for URLs under both.
- Two auth modes:
  - `username` + `password` → HTTP Basic.
  - `token` → `Authorization: Bearer <token>`.
  - Both present in the same entry → validation error (exit `2`).
- **Env-var indirection:** any string value beginning with `$` is resolved from `process.env` at runtime. Lets CI keep secrets out of the file. Missing env var → error (exit `2`).
- **Permissions warning:** on Unix, if the file mode is not `0600`, print a warning on first read (do not fail). On Windows, best effort via an ACL sanity check; otherwise skip.

## Testing strategy

**Framework:** Vitest. Source compiles via `tsdown`; Vitest runs TypeScript directly.

| Layer | Covers | Location |
|---|---|---|
| Unit | Pure functions, one test file per source file | `*.test.ts` next to source |
| Fixture / golden | Locators + rewriter against real Gradle snippets. Input → expected `Occurrence[]`. Rewriter: input file + edit list → expected file, **byte-for-byte** | `test/fixtures/<format>/<case>/` |
| Integration | End-to-end CLI runs over sample multi-module projects. HTTP mocked at the `repos/` boundary — deterministic and offline. | `test/integration/` |

### Required behaviors with explicit tests

1. **Every version shape** in the inventory: parse, render candidate, decide eligibility, rewrite correctly.
2. **Cardinal rule — structure preservation**: golden tests for each format proving only version bytes changed. CRLF vs LF, trailing newline, tabs vs spaces, adjacent comments — all preserved.
3. **Target policy**: per-shape ceilings (e.g., `1.+` under `--target patch` doesn't bump to `2.+`).
4. **Prerelease rule**: stable→stable, prerelease→{prerelease, stable}, `--pre` opt-in.
5. **Cooldown**: blocks recent versions, never downgrades by default, falls back to highest eligible. Edge case: cooldown empties candidate set → stay put, report `cooldown-blocked`.
6. **Allow-downgrade**: with `--cooldown --allow-downgrade`, picks highest cooldown-eligible candidate strictly below current when nothing `≥ current` survives cooldown. Bare `--allow-downgrade` exits `2`.
7. **Include / exclude**: include and exclude semantics — strings, globs, regex.
8. **Variable resolution**: `gradle.properties`, Kotlin `val`, `ext`, version-catalog `version.ref` — and failure modes (variable not found, two consumers disagree).
9. **Repo discovery**: parse `repositories { }` from both DSLs, fall back to defaults.
10. **Walk skip list**: discovery prunes `.gradle/`, `.idea/`, `node_modules/`, etc., per the hardcoded list; locates the real build files alongside.
11. **Multi-config hierarchy**: each fixture under `projects/multi-config/*` proves the upward-walk-from-edit-site rule end-to-end, including the "submodule cannot reach upward" guarantee and the `gradle/`-adjacent rule for catalogs.
12. **Config validation**: malformed `.gcu.json`, unknown keys, wrong types, both auth modes set in `credentials.json`, missing env var — all exit `2` with a clean error naming the file and field.
13. **Output renderers**: table snapshot covering tree-grouping (2+ deps share group → tree block with `├──`/`└──`), single-dep-flat fallback, and the full color palette (patch=green, minor=cyan, major=red, downgrade=magenta, group header bold, glyphs dim). Color enabled in TTY-mode tests and disabled in non-TTY tests; ASCII fallbacks (`->`, `v`, `|--`, `\--`) verified. JSON schema snapshot includes the `direction: "down"` case. Interactive picker snapshotted via non-interactive test mode.
14. **No-network safety**: tests fail loudly if anything tries to reach a real network.

## Project layout

```
gradle-check-updates/
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   └── BOOTSTRAP.md
├── src/
│   ├── cli/
│   │   └── index.ts
│   ├── discover/
│   ├── formats/
│   │   ├── groovy-dsl/
│   │   ├── kotlin-dsl/
│   │   ├── version-catalog/
│   │   └── properties/
│   ├── refs/
│   ├── version/
│   ├── repos/
│   ├── policy/
│   ├── config/
│   │   └── schema.ts
│   ├── report/
│   ├── rewrite/
│   ├── types.ts
│   └── index.ts
└── test/
    ├── fixtures/
    │   ├── groovy-dsl/
    │   ├── kotlin-dsl/
    │   ├── version-catalog/
    │   ├── properties/
    │   ├── refs/
    │   └── projects/
    ├── integration/
    └── helpers/
        └── mock-repo.ts
```

## Dependencies

### Runtime

| Concern | Choice | Why |
|---|---|---|
| Arg parsing | `cac` | Tiny, ergonomic, good help output |
| Color | `kleur` | Tree-shakeable, lighter than chalk |
| Interactive picker | `@inquirer/prompts` | Composable, well-maintained |
| Glob/regex match | `picomatch` | Fast, complete glob semantics |
| XML (`maven-metadata.xml`) | `fast-xml-parser` | Standard pick |
| HTTP | `undici` | Connection pooling beyond native `fetch` |
| Config validation | `zod` | Single schema for `config.json`, `.gcu.json`, `credentials.json`; clean error messages |
| Groovy DSL parsing | hand-written tokenizer | We only need string-literal-aware scanning to find specific patterns. Full Groovy parser is overkill. |
| Kotlin DSL parsing | hand-written tokenizer | Same reasoning. Handle regular strings, raw triple-quoted, line/block comments, `$`-interpolation, balanced braces. |

The version-catalog locator parses TOML by hand — it only needs `[versions]` table extraction with precise locations, which a parser would obscure. No general-purpose TOML library is required.

### Dev

`typescript`, `vitest`, `@types/node`, `eslint` + `@typescript-eslint`, `prettier`. Build with `tsdown` to a single ESM bundle. `bin: { gcu: dist/index.js, gradle-check-updates: dist/index.js }`.

## Test fixture inventory

Each fixture is `input.<ext> + expected.<ext> + edits.json`.

| Fixture | Asserts |
|---|---|
| `groovy-dsl/exact/` | shape #1, baseline rewrite |
| `groovy-dsl/exact-tabs/` | tab indentation preserved |
| `groovy-dsl/exact-crlf/` | CRLF line endings preserved |
| `groovy-dsl/exact-trailing-comment/` | adjacent inline comment untouched |
| `groovy-dsl/prefix/` | shape #4, prefix depth preserved |
| `groovy-dsl/strictly-shorthand/` | shape #6, `!!` preserved |
| `groovy-dsl/strictly-prefer-shorthand/` | shape #7, both halves coherent |
| `groovy-dsl/maven-range/` | shape #8, **report-only**, file unchanged |
| `groovy-dsl/rich-block/` | shapes #9–#13, multi-line block, surrounding lines untouched |
| `groovy-dsl/plugins/` | shape #24 |
| `groovy-dsl/ext-property/` | shape #21, edit at `ext.` definition |
| `groovy-dsl/gstring-interpolation/` | `"$kotlinVersion"` resolved via `gradle.properties` |
| `kotlin-dsl/...` | mirror of the above for Kotlin DSL |
| `version-catalog/simple/` | shape #14 |
| `version-catalog/range/` | shape #15, report-only |
| `version-catalog/rich-table/` | shape #16, inline-table fields edited individually |
| `version-catalog/library-inline-version/` | shape #17 |
| `version-catalog/library-version-ref/` | shape #18, edit at `[versions]` table |
| `properties/simple/` | shape #19 |
| `refs/shared-variable-disagreement/` | two deps share `$kotlinVersion` with different winners → take min, warn |
| `refs/variable-not-found/` | unresolved ref → reported as error, no rewrite |
| `projects/multi-module/` | end-to-end: `settings.gradle.kts` + 3 modules + `libs.versions.toml` + `gradle.properties` |
| `projects/walk-skip-defaults/` | seeded `.gradle/`, `.idea/`, `node_modules/` are pruned; real build file is located |
| `projects/cooldown-stairstep/` | repo metadata mock with timestamps; assert pipeline picks highest non-blocked version |
| `projects/cooldown-allow-downgrade/` | with `--cooldown --allow-downgrade`, drops back to the highest cooldown-eligible older version when nothing `≥ current` survives cooldown |
| `projects/target-major-minor-patch/` | same project, three runs with different targets, three different outcomes |
| `projects/pre-track/` | dep on `1.3.0-beta3`; newer beta + corresponding stable both eligible without `--pre` |
| `projects/multi-config/root-only/` | single root `.gcu.json` governs all modules |
| `projects/multi-config/submodule-override/` | root `--target major`, submodule `--target patch`; module deps respect their own ceiling |
| `projects/multi-config/properties-at-root/` | root `gradle.properties` consumed by both root and submodule; only root config applies |
| `projects/multi-config/catalog-adjacent/` | `.gcu.json` next to `gradle/` governs `libs.versions.toml` |
| `config/invalid-unknown-key/` | unknown field in `.gcu.json` → exit `2` with a Zod error naming the file |
| `config/invalid-credentials-both-modes/` | `username` + `token` in same credentials entry → exit `2` |
| `version-catalog/real-project-mix/` | full multi-module Kotlin/Spring project: non-standard catalog path (`gradle/libs/versions.toml`) declared via `versionCatalogs` in `settings.gradle.kts`; 62 versions, 8 plugins, 76+ library refs; root `build.gradle.kts` with `force()` calls; 15 module `build.gradle.kts` files with `version = "1.0.0-SNAPSHOT"` (project versions, not updated); `dependencyResolutionManagement.repositories { mavenCentral() }` in settings; top-level `plugins { id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0" }` in settings |

## Verification

The tool is verified end-to-end by:

1. **`pnpm test`** — full Vitest suite passes (unit + fixture + integration). The multi-config hierarchy override is exercised end-to-end by the `projects/multi-config/*` fixtures.
2. **`pnpm test --coverage`** — coverage thresholds met for `version/`, `policy/`, `rewrite/`, `config/`, and each format locator.
3. **Manual sanity run** against this repo's own dev dependencies once it has any: `node dist/index.js .` then `node dist/index.js -u .` and inspect the diff is byte-clean (only version strings touched).
4. **Manual run** against a known multi-module Gradle project (e.g., a freshly cloned Spring sample) to confirm real-world parsing.
