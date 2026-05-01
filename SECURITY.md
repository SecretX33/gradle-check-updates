# Security Policy

## Supported Versions

Only the latest version of `gradle-check-updates` is supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| v0.x    | ✅ Yes             |

## Reporting a Vulnerability

If you discover a security vulnerability within `gradle-check-updates`, please send an e-mail to **SecretX33** via `notyetmidnight@gmail.com`. All security vulnerabilities will be promptly addressed.

## Security Features in gcu

`gcu` is built with supply-chain security in mind. The core feature for this is the **Cooldown Window** (`--cooldown`).

### Cooldown Window
The cooldown feature requires a version to have been published at least N days before it is considered a candidate for upgrade. This gives the community time to detect and report compromised releases before they reach your project.

We recommend a default cooldown of at least **7 days** for production projects.
