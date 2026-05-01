# Repository Authentication

Private Maven repositories that require credentials are configured in `~/.gcu/credentials.json`. `gcu` matches each repository URL using longest-prefix matching, so a single entry covers all artifacts hosted under that base URL.

**File location:** `~/.gcu/credentials.json`

Supports both **token-based auth** or **username/password auth**.

```json
{
  "repositories": [
    {
      "url": "https://nexus.example.com/",
      "token": "nexus-token"
    },
    {
      "url": "https://artifactory.example.com/",
      "username": "alice",
      "password": "secret123"
    }
  ]
}
```

## Environment variable substitution

Any credential value that starts with `$` is resolved from the environment at runtime, keeping secrets out of the file:

```json
{
  "repositories": [
    {
      "url": "https://nexus.example.com/",
      "token": "$NEXUS_TOKEN"
    },
    {
      "url": "https://artifactory.example.com/",
      "username": "$ARTIFACTORY_USER",
      "password": "$ARTIFACTORY_PASS"
    }
  ]
}
```

With the above file, `gcu` reads `process.env.NEXUS_TOKEN`, `process.env.ARTIFACTORY_USER`, and `process.env.ARTIFACTORY_PASS` at startup. If a referenced variable is not set, `gcu` exits with an error naming the missing variable.

::: warning
Each entry must use either `token` or `username`+`password` - mixing both auth modes in the same entry is a validation error.
:::
