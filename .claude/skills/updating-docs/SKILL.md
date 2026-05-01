---
name: updating-docs
description: Use when project documentation (README, docs/, CLAUDE.md) has drifted from the current code after recent changes — flags renamed, behavior changed, examples stale, tables outdated. Triggers on requests like "update the docs", "sync docs with the code", "docs are out of date", or after shipping a feature that changed user-visible behavior.
---

# Updating docs

## Overview

Refresh user and AI-facing docs (`README.md`, `docs/`, `CLAUDE.md`) so they match the current code. Edit narrowly: change only the bytes that are factually wrong now. Don't rewrite for style, don't invent content the code doesn't support, don't add or remove sections speculatively.

## When to use

- User says "update the docs", "sync docs", "docs are out of date", "docs need a pass".
- A feature just shipped that changed user-visible behavior (renamed flags, new defaults, removed commands, reordered pipeline).
- A doc claim contradicts the current code.

## When NOT to use

- Generating brand-new docs for an undocumented feature (different task — propose a structure first).
- Writing a CHANGELOG / release notes / version bump.
- Translating or i18n work.
- Stylistic rewrites with no factual drift.

## Inputs to read first (in order)

1. The change surface: `git log origin/main..HEAD` and `git diff origin/main...HEAD` (or whatever base the user names). This is what *might* have caused drift.
2. `README.md` at repo root.
3. Every `*.md` under `docs/` recursively, **excluding** `docs/superpowers/`, `docs/.vitepress/cache/`, `node_modules/`, build outputs, and any path the repo's `.gitignore` excludes.
4. `AGENTS.md` at repo root **only if it already exists**.
5. `CLAUDE.md` for ground-truth context — read it, don't edit it (it's project policy, not user docs).

## Drift checklist — what counts as needing an update

- CLI flags / commands / subcommands renamed or removed.
- Tables (flag tables, exit-code tables, feature matrices) where a row no longer matches code.
- Code snippets that import or call APIs that no longer exist or have different signatures.
- Stated defaults (timeouts, paths, limits) where the source-of-truth constant changed.
- Architecture / pipeline descriptions where steps were added, removed, or reordered.
- File-path or directory-layout references that moved.
- Install / quick-start commands that no longer work.

## Workflow

1. Build the change surface from `git log` + `git diff` against the base branch.
2. For each in-scope doc file, list the concrete *claims* it makes that touch changed code (flag names, function names, paths, defaults, exit codes, examples).
3. Verify each claim against current code. Mismatch → record a precise edit.
4. Apply edits with `Edit` (minimum diff). Use `Write` only if the file was just removed in code and the doc page must be deleted alongside — and even then, ask first.
5. Report back: which files changed, which claims were corrected, which drift you flagged but did NOT auto-fix (unverifiable numbers, screenshots, ambiguous prose).
6. Do not commit, push, or open a PR. The user runs their own commit flow.

## Hard rules

- Don't rewrite prose for tone or style. Only fix factual drift.
- Don't add sections describing features the code doesn't implement yet.
- Don't remove sections unless the feature they describe was actually removed from the code.
- Don't bump the package version, edit `CHANGELOG.md`, or write release notes.
- Don't invent benchmarks, screenshots, or numbers. If a metric is stale and you can't verify the new value, flag it for the user instead of guessing.
- Only edit files that already exist, unless the user explicitly asks for a new one.
- Don't touch `docs/superpowers/`, `LICENSE`, or generated/cache files.
- Be conservative when editing `CLAUDE.md` - do not add things unless there's already other related content in the file or the changes are critical for AI agents to be aware of.

## Edge cases

- VitePress / docusaurus config (`docs/.vitepress/config.*`) → only edit if nav entries reference renamed or removed pages.
- Doc claim is vague ("fast", "lightweight") with no concrete number → leave alone.
- A code change has multiple plausible doc interpretations → ask the user before editing.
- `git diff` is empty / base branch unclear → ask the user which range to use rather than guessing.

## Reporting back

End the turn with a short summary:

- Files edited (paths + one-line reason each).
- Claims you flagged as drifted but did NOT fix (and why — usually unverifiable).
- Any open questions for the user.

## Common mistakes

| Mistake | Fix |
|---|---|
| Rewrote unrelated prose for style | Edit narrowly; only touch bytes whose meaning is now factually wrong. |
| Bumped the package version in `README.md` | Out of scope. Release flow owns versions. |
| Invented a new benchmark number to replace a stale one | Flag the staleness in the report; don't guess values. |
| Touched `docs/superpowers/` | Out of scope — those are planning artifacts, not user docs. |
| Auto-committed or pushed changes | Stop after editing. The user commits. |
