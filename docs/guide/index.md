# Getting Started

`gradle-check-updates` (or `gcu`) is a command-line tool designed to be the Gradle equivalent of `npm-check-updates`. It safely and automatically upgrades your dependencies to their latest versions.

## Installation

Install globally via npm to make the `gcu` command available everywhere:

```sh
npm install -g gradle-check-updates
```

Alternatively, you can run it on-the-fly using `npx`:

```sh
npx gradle-check-updates
```

## Quick Start

Open your terminal, navigate to your Gradle project directory, and run one of the following commands:

### 1. Preview upgrades (Dry Run)

Run `gcu` by itself. It will scan your project and print a report of available upgrades, but **it will not modify any files**.

```sh
gcu
```

![Dry-run](../images/dry_run.png)

### 2. Apply upgrades

Add the `-u` (or `--upgrade`) flag to actually write the changes to your build files.

```sh
gcu -u
```

![Update run](../images/update_run.png)

### 3. Choose upgrades interactively

Add the `-i` (or `--interactive`) flag to launch a visual picker, allowing you to select exactly which dependencies you want to upgrade.

```sh
gcu -i
```

![Interactive run](../images/interactive_run.png)

## What's Next?

Learn more about how to use `gcu` effectively:

- [**How it Works**](./how-it-works) - Understand the upgrade policy and supported files.
- [**Command Line Options**](./options) - Full list of flags and exit codes.
- [**Cooldown & Security**](./cooldown) - Using the cooldown window to protect your supply chain.
- [**Configuration**](./configuration) - Layered configuration with `.gcu.json`.
- [**Repository Auth**](./authentication) - Authenticating with private Maven repositories.
