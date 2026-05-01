# How it works

`gcu` is designed to be smart, safe, and completely invisible to your code formatting. Here is what happens when you run it:

- **It scans your workspace:** `gcu` automatically finds all dependencies and plugins across your entire project, including complex multi-module setups.
- **It follows variables:** If you use `gradle.properties` or Version Catalogs, `gcu` traces those variables back to their source. The upgrade always lands in the correct file.
- **It makes precise edits:** When applying an upgrade, `gcu` replaces *only the version number*. Every comment, space, and blank line is preserved exactly as you left it.

## Supported files

`gcu` recognizes all standard Gradle configuration formats:

| File | Supported |
|---|:---:|
| `build.gradle` | ✓ |
| `build.gradle.kts` | ✓ |
| `gradle.properties` | ✓ |
| `gradle/libs.versions.toml` | ✓ |
| `settings.gradle` / `settings.gradle.kts` | ✓ |

The tool is aware of how these files relate to each other. If a version is defined in one file but used in another, `gcu` automatically finds the original definition and applies the update there.

::: info Advanced Discovery
`settings.gradle(.kts)` is also parsed to discover additional version catalog paths, repository URLs, and plugin declarations.
:::

## The Policy Pipeline

`gcu` does not look at your local Gradle (`~/.gradle/caches/`) or Maven (`~/.m2/repository/`) caches. Instead, it fetches metadata directly from your configured Maven repositories.

Once the available versions for a dependency are fetched, they are passed through a deterministic filtering pipeline to select the single best upgrade candidate.

::: warning The "No Downgrade" Invariant
Before the pipeline even begins, **all candidate versions older than your currently installed version are discarded from consideration.** `gcu` only moves versions forward. The only exception is if you are explicitly [enforcing cooldowns via `--allow-downgrade`](./cooldown#enforcing-cooldowns-downgrading).
:::

Here is how the remaining candidates are filtered:

### 1. Track Rule
- **If current is Stable:** Only newer stable versions qualify.
- **If current is Prerelease:** Both newer prereleases and stable versions qualify.
- *(Override: `--pre` forces all prereleases to be considered.)*

### 2. Cooldown Window
- Any candidate published within the last `N` days is immediately dropped to protect against supply-chain attacks.
- *(Configured via: `--cooldown <days>`)*

### 3. Inclusion / Exclusion
- Candidates are dropped if their `group:artifact` matches an `--exclude` pattern, or if `--include` is used and they don't match.

### 4. Target Ceiling
- Candidates are dropped if they exceed the allowed upgrade "jump" relative to your current version.
- *(Configured via: `--target major|minor|patch`. Defaults to `major`.)*

### 5. Shape Eligibility
- Some complex version shapes (like snapshots or Maven version ranges) are considered "report only". `gcu` will inform you of the upgrade, but will drop the candidate from being automatically rewritten to avoid breaking complex build logic.

### 6. Pick Max
- Finally, out of all the candidates that survived the previous 5 stages, `gcu` selects the highest version according to Gradle's official version ordering rules.
