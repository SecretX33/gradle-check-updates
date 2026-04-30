# gradle-check-updates (`gcu`)

[![npm version](https://img.shields.io/npm/v/gradle-check-updates.svg)](https://www.npmjs.com/package/gradle-check-updates)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/SecretX33/gradle-check-updates/actions/workflows/ci.yml/badge.svg)](https://github.com/SecretX33/gradle-check-updates/actions/workflows/ci.yml)

**The missing dependency updater for Gradle.** Fast, byte-precise, and security-focused CLI to upgrade dependencies across your entire Gradle project.

gradle-check-updates (`gcu`) scans your project for outdated dependencies and plugins, fetches the latest versions from Maven repositories, and applies updates directly to your build files—all while preserving your formatting and comments exactly.

👉 **[View Full Documentation & Guide](https://secretx33.github.io/gradle-check-updates/)**

## Features

- ⚡ **Lightning Fast:** Queries Maven repositories directly, bypassing slow Gradle daemon overhead.
- 🎯 **Byte-Precise:** Only the version string changes. No reformatting, no comment loss, no indentation mess.
- 📦 **Comprehensive Support:** Works with Kotlin DSL, Groovy DSL, Version Catalogs, and `gradle.properties`.
- 🏗️ **Multi-Module Ready:** Handles complex project structures and shared variables in one pass.
- 🛡️ **Security-First:** Built-in **cooldown window** to protect against supply-chain attacks.
- 🛠️ **Configurable:** Fine-grained control with `--target`, `--include`/`--exclude` filters, and per-directory configuration.
- 🖥️ **Interactive Mode:** A beautiful TUI to selectively apply upgrades.

## Why gcu?

| Feature | `gcu` | `gradle-versions-plugin` | IntelliJ / IDE |
|---|:---:|:---:|:---:|
| **Speed** | ⚡ Instant | 🐢 Slow (runs via Gradle) | Variable |
| **Write support** | ✅ Yes (`-u`) | ❌ No (Report only) | ✅ Manual |
| **Byte-precise** | ✅ Yes | N/A | ❌ Often reformats |
| **Multi-module** | ✅ Native | ✅ Yes | ❌ Per-file |
| **CI Friendly** | ✅ Yes | ✅ Yes | ❌ No |
| **Cooldown Window** | ✅ Yes | ❌ No | ❌ No |

`gcu` is designed to be the Gradle equivalent of [`npm-check-updates`](https://github.com/raineorshine/npm-check-updates).

## Quick Start

### Install
```sh
npm install -g gradle-check-updates
```

### Preview available upgrades
```sh
gcu
```

### Apply upgrades
```sh
gcu -u
```

### Interactive mode
```sh
gcu -i
```

---

For full documentation, command-line options, and advanced configuration, visit **[https://secretx33.github.io/gradle-check-updates/](https://secretx33.github.io/gradle-check-updates/)**.

## License

MIT
