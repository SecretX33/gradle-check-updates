# Contributing to gradle-check-updates

First off, thank you for considering contributing to `gradle-check-updates`! It's people like you that make the open-source community such an amazing place.

## How to contribute

### Reporting Bugs
- Always check if the bug has already been reported in the [Issues](https://github.com/SecretX33/gradle-check-updates/issues) section.
- If not, create a new issue. Include as much detail as possible:
  - Your Gradle version.
  - The build file format (Kotlin/Groovy/Version Catalog).
  - A snippet of the code that caused the issue.
  - The expected behavior vs. actual behavior.

### Feature Requests
- Check if the feature has already been requested.
- If not, open an issue to discuss it first.

### Pull Requests
1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests!
3. Ensure the test suite passes (`pnpm test`).
4. Reformat code to ensure code lint pass (`pnpm format:write`).
5. If you've changed APIs, update the documentation (hint: use [`/update-docs`](.claude/skills/updating-docs/SKILL.md) AI skill to help you).
6. Issue that pull request!

## Development Setup

```sh
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run in dev mode (watches files and rebuilds)
pnpm dev

# Run the built CLI against a local project
node dist/index.js /path/to/your/gradle/project
```

## Cardinal Rule

**Preserve the user's file exactly.** `gcu` is built on the promise that it only touches the version bytes. Any changes to the rewriter or locators must be backed by byte-for-byte regression tests.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.
