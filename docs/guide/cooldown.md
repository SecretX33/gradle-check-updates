# Cooldown

The cooldown feature requires a version to have been published at least N days before it is considered a candidate for upgrade.

```sh
gcu --cooldown 7   # ignore versions published in the last 7 days
gcu -c 7           # shorthand
```

## Why this matters for security

Newly published packages are a common vector for supply-chain attacks. An attacker who compromises a package and publishes a malicious version relies on fast adoption. Setting a cooldown (e.g. 7 days) gives the community time to detect and report a compromised release before it reaches your project.

### Example

Suppose these versions exist for a dependency:

```
1.2.0   published  3 days ago   ← latest
1.1.0   published 10 days ago
1.0.0   published 14 days ago
```

| Command | Selected version | Reason |
|---------|-----------------|--------|
| `gcu` | `1.2.0` | No cooldown - latest wins |
| `gcu --cooldown 7` | `1.1.0` | `1.2.0` is only 3 days old; `1.1.0` is the highest that passes |

## Enforcing Cooldowns (Downgrading)

By default, `gcu` will **never downgrade** a dependency. If you are currently on version `1.2.0`, the tool will only look for versions `> 1.2.0`.

However, what happens if you introduce `gcu --cooldown 7` to a project that *already* has brand new, unsoaked dependencies?

Because of the "never downgrade" rule, `gcu` would normally leave those too-new dependencies untouched. To solve this, you can use the `--allow-downgrade` flag.

When you pass `--allow-downgrade`, `gcu` checks if your *current* installed version violates the cooldown window. If it does, the tool will roll the dependency backward to the highest version that actually passes your cooldown policy.

This is primarily useful when **migrating an existing project** to use strict cooldowns, allowing you to automatically roll back any dependencies that are currently too new, ensuring your entire project adheres to your security policy.

*(Note: Using `--allow-downgrade` without `--cooldown` is a usage error and will exit with code `2`.)*
