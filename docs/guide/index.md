# Getting Started

`gradle-check-updates` (`gcu`) is a command-line tool for upgrading Gradle dependencies. 

It is designed to be the Gradle equivalent of `npm-check-updates`. It scans your project for outdated dependencies and plugins, fetches the latest versions from Maven repositories, and applies updates directly to your build files—all while preserving your formatting and comments exactly.

## Installation

Install globally to use `gradle-check-updates` (or the `gcu` shorthand):

```sh
npm install -g gradle-check-updates
```

Or run with `npx` without installing:

```sh
npx gradle-check-updates
```

## Quick Start

Navigate to your Gradle project directory and run the tool.

### Preview available upgrades

Running `gcu` without flags will print a report of what *can* be upgraded, but will not modify your files.

```sh
gcu
```

![Dry-run](./images/dry_run.png)

### Apply upgrades

Use the `-u` or `--upgrade` flag to write changes to disk.

```sh
gcu -u
```

![Update run](./images/update_run.png)

### Interactive mode

Use the `-i` or `--interactive` flag to launch a TUI picker to choose exactly which dependencies to upgrade.

```sh
gcu -i
```

![Interactive run](./images/interactive_run.png)

## What's Next?

- Explore the [Architecture and Design](./BOOTSTRAP.md) to understand how `gcu` achieves byte-precise editing.
- Check out the [README on GitHub](https://github.com/SecretX33/gradle-check-updates) for full configuration options and flags.
