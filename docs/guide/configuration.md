# Configuration

`gcu` can be configured at two levels: **User** (for all your projects) and **Project-specific** (for individual projects or modules).

## Configuration Levels

### 1. User Configuration (`~/.gcu/config.json`)
This file stores your personal default settings that apply to every project you run `gcu` on. It is the only place where machine-local settings like cache paths are defined. You can also define any project-level options here to set your personal defaults.

### 2. Project Configuration (`.gcu.json`)
You can place a `.gcu.json` file in your project root to set defaults for your repository. You can also place them in subdirectories to override settings for specific modules.

---

## Project-Level Options (`.gcu.json`)

These options can be used in both project-level `.gcu.json` files and your user `~/.gcu/config.json`. **Every key is optional.**

| Key | Description | Default |
|---|---|---|
| `target` | Version ceiling for upgrades: `major`, `minor`, or `patch` | `major` |
| `pre` | When `true`, allows prerelease versions as upgrade candidates | `false` |
| `cooldown` | Number of days a new version must age before it is considered | `0` |
| `allowDowngrade` | Allows downgrading when the current version is blocked by `cooldown` | `false` |
| `include` | List of glob patterns to include (e.g. `["org.springframework.*"]`) | `[]` |
| `exclude` | List of glob patterns to exclude (e.g. `["com.example:legacy-*"]`) | `[]` |

## User-Only Options (`~/.gcu/config.json`)

These options **only** work in your user configuration file (`~/.gcu/config.json`). If you place them in a project-level `.gcu.json`, they will cause a validation error.

| Key | Description | Default |
|---|---|---|
| `cacheDir` | Custom directory for the local metadata cache | `~/.gcu/cache` |
| `noCache` | If `true`, bypasses the local cache and fetches fresh metadata | `false` |

---

## Example Files

### User: `~/.gcu/config.json`
Your user config can contain user-only options AND any project-level options you want as your personal defaults.

```json
{
  "cacheDir": "/tmp/gcu-cache",
  "noCache": false,
  "target": "minor",
  "cooldown": 3,
  "allowDowngrade": true
}
```

### Project: `.gcu.json`
Project configs can ONLY contain project-level options.

```json
{
  "target": "patch",
  "cooldown": 7,
  "include": ["com.mycompany.*"]
}
```

## Multi-Module Overrides

In large, multi-module projects, you might want different rules for different parts of your application. `gcu` handles this gracefully using a simple rule: **the closest config wins**.

**The Scenario:**
Imagine your main project is fine with standard `major` upgrades, but your `legacy-api/` module is fragile and should only ever receive `patch` upgrades.

**The Solution:**
1. Put a `.gcu.json` in your project root with `"target": "major"`.
2. Put another `.gcu.json` inside the `legacy-api/` folder with `"target": "patch"`.

```text
my-project/
├── .gcu.json                  ← Root sets "target": "major"
├── build.gradle.kts           (Uses major)
│
├── modern-app/
│   └── build.gradle.kts       (Uses major, inherited from root)
│
└── legacy-api/
    ├── .gcu.json              ← Override sets "target": "patch"
    └── build.gradle.kts       (Uses patch, because it is closer)
```

When `gcu` checks a build file, it looks for a `.gcu.json` in the same folder. If it doesn't find one, it walks up the folder tree until it does. 

Because configs are merged along the way, your `legacy-api/` folder will still inherit things like the `cooldown` setting from the root; it just overrides the `target`.

*(Note: The version catalog at `gradle/libs.versions.toml` is controlled by the root config, because it belongs to the whole project, not just the `gradle/` folder.)*
