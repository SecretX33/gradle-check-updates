# Configuration

You can configure `gcu` by creating a `.gcu.json` file in your project.

You can place this file in the root of your project to set defaults for everything, or you can place it inside specific folders to create special rules just for that section of your app. 

*(If you want a personal default for **all** projects on your computer, you can also create a global config at `~/.gcu/config.json`.)*

## Example `.gcu.json`

**Every key in this file is completely optional.** You only need to define the settings you actually want to change. If you leave a setting out, `gcu` will just fall back to its standard behavior.

```json
{
  "target": "minor",
  "pre": false,
  "cooldown": 3,
  "include": ["org.springframework.*"],
  "exclude": ["com.example:legacy-*"]
}
```

| Key | Description |
|---|---|
| `target` | Version ceiling for upgrades: `major`, `minor`, or `patch` |
| `pre` | When `true`, allows prerelease versions as upgrade candidates |
| `cooldown` | Number of days a new version must age before it is considered as a candidate |
| `include` | Glob patterns - only matching `group:artifact` entries are upgraded |
| `exclude` | Glob patterns - matching `group:artifact` entries are skipped |

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

Because configs are merged along the way, your `legacy-api/` folder will still inherit things like your global `--cooldown` setting from the root; it just overrides the `target`.

*(Note: The version catalog at `gradle/libs.versions.toml` is controlled by the root config, because it belongs to the whole project, not just the `gradle/` folder.)*
