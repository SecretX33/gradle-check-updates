# gradle-check-updates (`gcu`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `gcu`, a standalone CLI that scans Gradle projects, finds available dependency upgrades from Maven repositories, and rewrites version literals precisely in place.

**Architecture:** Pipeline of pure-ish stages — `discover → locate → resolve refs → discover repos → fetch metadata → policy → report → rewrite`. The locator is the only format-specific stage; everything downstream consumes a uniform `Occurrence` type. The rewriter is a single function that splices new bytes into specific byte ranges, never reformatting. Hand-written tokenizers for Groovy DSL, Kotlin DSL, and TOML — no upstream parsers.

**Tech Stack:** TypeScript (ESM), pnpm, Vitest, `tsdown` build, `cac`, `kleur`, `@inquirer/prompts`, `picomatch`, `fast-xml-parser`, `undici`, `zod`.

**Spec source of truth:** `docs/BOOTSTRAP.md`. Every shape, fixture, exit code, and behavior listed there is binding. This plan sequences the work; the spec defines correctness.

**Cardinal rule reminder:** The rewriter MUST NOT reorder, reformat, change indentation, or lose comments. Only version-literal bytes change. Tests assert byte-for-byte equality on unchanged regions, including CRLF/LF, tabs/spaces, trailing newlines, and adjacent comments.

**Phases:**

1. Bootstrap & shared types
2. Version core (parsing, ordering, shape detection)
3. Rewriter (precise editor)
4. Format locators (Groovy DSL, Kotlin DSL, version catalog, properties)
5. Variable reference resolution
6. Discovery walker
7. Repo client (HTTP, cache, auth)
8. Config (Zod schemas, multi-config resolver, credentials)
9. Policy pipeline
10. Report renderers (table, JSON, interactive)
11. CLI orchestration
12. End-to-end integration & polish

---

## Phase 1 — Bootstrap & shared types

### Task 1.1: Install runtime dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add runtime deps**

Run:
```bash
pnpm add cac kleur @inquirer/prompts picomatch fast-xml-parser undici zod
pnpm add -D @types/picomatch
```

- [ ] **Step 2: Verify install**

Run: `pnpm install`
Expected: lockfile resolves, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add runtime deps for cli, http, parsing, validation"
```

### Task 1.2: Add Vitest config and project entrypoint

**Files:**
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/cli/index.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/cli/index.ts"],
    },
  },
});
```

- [ ] **Step 2: Create stub `src/index.ts`**

```ts
export {};
```

- [ ] **Step 3: Create stub `src/cli/index.ts`**

```ts
#!/usr/bin/env node
console.log("gcu — not yet implemented");
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck passes; vitest reports "no tests found" (exits 0 with `passWithNoTests` not set is fine — we'll add tests next).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts src/
git commit -m "Bootstrap entrypoint and vitest config"
```

### Task 1.3: Define shared `types.ts`

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create the canonical types**

Mirror BOOTSTRAP.md §"The `Occurrence` type — the contract" exactly.

```ts
// src/types.ts

export type FileType = "groovy-dsl" | "kotlin-dsl" | "version-catalog" | "properties";

export type VersionShape =
  | "exact"
  | "prerelease"
  | "snapshot"
  | "prefix"
  | "latestQualifier"
  | "strictlyShorthand"
  | "strictlyPreferShort"
  | "mavenRange"
  | "richRequire"
  | "richStrictly"
  | "richPrefer"
  | "richReject";

export type Occurrence = {
  group: string;
  artifact: string;
  file: string;
  byteStart: number;
  byteEnd: number;
  fileType: FileType;
  currentRaw: string;
  shape: VersionShape;
  dependencyKey: string;
  via?: string[];
};

export type Edit = {
  byteStart: number;
  byteEnd: number;
  replacement: string;
};

export type Direction = "up" | "down";

export type DecisionStatus =
  | "upgrade"
  | "no-change"
  | "held-by-target"
  | "cooldown-blocked"
  | "report-only"
  | "conflict";

export type Decision = {
  occurrence: Occurrence;
  status: DecisionStatus;
  /** Selected version literal that will be written, when status === "upgrade". */
  newVersion?: string;
  /** Latest available version on the server (post never-downgrade filter), regardless of status. */
  latestAvailable?: string;
  direction?: Direction;
  reason?: string;
};
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Define Occurrence, Edit, Decision contracts"
```

---

## Phase 2 — Version core

The version module is pure and forms the foundation everything else depends on.

### Task 2.1: Tokenize a Gradle version string

**Files:**
- Create: `src/version/tokenize.ts`
- Create: `src/version/tokenize.test.ts`

Per Gradle docs, a version is split on `.`, `-`, `_`, `+`. Numeric and non-numeric runs are separate parts. Specials: `dev < alpha < a < beta < b < milestone < m < rc < cr < snapshot < final < ga < release < sp` (case-insensitive). See https://docs.gradle.org/current/userguide/single_versions.html.

- [ ] **Step 1: Write failing tests**

```ts
// src/version/tokenize.test.ts
import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenize";

describe("tokenize", () => {
  it("splits numeric and qualifier parts", () => {
    expect(tokenize("1.2.3")).toEqual([{ kind: "num", value: 1 }, { kind: "num", value: 2 }, { kind: "num", value: 3 }]);
  });
  it("treats `-` `.` `_` `+` as separators", () => {
    expect(tokenize("1-2.3_4+5").map(t => t.value)).toEqual([1, 2, 3, 4, 5]);
  });
  it("separates digits from letters at boundaries", () => {
    expect(tokenize("1a2").map(t => t.value)).toEqual([1, "a", 2]);
  });
  it("preserves case in qualifier raw form but normalizes to lowercase value", () => {
    const t = tokenize("1.0-RC1");
    expect(t[2]).toEqual({ kind: "qual", value: "rc" });
    expect(t[3]).toEqual({ kind: "num", value: 1 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/version/tokenize`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/version/tokenize.ts
export type Token =
  | { kind: "num"; value: number }
  | { kind: "qual"; value: string };

const SEP = /[.\-_+]/;

export function tokenize(version: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < version.length) {
    const ch = version[i]!;
    if (SEP.test(ch)) { i++; continue; }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < version.length && /\d/.test(version[j]!)) j++;
      out.push({ kind: "num", value: Number(version.slice(i, j)) });
      i = j;
    } else {
      let j = i;
      while (j < version.length && !/\d/.test(version[j]!) && !SEP.test(version[j]!)) j++;
      out.push({ kind: "qual", value: version.slice(i, j).toLowerCase() });
      i = j;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/version/tokenize`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/version/
git commit -m "Add Gradle version tokenizer"
```

### Task 2.2: Compare versions per Gradle ordering

**Files:**
- Create: `src/version/compare.ts`
- Create: `src/version/compare.test.ts`

Reference: https://docs.gradle.org/current/userguide/dependency_versions.html#sec:single-version-declarations

Qualifier ranking (lower = older): `dev`, `alpha`/`a`, `beta`/`b`, `milestone`/`m`, `rc`/`cr`, `snapshot`, `""` (release), `final`, `ga`, `release`, `sp`. Unknown qualifiers compare lexicographically and rank below numeric. Numeric parts always outrank string parts of the same index. Missing trailing parts are treated as `0` for numeric, `""` for qual.

- [ ] **Step 1: Write failing tests**

```ts
// src/version/compare.test.ts
import { describe, it, expect } from "vitest";
import { compareVersions } from "./compare";

const lt = (a: string, b: string) => expect(compareVersions(a, b)).toBeLessThan(0);
const eq = (a: string, b: string) => expect(compareVersions(a, b)).toBe(0);
const gt = (a: string, b: string) => expect(compareVersions(a, b)).toBeGreaterThan(0);

describe("compareVersions", () => {
  it("orders patch numerically", () => { lt("1.2.3", "1.2.4"); gt("1.10.0", "1.9.0"); });
  it("orders minor and major", () => { lt("1.9.9", "2.0.0"); });
  it("treats missing trailing zero as zero", () => { eq("1.0", "1.0.0"); });
  it("ranks dev < alpha < beta < milestone < rc < snapshot < final/release", () => {
    lt("1.0-dev", "1.0-alpha");
    lt("1.0-alpha", "1.0-beta");
    lt("1.0-beta", "1.0-milestone");
    lt("1.0-milestone", "1.0-rc1");
    lt("1.0-rc1", "1.0-SNAPSHOT");
    lt("1.0-SNAPSHOT", "1.0");
    lt("1.0", "1.0-final");
    lt("1.0-final", "1.0-ga");
    lt("1.0-ga", "1.0-release");
    lt("1.0-release", "1.0-sp1");
  });
  it("treats `a`==`alpha`, `b`==`beta`, `m`==`milestone`, `cr`==`rc`", () => {
    eq("1.0-a1", "1.0-alpha1");
    eq("1.0-b2", "1.0-beta2");
    eq("1.0-m3", "1.0-milestone3");
    eq("1.0-cr4", "1.0-rc4");
  });
  it("orders by sequential numeric within same qualifier", () => { lt("1.0-rc1", "1.0-rc2"); });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/version/compare`

- [ ] **Step 3: Implement**

```ts
// src/version/compare.ts
import { tokenize, type Token } from "./tokenize";

const QUAL_RANK: Record<string, number> = {
  dev: 0,
  alpha: 1, a: 1,
  beta: 2, b: 2,
  milestone: 3, m: 3,
  rc: 4, cr: 4,
  snapshot: 5,
  // unqualified release sits between snapshot and final per Gradle: ""=6
  "": 6,
  final: 7,
  ga: 8,
  release: 9,
  sp: 10,
};

function rankQual(q: string): number {
  return QUAL_RANK[q] ?? -1; // unknown qualifiers rank below dev
}

function compareTokens(a: Token | undefined, b: Token | undefined): number {
  // Treat missing as numeric 0 for "1.0" vs "1.0.0" equivalence
  const aa = a ?? { kind: "num", value: 0 } as const;
  const bb = b ?? { kind: "num", value: 0 } as const;
  if (aa.kind === "num" && bb.kind === "num") return aa.value - bb.value;
  if (aa.kind === "qual" && bb.kind === "qual") {
    const ra = rankQual(aa.value);
    const rb = rankQual(bb.value);
    if (ra !== rb) return ra - rb;
    // both unknown → lexicographic
    return aa.value < bb.value ? -1 : aa.value > bb.value ? 1 : 0;
  }
  // num vs qual: per Gradle, numeric parts outrank string parts. EXCEPT when the
  // qual is an unqualified release marker treated as missing — handled by zero-fill above.
  return aa.kind === "num" ? 1 : -1;
}

export function compareVersions(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const c = compareTokens(ta[i], tb[i]);
    if (c !== 0) return c;
  }
  return 0;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/version/compare`
Expected: PASS. If "1.0" vs "1.0-final" fails, revisit the missing-token rule — `1.0` zero-fills to `1.0.0` which is less than `1.0-final` only if `final` ranks above unqualified. Adjust `compareTokens` so missing-on-the-shorter-side compares the present qualifier against rank 6 (unqualified release), not against numeric 0. (Add a follow-up test if you change the rule.)

Refinement (apply if the "release < final" assertion fails):

```ts
function compareTokens(a: Token | undefined, b: Token | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) {
    // shorter side: treat as unqualified release (rank 6) when comparing against a qual,
    // and as 0 when comparing against a num
    if (b!.kind === "qual") return 6 - rankQual(b!.value);
    return -b!.value;
  }
  if (b === undefined) {
    if (a.kind === "qual") return rankQual(a.value) - 6;
    return a.value;
  }
  if (a.kind === "num" && b.kind === "num") return a.value - b.value;
  if (a.kind === "qual" && b.kind === "qual") {
    const ra = rankQual(a.value), rb = rankQual(b.value);
    if (ra !== rb) return ra - rb;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  return a.kind === "num" ? 1 : -1;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/version/
git commit -m "Add Gradle version comparator"
```

### Task 2.3: Detect version shape

**Files:**
- Create: `src/version/shape.ts`
- Create: `src/version/shape.test.ts`

Detects the `VersionShape` from a raw literal (without rich-block context — rich variants are assigned by locators that see the surrounding `version { ... }` or `[versions]` rich-table call). Used by locators for shapes 1–8.

- [ ] **Step 1: Write failing tests**

```ts
// src/version/shape.test.ts
import { describe, it, expect } from "vitest";
import { detectShape, isStable, isPrerelease } from "./shape";

describe("detectShape", () => {
  const cases: [string, ReturnType<typeof detectShape>][] = [
    ["1.2.3", "exact"],
    ["1.0", "exact"],
    ["1.3.0-beta3", "prerelease"],
    ["1.0-rc1", "prerelease"],
    ["1.0-M2", "prerelease"],
    ["1.0-SNAPSHOT", "snapshot"],
    ["1.+", "prefix"],
    ["1.3.+", "prefix"],
    ["+", "prefix"],
    ["latest.release", "latestQualifier"],
    ["latest.integration", "latestQualifier"],
    ["1.7.15!!", "strictlyShorthand"],
    ["[1.7,1.8)!!1.7.25", "strictlyPreferShort"],
    ["[1.0, 2.0)", "mavenRange"],
    ["(1.2, 1.5]", "mavenRange"],
    ["[1.0,)", "mavenRange"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => expect(detectShape(input)).toBe(expected));
  }
});

describe("isStable / isPrerelease", () => {
  it("classifies stable", () => { expect(isStable("1.2.3")).toBe(true); expect(isStable("1.0-final")).toBe(true); });
  it("classifies prerelease", () => { expect(isPrerelease("1.0-rc1")).toBe(true); expect(isPrerelease("1.0-M2")).toBe(true); });
  it("snapshot is not stable", () => { expect(isStable("1.0-SNAPSHOT")).toBe(false); });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/version/shape.ts
import { tokenize } from "./tokenize";

export type SimpleShape =
  | "exact" | "prerelease" | "snapshot" | "prefix"
  | "latestQualifier" | "strictlyShorthand" | "strictlyPreferShort" | "mavenRange";

const PRE_QUALS = new Set(["dev", "alpha", "a", "beta", "b", "milestone", "m", "rc", "cr"]);

export function isSnapshot(v: string): boolean {
  return /-SNAPSHOT$/i.test(v);
}

export function isPrerelease(v: string): boolean {
  if (isSnapshot(v)) return false;
  for (const t of tokenize(v)) {
    if (t.kind === "qual" && PRE_QUALS.has(t.value)) return true;
  }
  return false;
}

export function isStable(v: string): boolean {
  return !isSnapshot(v) && !isPrerelease(v);
}

export function detectShape(raw: string): SimpleShape {
  const v = raw.trim();
  if (v === "+" || /\.\+$/.test(v)) return "prefix";
  if (/^latest\./i.test(v)) return "latestQualifier";
  if (isSnapshot(v)) return "snapshot";
  // Strictly+prefer short:  [a,b)!!c   or   (a,b]!!c
  if (/^[\[(].*[\])]!!.+$/.test(v)) return "strictlyPreferShort";
  if (/!!$/.test(v)) return "strictlyShorthand";
  if (/^[\[(].*[\])]$/.test(v)) return "mavenRange";
  if (isPrerelease(v)) return "prerelease";
  return "exact";
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/version/shape`

- [ ] **Step 5: Commit**

```bash
git add src/version/
git commit -m "Add version shape detection"
```

### Task 2.4: Effective-version helpers

**Files:**
- Create: `src/version/effective.ts`
- Create: `src/version/effective.test.ts`

Per BOOTSTRAP.md §"Current effective version (what `--target` measures against)". Produces a single comparable version from any shape, given the candidate list.

- [ ] **Step 1: Write failing tests**

```ts
// src/version/effective.test.ts
import { describe, it, expect } from "vitest";
import { effectiveVersion } from "./effective";

describe("effectiveVersion", () => {
  it("exact returns literal", () => {
    expect(effectiveVersion({ shape: "exact", raw: "1.2.3" }, [])).toBe("1.2.3");
  });
  it("prefix returns highest matching prefix", () => {
    expect(effectiveVersion({ shape: "prefix", raw: "1.3.+" }, ["1.2.0", "1.3.5", "1.3.7", "1.4.0"])).toBe("1.3.7");
  });
  it("strictlyShorthand strips !!", () => {
    expect(effectiveVersion({ shape: "strictlyShorthand", raw: "1.7.15!!" }, [])).toBe("1.7.15");
  });
  it("strictlyPreferShort returns prefer half", () => {
    expect(effectiveVersion({ shape: "strictlyPreferShort", raw: "[1.7,1.8)!!1.7.25" }, [])).toBe("1.7.25");
  });
  it("mavenRange returns highest in range", () => {
    expect(effectiveVersion({ shape: "mavenRange", raw: "[1.0,2.0)" }, ["1.0", "1.5", "2.0", "2.1"])).toBe("1.5");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/version/effective.ts
import { compareVersions } from "./compare";

export function matchesPrefix(prefix: string, candidate: string): boolean {
  if (prefix === "+") return true;
  const stem = prefix.slice(0, -2); // strip ".+"
  return candidate === stem || candidate.startsWith(stem + ".");
}

export function inMavenRange(range: string, v: string): boolean {
  // [a,b], (a,b), [a,b), (a,b], [a,), (,b], etc.
  const m = /^([\[(])\s*([^,]*)\s*,\s*([^,]*)\s*([\])])$/.exec(range);
  if (!m) return false;
  const [, lb, lo, hi, ub] = m;
  if (lo) {
    const c = compareVersions(v, lo);
    if (lb === "[" ? c < 0 : c <= 0) return false;
  }
  if (hi) {
    const c = compareVersions(v, hi);
    if (ub === "]" ? c > 0 : c >= 0) return false;
  }
  return true;
}

export function effectiveVersion(
  spec: { shape: string; raw: string },
  candidates: string[],
): string {
  const { shape, raw } = spec;
  switch (shape) {
    case "exact":
    case "prerelease":
    case "snapshot":
      return raw;
    case "strictlyShorthand":
      return raw.replace(/!!$/, "");
    case "strictlyPreferShort": {
      const idx = raw.indexOf("!!");
      return raw.slice(idx + 2);
    }
    case "prefix": {
      const matching = candidates.filter(c => matchesPrefix(raw, c)).sort(compareVersions);
      return matching.at(-1) ?? raw;
    }
    case "mavenRange": {
      const matching = candidates.filter(c => inMavenRange(raw, c)).sort(compareVersions);
      return matching.at(-1) ?? raw;
    }
    case "latestQualifier":
      return candidates.slice().sort(compareVersions).at(-1) ?? raw;
    default:
      return raw;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/version/effective`

- [ ] **Step 5: Commit**

```bash
git add src/version/
git commit -m "Add effective-version helpers"
```

### Task 2.5: Bump direction (major/minor/patch)

**Files:**
- Create: `src/version/diff.ts`
- Create: `src/version/diff.test.ts`

For `--target` enforcement and report annotation.

- [ ] **Step 1: Write failing tests**

```ts
// src/version/diff.test.ts
import { describe, it, expect } from "vitest";
import { bumpKind } from "./diff";

describe("bumpKind", () => {
  it("patch", () => expect(bumpKind("1.2.3", "1.2.4")).toBe("patch"));
  it("minor", () => expect(bumpKind("1.2.3", "1.3.0")).toBe("minor"));
  it("major", () => expect(bumpKind("1.2.3", "2.0.0")).toBe("major"));
  it("prerelease bump within same x.y.z is patch-equivalent", () => {
    expect(bumpKind("1.0.0-rc1", "1.0.0-rc2")).toBe("patch");
  });
  it("downgrade still classified by distance", () => {
    expect(bumpKind("2.0.0", "1.9.0")).toBe("major");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/version/diff.ts
import { tokenize } from "./tokenize";

export type BumpKind = "major" | "minor" | "patch";

function nums(v: string): number[] {
  const out: number[] = [];
  for (const t of tokenize(v)) {
    if (t.kind === "num") out.push(t.value);
    else break;
  }
  while (out.length < 3) out.push(0);
  return out;
}

export function bumpKind(from: string, to: string): BumpKind {
  const [aMa, aMi, aPa] = nums(from);
  const [bMa, bMi, bPa] = nums(to);
  if (aMa !== bMa) return "major";
  if (aMi !== bMi) return "minor";
  if (aPa !== bPa) return "patch";
  return "patch";
}

export function withinTarget(from: string, to: string, ceiling: BumpKind): boolean {
  const k = bumpKind(from, to);
  if (ceiling === "major") return true;
  if (ceiling === "minor") return k !== "major";
  return k === "patch";
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/version/
git commit -m "Add bump-kind classification and target ceiling"
```

---

## Phase 3 — Rewriter

### Task 3.1: Byte-precise edit applier

**Files:**
- Create: `src/rewrite/apply.ts`
- Create: `src/rewrite/apply.test.ts`

Single function. Sort edits descending by `byteStart`, splice into the buffer, error on overlapping ranges.

- [ ] **Step 1: Write failing tests**

```ts
// src/rewrite/apply.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "./apply";

const buf = (s: string) => Buffer.from(s, "utf8");
const str = (b: Buffer) => b.toString("utf8");

describe("applyEdits", () => {
  it("returns the original when no edits", () => {
    expect(str(applyEdits(buf("hello"), []))).toBe("hello");
  });
  it("replaces a single range", () => {
    const out = applyEdits(buf('version = "1.0.0"'), [
      { byteStart: 12, byteEnd: 17, replacement: "2.0.0" },
    ]);
    expect(str(out)).toBe('version = "2.0.0"');
  });
  it("applies multiple edits without shifting earlier offsets", () => {
    const input = "AAA-BBB-CCC";
    const out = applyEdits(buf(input), [
      { byteStart: 0, byteEnd: 3, replacement: "x" },
      { byteStart: 4, byteEnd: 7, replacement: "yy" },
      { byteStart: 8, byteEnd: 11, replacement: "zzz" },
    ]);
    expect(str(out)).toBe("x-yy-zzz");
  });
  it("preserves CRLF, tabs, surrounding bytes byte-for-byte", () => {
    const original = "a\r\n\tb = \"1.0\"\r\n";
    const out = applyEdits(buf(original), [
      { byteStart: 9, byteEnd: 12, replacement: "2.0" },
    ]);
    expect(str(out)).toBe("a\r\n\tb = \"2.0\"\r\n");
  });
  it("rejects overlapping edits", () => {
    expect(() =>
      applyEdits(buf("hello"), [
        { byteStart: 0, byteEnd: 3, replacement: "x" },
        { byteStart: 2, byteEnd: 4, replacement: "y" },
      ]),
    ).toThrow(/overlap/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/rewrite/apply.ts
import type { Edit } from "../types";

export function applyEdits(original: Buffer, edits: Edit[]): Buffer {
  if (edits.length === 0) return Buffer.from(original);
  const sorted = [...edits].sort((a, b) => a.byteStart - b.byteStart);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.byteStart < sorted[i - 1]!.byteEnd) {
      throw new Error(
        `Edits overlap at byte ${sorted[i]!.byteStart} (previous ended at ${sorted[i - 1]!.byteEnd})`,
      );
    }
  }
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const e of sorted) {
    if (e.byteStart < cursor || e.byteEnd > original.length || e.byteStart > e.byteEnd) {
      throw new Error(`Invalid edit range [${e.byteStart},${e.byteEnd}]`);
    }
    parts.push(original.subarray(cursor, e.byteStart));
    parts.push(Buffer.from(e.replacement, "utf8"));
    cursor = e.byteEnd;
  }
  parts.push(original.subarray(cursor));
  return Buffer.concat(parts);
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/rewrite/
git commit -m "Add precise edit applier"
```

### Task 3.2: File-level rewriter

**Files:**
- Create: `src/rewrite/file.ts`
- Create: `src/rewrite/file.test.ts`

Reads file as bytes, applies edits, writes back. Used by the CLI in `-u` mode.

- [ ] **Step 1: Write failing tests**

```ts
// src/rewrite/file.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteFile } from "./file";

describe("rewriteFile", () => {
  it("writes only changed bytes back to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-"));
    const path = join(dir, "build.gradle");
    const original = `dependencies {\n  implementation 'a:b:1.0.0'\n}\n`;
    await writeFile(path, original, "utf8");
    const start = original.indexOf("1.0.0");
    await rewriteFile(path, [{ byteStart: start, byteEnd: start + 5, replacement: "2.0.0" }]);
    const after = await readFile(path, "utf8");
    expect(after).toBe(`dependencies {\n  implementation 'a:b:2.0.0'\n}\n`);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/rewrite/file.ts
import { readFile, writeFile } from "node:fs/promises";
import type { Edit } from "../types";
import { applyEdits } from "./apply";

export async function rewriteFile(path: string, edits: Edit[]): Promise<void> {
  if (edits.length === 0) return;
  const original = await readFile(path);
  const updated = applyEdits(original, edits);
  await writeFile(path, updated);
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/rewrite/
git commit -m "Add file rewriter"
```

---

## Phase 4 — Format locators

Each locator is a function `(filePath: string, contents: string) => Occurrence[]`. The locator is the only format-aware code in the pipeline.

### Task 4.1: Shared locator helpers + fixture harness

**Files:**
- Create: `src/formats/util.ts`
- Create: `test/helpers/fixtures.ts`

- [ ] **Step 1: Implement common helpers**

```ts
// src/formats/util.ts
export function utf8ByteLen(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export function charIndexToByte(text: string, charIndex: number): number {
  return Buffer.byteLength(text.slice(0, charIndex), "utf8");
}

/** Parses "group:artifact:version" or "group:artifact" into parts (rest is the trailing version, possibly empty). */
export function splitGav(coord: string): { group: string; artifact: string; version: string | null } | null {
  const parts = coord.split(":");
  if (parts.length === 2) return { group: parts[0]!, artifact: parts[1]!, version: null };
  if (parts.length === 3) return { group: parts[0]!, artifact: parts[1]!, version: parts[2]! };
  return null;
}

export function depKey(group: string, artifact: string, blockId?: string): string {
  return blockId ? `${group}:${artifact}@${blockId}` : `${group}:${artifact}`;
}
```

- [ ] **Step 2: Implement fixture harness**

```ts
// test/helpers/fixtures.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type FixtureCase = {
  name: string;
  inputPath: string;
  inputBytes: Buffer;
  inputText: string;
  expectedBytes: Buffer | null;
  edits: { byteStart: number; byteEnd: number; replacement: string }[] | null;
  occurrences: unknown | null;
};

export async function loadFixtures(rootDir: string): Promise<FixtureCase[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const out: FixtureCase[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(rootDir, e.name);
    const files = await readdir(dir);
    const inputName = files.find(f => f.startsWith("input."));
    if (!inputName) continue;
    const expectedName = files.find(f => f.startsWith("expected."));
    const inputPath = join(dir, inputName);
    const inputBytes = await readFile(inputPath);
    const expectedBytes = expectedName ? await readFile(join(dir, expectedName)) : null;
    const editsPath = join(dir, "edits.json");
    const occPath = join(dir, "occurrences.json");
    const edits = files.includes("edits.json") ? JSON.parse(await readFile(editsPath, "utf8")) : null;
    const occurrences = files.includes("occurrences.json") ? JSON.parse(await readFile(occPath, "utf8")) : null;
    out.push({
      name: e.name,
      inputPath,
      inputBytes,
      inputText: inputBytes.toString("utf8"),
      expectedBytes,
      edits,
      occurrences,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/formats/util.ts test/helpers/
git commit -m "Add shared format helpers and fixture harness"
```

### Task 4.2: `gradle.properties` locator

**Files:**
- Create: `src/formats/properties/locate.ts`
- Create: `src/formats/properties/locate.test.ts`
- Create: `test/fixtures/properties/simple/input.properties`
- Create: `test/fixtures/properties/simple/expected.properties`
- Create: `test/fixtures/properties/simple/edits.json`

`gradle.properties` is the simplest format. Each line `key=value` (or `key:value`, `key value`). Comments start with `#` or `!`. Values are not quoted. The locator emits one `Occurrence` per `*Version` / `*-version` / `*.version` style key — but determining which keys are version-like at this stage is wrong: we only know once a consumer references them via `$key`. So:

**Design:** `gradle.properties` locator emits one *candidate* `Occurrence` per line that looks like `<identifier>=<value>` where the value is a recognizable version literal (passes `detectShape` and isn't `latestQualifier`). The refs/ stage will discard candidates that aren't actually consumed.

Group/artifact for properties-only entries is the empty string until refs/ wires them up. We model this by emitting `Occurrence` with `group=""`, `artifact=""`, `dependencyKey="prop:<key>"`. Refs stage rewrites these fields when it links the consumer site.

- [ ] **Step 1: Write failing test**

```ts
// src/formats/properties/locate.test.ts
import { describe, it, expect } from "vitest";
import { locateProperties } from "./locate";

describe("locateProperties", () => {
  it("emits a candidate per version-shaped value", () => {
    const text = `
# header
kotlinVersion=1.9.0
springBootVersion = 3.2.0
unrelated=hello
empty=
`;
    const occs = locateProperties("/x/gradle.properties", text);
    expect(occs.map(o => ({ key: o.dependencyKey, raw: o.currentRaw }))).toEqual([
      { key: "prop:kotlinVersion", raw: "1.9.0" },
      { key: "prop:springBootVersion", raw: "3.2.0" },
    ]);
    // Byte ranges must point exactly at the value.
    const o = occs[0]!;
    expect(text.slice(o.byteStart, o.byteEnd)).toBe("1.9.0");
  });
  it("handles CRLF and tabs without bleeding into surrounding bytes", () => {
    const text = "a=1.0\r\nb=2.0\r\n";
    const occs = locateProperties("/x/gradle.properties", text);
    expect(occs).toHaveLength(2);
    expect(text.slice(occs[0]!.byteStart, occs[0]!.byteEnd)).toBe("1.0");
    expect(text.slice(occs[1]!.byteStart, occs[1]!.byteEnd)).toBe("2.0");
  });
  it("ignores comments", () => {
    expect(locateProperties("/x", "# foo=1.0\n! bar=2.0\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/formats/properties/locate.ts
import type { Occurrence } from "../../types";
import { detectShape } from "../../version/shape";
import { charIndexToByte } from "../util";

const KEY_VAL = /^[ \t]*([A-Za-z_][\w.\-]*)[ \t]*[=: \t][ \t]*(.*?)[ \t]*$/;

export function locateProperties(file: string, contents: string): Occurrence[] {
  const out: Occurrence[] = [];
  let charPos = 0;
  for (const line of contents.split(/\r?\n/)) {
    const lineStartChar = charPos;
    charPos += line.length + (contents.slice(charPos + line.length, charPos + line.length + 2).startsWith("\r\n") ? 2 : 1);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const m = KEY_VAL.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (!value) continue;
    const shape = detectShape(value);
    if (shape === "latestQualifier") continue;
    const valueOffsetInLine = line.lastIndexOf(value);
    const byteStart = charIndexToByte(contents, lineStartChar + valueOffsetInLine);
    const byteEnd = byteStart + Buffer.byteLength(value, "utf8");
    out.push({
      group: "",
      artifact: "",
      file,
      byteStart,
      byteEnd,
      fileType: "properties",
      currentRaw: value,
      shape,
      dependencyKey: `prop:${key}`,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/formats/properties`

- [ ] **Step 5: Add fixture**

`test/fixtures/properties/simple/input.properties`:
```
kotlinVersion=1.9.0
springVersion=3.2.0
```

`test/fixtures/properties/simple/expected.properties`:
```
kotlinVersion=2.0.21
springVersion=3.2.5
```

`test/fixtures/properties/simple/edits.json`:
```json
[
  { "byteStart": 14, "byteEnd": 19, "replacement": "2.0.21" },
  { "byteStart": 34, "byteEnd": 39, "replacement": "3.2.5" }
]
```

(Verify offsets exactly with `Buffer.byteLength`. If a step in the rewriter test reveals an off-by-one, fix the fixture.)

Add a fixture-driven test:

```ts
// src/formats/properties/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../rewrite/apply";
import { loadFixtures } from "../../../test/helpers/fixtures";

describe("properties fixtures", async () => {
  const cases = await loadFixtures("test/fixtures/properties");
  for (const c of cases) {
    it(`${c.name} round-trips byte-for-byte via edits.json`, () => {
      if (!c.edits || !c.expectedBytes) return;
      const out = applyEdits(c.inputBytes, c.edits);
      expect(out.equals(c.expectedBytes)).toBe(true);
    });
  }
});
```

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm test src/formats/properties`

- [ ] **Step 7: Commit**

```bash
git add src/formats/properties/ test/fixtures/properties/
git commit -m "Add gradle.properties locator"
```

### Task 4.3: Groovy DSL tokenizer

**Files:**
- Create: `src/formats/groovy-dsl/tokenize.ts`
- Create: `src/formats/groovy-dsl/tokenize.test.ts`

A small string-literal-aware scanner. Per BOOTSTRAP.md, we only need to safely skip over comments and quoted strings while still being able to identify call shapes. Outputs a stream of tokens where each token records its byte offset.

Token kinds:
- `string` — single-, double-, triple-single, triple-double quoted; records `body` (raw inner text), `quote` (`'`, `"`, `'''`, `"""`), and whether the body contains `$` interpolation.
- `comment` — `// ...` line, `/* ... */` block.
- `ident` — `[A-Za-z_$][\w$]*`.
- `number` — digit sequences.
- `punct` — single non-whitespace character (for braces, parens, dots, etc.).
- `ws` — whitespace runs (we keep these so positions are preserved; tests can ignore them).

- [ ] **Step 1: Write failing tests**

```ts
// src/formats/groovy-dsl/tokenize.test.ts
import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenize";

const kinds = (s: string) => tokenize(s).filter(t => t.kind !== "ws").map(t => t.kind);

describe("groovy tokenize", () => {
  it("recognizes strings and idents", () => {
    expect(kinds(`implementation 'a:b:1.0'`)).toEqual(["ident", "string"]);
  });
  it("skips line comments", () => {
    expect(kinds(`// hello\nfoo`)).toEqual(["comment", "ident"]);
  });
  it("skips block comments", () => {
    expect(kinds(`/* a */ foo`)).toEqual(["comment", "ident"]);
  });
  it("recognizes triple-quoted strings", () => {
    const t = tokenize(`x = """multi\nline"""`);
    const s = t.find(x => x.kind === "string")!;
    expect(s.quote).toBe(`"""`);
  });
  it("does not mistake apostrophes inside line comments for string starts", () => {
    expect(kinds(`// don't break\nfoo`)).toEqual(["comment", "ident"]);
  });
  it("flags $ interpolation in double-quoted strings", () => {
    const t = tokenize(`"v$kotlinVersion"`);
    const s = t.find(x => x.kind === "string")!;
    expect(s.interpolated).toBe(true);
  });
  it("does not flag $ in single-quoted strings", () => {
    const t = tokenize(`'v$kotlinVersion'`);
    const s = t.find(x => x.kind === "string")!;
    expect(s.interpolated).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/formats/groovy-dsl/tokenize.ts
export type Token =
  | { kind: "ws"; charStart: number; charEnd: number; byteStart: number; byteEnd: number }
  | { kind: "comment"; charStart: number; charEnd: number; byteStart: number; byteEnd: number }
  | { kind: "ident"; text: string; charStart: number; charEnd: number; byteStart: number; byteEnd: number }
  | { kind: "number"; text: string; charStart: number; charEnd: number; byteStart: number; byteEnd: number }
  | { kind: "punct"; text: string; charStart: number; charEnd: number; byteStart: number; byteEnd: number }
  | {
      kind: "string";
      quote: "'" | '"' | "'''" | '"""';
      body: string;
      bodyCharStart: number;
      bodyCharEnd: number;
      bodyByteStart: number;
      bodyByteEnd: number;
      charStart: number;
      charEnd: number;
      byteStart: number;
      byteEnd: number;
      interpolated: boolean;
    };

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const byteAt = (charIdx: number) => Buffer.byteLength(input.slice(0, charIdx), "utf8");
  let i = 0;
  const n = input.length;
  while (i < n) {
    const start = i;
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      while (i < n && /\s/.test(input[i]!)) i++;
      out.push({ kind: "ws", charStart: start, charEnd: i, byteStart: byteAt(start), byteEnd: byteAt(i) });
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      while (i < n && input[i] !== "\n") i++;
      out.push({ kind: "comment", charStart: start, charEnd: i, byteStart: byteAt(start), byteEnd: byteAt(i) });
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
      if (i < n) i += 2;
      out.push({ kind: "comment", charStart: start, charEnd: i, byteStart: byteAt(start), byteEnd: byteAt(i) });
      continue;
    }
    if (ch === "'" || ch === '"') {
      const triple = input[i + 1] === ch && input[i + 2] === ch;
      const quote = (triple ? ch.repeat(3) : ch) as Token extends { kind: "string"; quote: infer Q } ? Q : never;
      const open = quote.length;
      i += open;
      const bodyStart = i;
      while (i < n) {
        if (input[i] === "\\") { i += 2; continue; }
        if (triple) {
          if (input[i] === ch && input[i + 1] === ch && input[i + 2] === ch) break;
        } else if (input[i] === ch) {
          break;
        }
        i++;
      }
      const bodyEnd = i;
      const body = input.slice(bodyStart, bodyEnd);
      i += triple ? 3 : 1;
      const interpolated = (ch === '"') && body.includes("$");
      out.push({
        kind: "string",
        quote,
        body,
        bodyCharStart: bodyStart,
        bodyCharEnd: bodyEnd,
        bodyByteStart: byteAt(bodyStart),
        bodyByteEnd: byteAt(bodyEnd),
        charStart: start,
        charEnd: i,
        byteStart: byteAt(start),
        byteEnd: byteAt(i),
        interpolated,
      });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      while (i < n && /[\w$]/.test(input[i]!)) i++;
      out.push({ kind: "ident", text: input.slice(start, i), charStart: start, charEnd: i, byteStart: byteAt(start), byteEnd: byteAt(i) });
      continue;
    }
    if (/\d/.test(ch)) {
      while (i < n && /[\d.]/.test(input[i]!)) i++;
      out.push({ kind: "number", text: input.slice(start, i), charStart: start, charEnd: i, byteStart: byteAt(start), byteEnd: byteAt(i) });
      continue;
    }
    i++;
    out.push({ kind: "punct", text: ch, charStart: start, charEnd: i, byteStart: byteAt(start), byteEnd: byteAt(i) });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/formats/groovy-dsl/
git commit -m "Add Groovy DSL tokenizer"
```

### Task 4.4: Groovy DSL locator — exact-string deps

**Files:**
- Create: `src/formats/groovy-dsl/locate.ts`
- Create: `src/formats/groovy-dsl/locate.test.ts`
- Create: `test/fixtures/groovy-dsl/exact/{input.gradle,expected.gradle,edits.json}`

Match call shapes:
- `<config>(?)\s*'group:artifact:version'` (single, double, or triple quoted)
- `<config>(?)\s*"group:artifact:$var"` → emits an Occurrence pointing at the **interpolation source variable** (handled by refs/ in Phase 5; locator records a `pendingRef` placeholder)
- `<config>(?)\s*"group:artifact:${var}"` — same
- Plugin DSL: `id "group" version "1.0"` (note no `:` separator)

For Phase 4.4, handle only the literal-string case. Pending-ref strings are emitted as Occurrences with `shape="exact"` and `currentRaw=<rawBody>` plus a `via: ["__pending_ref__:<varName>"]` marker that refs/ will resolve.

- [ ] **Step 1: Write failing tests** (locator behavior)

```ts
// src/formats/groovy-dsl/locate.test.ts
import { describe, it, expect } from "vitest";
import { locateGroovy } from "./locate";

describe("locateGroovy", () => {
  it("finds exact GAV in single-quoted string", () => {
    const text = `dependencies {\n  implementation 'org.foo:bar:1.0.0'\n}\n`;
    const occs = locateGroovy("/x/build.gradle", text);
    expect(occs).toHaveLength(1);
    const o = occs[0]!;
    expect(o.group).toBe("org.foo");
    expect(o.artifact).toBe("bar");
    expect(o.currentRaw).toBe("1.0.0");
    expect(text.slice(o.byteStart, o.byteEnd)).toBe("1.0.0");
    expect(o.shape).toBe("exact");
  });
  it("finds prerelease shape", () => {
    const occs = locateGroovy("/x", `compile 'a:b:1.3.0-beta3'`);
    expect(occs[0]!.shape).toBe("prerelease");
  });
  it("finds plugins block: id ... version ...", () => {
    const occs = locateGroovy("/x", `plugins {\n  id 'org.springframework.boot' version '3.2.0'\n}`);
    expect(occs).toHaveLength(1);
    expect(occs[0]!.group).toBe("org.springframework.boot");
    expect(occs[0]!.artifact).toBe("org.springframework.boot.gradle.plugin");
    expect(occs[0]!.currentRaw).toBe("3.2.0");
  });
  it("ignores adjacent comments", () => {
    const text = `implementation 'a:b:1.0' // pinned`;
    const occs = locateGroovy("/x", text);
    expect(occs[0]!.byteEnd).toBe(text.indexOf("1.0") + 3);
  });
  it("emits pending-ref marker for $-interpolated version", () => {
    const text = `implementation "a:b:$kotlinVersion"`;
    const occs = locateGroovy("/x", text);
    expect(occs[0]!.via?.[0]).toMatch(/^__pending_ref__:kotlinVersion$/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/formats/groovy-dsl/locate.ts
import type { Occurrence } from "../../types";
import { detectShape } from "../../version/shape";
import { splitGav } from "../util";
import { tokenize, type Token } from "./tokenize";

const CONFIG_NAMES = new Set([
  "implementation","api","compile","compileOnly","runtimeOnly","testImplementation","testCompile",
  "testRuntimeOnly","annotationProcessor","kapt","ksp","classpath","detektPlugins",
  "androidTestImplementation","debugImplementation","releaseImplementation",
]);

function emitFromGavString(file: string, raw: string, byteStart: number, byteEnd: number, interpolated: boolean): Occurrence | null {
  // Handle interpolation: extract var name from ":$var" or ":${var}" suffix
  const interpMatch = /^([^:]+):([^:]+):(?:\$\{?([A-Za-z_][\w]*)\}?)$/.exec(raw);
  if (interpolated && interpMatch) {
    const [, group, artifact, varName] = interpMatch;
    return {
      group: group!,
      artifact: artifact!,
      file,
      byteStart, // these point at the literal body — refs/ will redirect to the definition site
      byteEnd,
      fileType: "groovy-dsl",
      currentRaw: `\$${varName!}`,
      shape: "exact",
      dependencyKey: `${group}:${artifact}`,
      via: [`__pending_ref__:${varName!}`],
    };
  }
  const parts = splitGav(raw);
  if (!parts || !parts.version) return null;
  const versionOffset = raw.lastIndexOf(parts.version);
  const vStart = byteStart + Buffer.byteLength(raw.slice(0, versionOffset), "utf8");
  const vEnd = vStart + Buffer.byteLength(parts.version, "utf8");
  return {
    group: parts.group,
    artifact: parts.artifact,
    file,
    byteStart: vStart,
    byteEnd: vEnd,
    fileType: "groovy-dsl",
    currentRaw: parts.version,
    shape: detectShape(parts.version),
    dependencyKey: `${parts.group}:${parts.artifact}`,
  };
}

export function locateGroovy(file: string, contents: string): Occurrence[] {
  const tokens = tokenize(contents).filter(t => t.kind !== "ws");
  const out: Occurrence[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    // <config> '<gav>'
    if (t.kind === "ident" && CONFIG_NAMES.has(t.text)) {
      // Skip optional "(": find next non-punct-paren token
      let j = i + 1;
      if (tokens[j]?.kind === "punct" && (tokens[j]! as Token & { text: string }).text === "(") j++;
      const arg = tokens[j];
      if (arg?.kind === "string") {
        const occ = emitFromGavString(file, arg.body, arg.bodyByteStart, arg.bodyByteEnd, arg.interpolated);
        if (occ) out.push(occ);
      }
    }
    // plugins: id <string> version <string>
    if (t.kind === "ident" && t.text === "id") {
      let j = i + 1;
      if (tokens[j]?.kind === "punct" && (tokens[j]! as Token & { text: string }).text === "(") j++;
      const idTok = tokens[j];
      if (idTok?.kind !== "string") continue;
      let k = j + 1;
      if (tokens[k]?.kind === "punct" && (tokens[k]! as Token & { text: string }).text === ")") k++;
      const verIdent = tokens[k];
      if (verIdent?.kind !== "ident" || verIdent.text !== "version") continue;
      const verTok = tokens[k + 1];
      if (verTok?.kind !== "string") continue;
      const group = idTok.body;
      out.push({
        group,
        artifact: `${group}.gradle.plugin`,
        file,
        byteStart: verTok.bodyByteStart,
        byteEnd: verTok.bodyByteEnd,
        fileType: "groovy-dsl",
        currentRaw: verTok.body,
        shape: detectShape(verTok.body),
        dependencyKey: `${group}:${group}.gradle.plugin`,
        ...(verTok.interpolated && /^\$\{?([A-Za-z_][\w]*)\}?$/.test(verTok.body)
          ? { via: [`__pending_ref__:${/^\$\{?([A-Za-z_][\w]*)\}?$/.exec(verTok.body)![1]!}`] }
          : {}),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/formats/groovy-dsl/locate`

- [ ] **Step 5: Add fixtures from inventory**

For each row in BOOTSTRAP.md §"Test fixture inventory" under `groovy-dsl/`, create the directory + `input.gradle` + `expected.gradle` + `edits.json`. Examples:

`test/fixtures/groovy-dsl/exact/input.gradle`:
```
dependencies {
    implementation 'org.foo:bar:1.0.0'
}
```

`test/fixtures/groovy-dsl/exact/expected.gradle`:
```
dependencies {
    implementation 'org.foo:bar:2.0.0'
}
```

`test/fixtures/groovy-dsl/exact/edits.json`:
Compute byte offsets of `1.0.0` in input. (Practical approach: write a small fixture generator script, OR hand-compute. For ASCII content, `byteStart = inputText.indexOf("1.0.0")`.)

Add fixtures: `exact-tabs`, `exact-crlf`, `exact-trailing-comment`, `prefix`, `strictly-shorthand`, `strictly-prefer-shorthand`, `maven-range` (no edits, expected==input), `rich-block`, `plugins`, `ext-property`, `gstring-interpolation`.

Add fixture runner (mirrors properties version):

```ts
// src/formats/groovy-dsl/locate.fixture.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../rewrite/apply";
import { loadFixtures } from "../../../test/helpers/fixtures";

describe("groovy-dsl fixtures", async () => {
  const cases = await loadFixtures("test/fixtures/groovy-dsl");
  for (const c of cases) {
    it(`${c.name}: rewriter produces expected bytes`, () => {
      if (!c.edits || !c.expectedBytes) return;
      expect(applyEdits(c.inputBytes, c.edits).equals(c.expectedBytes)).toBe(true);
    });
  }
});
```

- [ ] **Step 6: Run — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/formats/groovy-dsl/ test/fixtures/groovy-dsl/
git commit -m "Add Groovy DSL locator with exact, plugin, interpolation"
```

### Task 4.5: Groovy DSL — `version { ... }` rich blocks

**Files:**
- Modify: `src/formats/groovy-dsl/locate.ts`
- Modify: `src/formats/groovy-dsl/locate.test.ts`
- Create: `test/fixtures/groovy-dsl/rich-block/...`

Detect `version { strictly("..."); require("..."); prefer("..."); reject("...") }` blocks attached to a dependency declaration, e.g.:

```
implementation('org.foo:bar') {
    version {
        strictly '1.7.15'
        prefer '1.7.15'
    }
}
```

Each `strictly`/`require`/`prefer`/`reject` call inside the `version` block emits an `Occurrence` sharing the `dependencyKey` (with a stable `@blockId` synthesized from the byte offset of the opening `{` of `version {`).

- [ ] **Step 1: Write failing tests**

```ts
it("emits one Occurrence per rich-block call sharing dependencyKey", () => {
  const text = `
implementation('org.foo:bar') {
  version {
    strictly '1.7.15'
    prefer '1.7.15'
  }
}`;
  const occs = locateGroovy("/x", text);
  expect(occs.map(o => o.shape)).toEqual(["richStrictly", "richPrefer"]);
  expect(new Set(occs.map(o => o.dependencyKey))).toHaveProperty("size", 1);
});

it("rich reject is emitted but never auto-modified", () => {
  const occs = locateGroovy("/x", `
implementation('a:b') { version { require '1.0'; reject '2.0' } }`);
  expect(occs.find(o => o.shape === "richReject")).toBeDefined();
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend implementation**

In `locate.ts`, after the `<config>(...)` match for an exact GAV that has no version (i.e. 2-part `splitGav`), look ahead for a `{ version { ... } }` brace block. Walk tokens until matching close-brace, collecting `richRequire/richStrictly/richPrefer/richReject` calls. Block ID is the byte offset of the `version` ident.

Add helper `findClosingBrace(tokens, startIdx)` that respects nested `{` `}`.

(Implementation pseudocode — engineer fills in matching the tokenizer's API.)

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Add fixture**

`test/fixtures/groovy-dsl/rich-block/` per the inventory.

- [ ] **Step 6: Commit**

```bash
git add src/formats/groovy-dsl/ test/fixtures/groovy-dsl/rich-block/
git commit -m "Locate Groovy rich version blocks"
```

### Task 4.6: Groovy DSL — `ext` / `extra` properties

**Files:**
- Modify: `src/formats/groovy-dsl/locate.ts`
- Create: `test/fixtures/groovy-dsl/ext-property/...`

Detect `ext.kotlinVersion = '1.9.0'`, `ext { kotlinVersion = '1.9.0' }`, `project.ext.kotlinVersion = ...`. Emits an Occurrence with `dependencyKey: "prop:kotlinVersion"` like the properties locator, so refs/ wires it identically.

- [ ] **Step 1: Tests**

```ts
it("locates ext.varName = '1.0' definitions", () => {
  const occs = locateGroovy("/x", `ext.kotlinVersion = '1.9.0'`);
  expect(occs).toContainEqual(expect.objectContaining({ dependencyKey: "prop:kotlinVersion", currentRaw: "1.9.0" }));
});
it("locates ext { x = '1.0'; y = '2.0' }", () => {
  const occs = locateGroovy("/x", `ext { kotlinVersion = '1.9.0'\nspringVersion = '3.0' }`);
  expect(occs.map(o => o.dependencyKey)).toEqual(
    expect.arrayContaining(["prop:kotlinVersion", "prop:springVersion"]),
  );
});
```

- [ ] **Steps 2–6:** implement, test, fixture, commit (mirroring 4.5).

```bash
git commit -m "Locate Groovy ext and extra property definitions"
```

### Task 4.7: Kotlin DSL locator

**Files:**
- Create: `src/formats/kotlin-dsl/tokenize.ts` (port of Groovy tokenizer with Kotlin specifics)
- Create: `src/formats/kotlin-dsl/locate.ts`
- Create: `src/formats/kotlin-dsl/locate.test.ts`
- Create: `test/fixtures/kotlin-dsl/...` (mirror of every Groovy fixture)

Kotlin DSL differences:
- Strings: `"..."`, raw `"""..."""`. No single-quoted strings.
- Comments: same `//` and `/* */`, plus nested block comments allowed (Kotlin spec). Tokenizer must support nesting (track depth).
- Calls require parentheses: `implementation("a:b:1.0")`, `id("foo") version "1.0"` (Kotlin DSL `version` extension is an infix operator on PluginDependencySpec — locator handles `id("...") version "..."` and the chain form with `.version("...")` if encountered).
- `val kotlinVersion = "1.9.0"` definitions emit `dependencyKey: "prop:kotlinVersion"`.
- `extra["kotlinVersion"] = "1.9.0"` and `val kotlinVersion by extra("1.9.0")` likewise.

- [ ] **Step 1: Write tokenizer tests** mirroring the Groovy tests, plus:
  - Nested block comments: `/* a /* b */ c */ foo` → one comment + ident.
  - No single-quoted strings: `'x'` is treated as a punct-then-ident-then-punct, not a string.

- [ ] **Step 2: Implement Kotlin tokenizer.**

- [ ] **Step 3: Write locator tests** mirroring Groovy.

- [ ] **Step 4: Implement Kotlin locator.** Reuse helpers from `formats/util.ts` and the Groovy locator; differ only in the call/syntax patterns.

- [ ] **Step 5: Add Kotlin fixtures (one per Groovy fixture; same content semantically, Kotlin syntax).**

- [ ] **Step 6: Commit**

```bash
git add src/formats/kotlin-dsl/ test/fixtures/kotlin-dsl/
git commit -m "Add Kotlin DSL locator"
```

### Task 4.8: Version-catalog (`libs.versions.toml`) locator

**Files:**
- Create: `src/formats/version-catalog/locate.ts`
- Create: `src/formats/version-catalog/locate.test.ts`
- Create: `test/fixtures/version-catalog/{simple,range,rich-table,library-inline-version,library-version-ref}/...`

Hand-written TOML scanner: just enough to parse `[versions]`, `[libraries]`, `[plugins]` tables with precise locations on values.

Rules:
- `[versions]` entries `kotlin = "1.9.0"` emit Occurrence with `dependencyKey: "catalog-version:kotlin"`. They have no group/artifact until a `[libraries]` entry references them — that linkage is handled by refs/.
- `[libraries]` entries:
  - `foo = { module = "g:a", version = "1.0" }` → Occurrence on `version` literal, dependencyKey `g:a`.
  - `foo = { module = "g:a", version.ref = "kotlin" }` → emits a `pendingRef` Occurrence whose canonical edit site is in the `[versions]` table (resolved by refs/).
  - `foo = { module = "g:a", version = { strictly = "...", prefer = "..." } }` → rich-table; one Occurrence per field, sharing dependencyKey `g:a@<offset>`.
  - `foo = "g:a:1.0"` (compact string form) → standard exact.
- `[plugins]` entries: `id = "..."` + `version`/`version.ref` → emits Occurrence with `artifact = id + ".gradle.plugin"`.

- [ ] **Step 1: Write tests** for each shape (simple, range report-only, rich-table per-field edit, library inline version, library version.ref).

- [ ] **Step 2: Implement.** Approach: line-based scanner because TOML keys are line-significant. Track current `[table]`. For values, recognize: bare string `"..."`, inline table `{ ... }` (parse fields with byte offsets), bare bool/number (ignore for our purposes). String parser must know about `"..."` and `'...'` literal-strings — TOML allows both, no interpolation in either; multi-line strings (`"""..."""`, `'''...'''`) per TOML 1.0.

```ts
// Sketch:
// - Walk char-by-char.
// - On `[`-at-line-start, read table name to the matching `]`.
// - Otherwise read `key = value`. Keys can be quoted or bare.
// - For values, recognize string-vs-inline-table, with byte offsets.
// - On inline-table, recursively descend keys until `}`.
```

- [ ] **Step 3: Run — expect PASS**

- [ ] **Step 4: Add fixtures.**

- [ ] **Step 5: Commit**

```bash
git add src/formats/version-catalog/ test/fixtures/version-catalog/
git commit -m "Add version-catalog locator"
```

---

## Phase 5 — Variable reference resolution

### Task 5.1: Resolve `prop:` definitions across files

**Files:**
- Create: `src/refs/resolve.ts`
- Create: `src/refs/resolve.test.ts`
- Create: `test/fixtures/refs/{shared-variable-disagreement,variable-not-found}/...`

Input: an array of all `Occurrence`s from every locator across the project. Output: a transformed array where every `__pending_ref__:<name>` consumer has been linked to its definition site (Occurrence with `dependencyKey: prop:<name>` or `catalog-version:<name>`).

Linkage rule: the resolver iterates consumers; for each consumer's pending var name, look up the matching definition Occurrence. The resulting Occurrence:
- Adopts the **definition's `file/byteStart/byteEnd/shape/currentRaw`** (the canonical edit site).
- Keeps the consumer's `group/artifact/dependencyKey` (so the policy decides per-dep).
- Sets `via` to `[<consumer-file>, ...optional intermediate hops...]`. The consumer's own file path is recorded so the report can show "this lives in gradle.properties but is used by app/build.gradle".

When **multiple consumers point at the same definition Occurrence**, the resolver emits one *consumer* Occurrence per consumer, each pointing at the same `(file, byteStart, byteEnd)`. The policy layer is what later detects the "two consumers disagree" case — the resolver doesn't combine them.

Failure modes:
- Definition not found → emit an `unresolvedRef` warning (collected separately, returned alongside Occurrences). The CLI surfaces these and exits with code 3.
- Catalog `version.ref` pointing at a non-existent `[versions]` key → same.

- [ ] **Step 1: Tests**

```ts
// src/refs/resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolveRefs } from "./resolve";
import type { Occurrence } from "../types";

const propDef = (file: string, key: string, raw: string, byteStart = 0): Occurrence => ({
  group: "", artifact: "", file, byteStart, byteEnd: byteStart + raw.length,
  fileType: "properties", currentRaw: raw, shape: "exact", dependencyKey: `prop:${key}`,
});

const consumer = (group: string, artifact: string, varName: string): Occurrence => ({
  group, artifact, file: "/x/build.gradle", byteStart: 100, byteEnd: 110,
  fileType: "groovy-dsl", currentRaw: `\$${varName}`, shape: "exact",
  dependencyKey: `${group}:${artifact}`, via: [`__pending_ref__:${varName}`],
});

describe("resolveRefs", () => {
  it("redirects consumer to definition site", () => {
    const def = propDef("/x/gradle.properties", "kotlinVersion", "1.9.0");
    const c = consumer("org.jetbrains.kotlin", "kotlin-stdlib", "kotlinVersion");
    const { occurrences, errors } = resolveRefs([def, c]);
    expect(errors).toEqual([]);
    const linked = occurrences.find(o => o.group === "org.jetbrains.kotlin")!;
    expect(linked.file).toBe("/x/gradle.properties");
    expect(linked.byteStart).toBe(def.byteStart);
    expect(linked.currentRaw).toBe("1.9.0");
    expect(linked.via).toContain("/x/build.gradle");
  });
  it("emits unresolved error when definition missing", () => {
    const c = consumer("a", "b", "missing");
    const { errors } = resolveRefs([c]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.varName).toBe("missing");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/refs/resolve.ts
import type { Occurrence } from "../types";

export type RefError = { varName: string; consumer: Occurrence };

export function resolveRefs(input: Occurrence[]): { occurrences: Occurrence[]; errors: RefError[] } {
  const defs = new Map<string, Occurrence>();
  for (const o of input) {
    if (o.dependencyKey.startsWith("prop:") || o.dependencyKey.startsWith("catalog-version:")) {
      defs.set(o.dependencyKey, o);
    }
  }
  const out: Occurrence[] = [];
  const errors: RefError[] = [];
  for (const o of input) {
    const pending = o.via?.find(v => v.startsWith("__pending_ref__:"));
    if (!pending) { out.push(o); continue; }
    const varName = pending.slice("__pending_ref__:".length);
    // Try property first, then catalog version.
    const def = defs.get(`prop:${varName}`) ?? defs.get(`catalog-version:${varName}`);
    if (!def) { errors.push({ varName, consumer: o }); continue; }
    out.push({
      ...o,
      file: def.file,
      byteStart: def.byteStart,
      byteEnd: def.byteEnd,
      fileType: def.fileType,
      currentRaw: def.currentRaw,
      shape: def.shape,
      via: [o.file, ...(o.via ?? []).filter(v => !v.startsWith("__pending_ref__:"))],
    });
  }
  return { occurrences: out, errors };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Add multi-file fixtures**

`test/fixtures/refs/shared-variable-disagreement/`: two consumer occurrences pointing at the same `prop:kotlinVersion` definition but with different "winners" — exercised in policy tests, not here.

`test/fixtures/refs/variable-not-found/`: one consumer with no matching def → assert one error emitted.

- [ ] **Step 6: Commit**

```bash
git add src/refs/ test/fixtures/refs/
git commit -m "Resolve cross-file variable references to definition sites"
```

---

## Phase 6 — Discovery walker

### Task 6.1: File-system walker with hardcoded prune list

**Files:**
- Create: `src/discover/walk.ts`
- Create: `src/discover/walk.test.ts`
- Create: `test/fixtures/projects/walk-skip-defaults/...`

Per BOOTSTRAP.md §"Discovery". Recursively walks a root directory, prunes directories matching the hardcoded list (and any name starting with `.` not on the empty allow-list), and emits absolute paths to known build files: `build.gradle`, `build.gradle.kts`, `gradle.properties`, `settings.gradle`, `settings.gradle.kts`, `gradle/libs.versions.toml`, plus any `*.versions.toml` under `gradle/`.

- [ ] **Step 1: Tests**

```ts
// src/discover/walk.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walk } from "./walk";

async function makeTree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "gcu-walk-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents, "utf8");
  }
  return root;
}

describe("walk", () => {
  it("finds known build files", async () => {
    const root = await makeTree({
      "build.gradle.kts": "x",
      "settings.gradle.kts": "x",
      "gradle.properties": "x",
      "gradle/libs.versions.toml": "x",
      "app/build.gradle": "x",
    });
    const files = (await walk(root)).map(f => f.replace(root, "")).sort();
    expect(files).toEqual([
      "/app/build.gradle",
      "/build.gradle.kts",
      "/gradle.properties",
      "/gradle/libs.versions.toml",
      "/settings.gradle.kts",
    ]);
  });
  it("prunes hardcoded skip list", async () => {
    const root = await makeTree({
      ".gradle/x/build.gradle.kts": "x",
      ".idea/build.gradle": "x",
      "node_modules/foo/build.gradle.kts": "x",
      "build/intermediates/build.gradle": "x",
      "out/foo/build.gradle.kts": "x",
      "src/build.gradle.kts": "x",
    });
    const files = (await walk(root)).map(f => f.replace(root, ""));
    expect(files).toEqual(["/src/build.gradle.kts"]);
  });
  it("prunes any dot-prefixed dir not on allow-list", async () => {
    const root = await makeTree({
      ".github/workflows/build.gradle": "x",
      ".weird/build.gradle.kts": "x",
      "real/build.gradle": "x",
    });
    const files = (await walk(root)).map(f => f.replace(root, ""));
    expect(files).toEqual(["/real/build.gradle"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/discover/walk.ts
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";

const PRUNE = new Set([
  ".gradle", ".idea", ".vscode", ".git", ".hg", ".svn",
  "build", "out", "target",
  "node_modules", ".pnpm-store", ".yarn",
  ".gcu",
  "__pycache__", ".venv", "venv",
]);

const ALLOW_DOT = new Set<string>(); // empty in v1, extension point

const BUILD_FILES = new Set([
  "build.gradle", "build.gradle.kts",
  "settings.gradle", "settings.gradle.kts",
  "gradle.properties",
]);

function isPruned(name: string): boolean {
  if (PRUNE.has(name)) return true;
  if (name.startsWith(".") && !ALLOW_DOT.has(name)) return true;
  return false;
}

export async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (isPruned(e.name)) continue;
        await recurse(join(dir, e.name));
      } else if (e.isFile()) {
        const full = join(dir, e.name);
        if (BUILD_FILES.has(e.name)) {
          out.push(full);
        } else if (basename(dir) === "gradle" && e.name.endsWith(".versions.toml")) {
          out.push(full);
        }
      }
    }
  }
  await recurse(root);
  return out.sort();
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Add `projects/walk-skip-defaults/` fixture** (per inventory) and a test that passes the fixture root to `walk()` and asserts the only located file is the seeded real `build.gradle.kts`.

- [ ] **Step 6: Commit**

```bash
git add src/discover/ test/fixtures/projects/walk-skip-defaults/
git commit -m "Discover build files with hardcoded prune list"
```

### Task 6.2: Repository declaration extractor

**Files:**
- Create: `src/discover/repos.ts`
- Create: `src/discover/repos.test.ts`

Extract URLs from `repositories { ... }` blocks in Groovy and Kotlin DSL. Recognize:
- `mavenCentral()` → `https://repo.maven.apache.org/maven2/`
- `google()` → `https://maven.google.com/`
- `gradlePluginPortal()` → `https://plugins.gradle.org/m2/`
- `mavenLocal()` → ignored (local)
- `maven { url '...' }` / `maven("...")` → use the literal URL
- `maven { url = uri('...') }` → same

Returns `string[]` of URLs.

- [ ] **Step 1: Tests** for each known shorthand and `maven { url ... }` form.

- [ ] **Step 2: Implement.** Use the existing tokenizers; scan token streams for the patterns. (Don't write a separate parser; reuse Groovy/Kotlin tokenizers.)

- [ ] **Step 3: Run — expect PASS.**

- [ ] **Step 4: Commit**

```bash
git commit -m "Extract repository URLs from build files"
```

---

## Phase 7 — Repo client

### Task 7.1: Maven metadata fetch + parse

**Files:**
- Create: `src/repos/metadata.ts`
- Create: `src/repos/metadata.test.ts`

Parses `<metadata>` XML from `<repo>/<group-as-path>/<artifact>/maven-metadata.xml`. Returns `{ versions: string[]; lastUpdated?: string }`. Uses `fast-xml-parser`.

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { parseMavenMetadata, gavToMetadataPath } from "./metadata";

describe("parseMavenMetadata", () => {
  it("extracts versions and lastUpdated", () => {
    const xml = `<?xml version="1.0"?>
<metadata>
  <groupId>org.foo</groupId>
  <artifactId>bar</artifactId>
  <versioning>
    <latest>2.0.0</latest>
    <release>2.0.0</release>
    <versions>
      <version>1.0.0</version>
      <version>1.5.0</version>
      <version>2.0.0</version>
    </versions>
    <lastUpdated>20260420101530</lastUpdated>
  </versioning>
</metadata>`;
    const m = parseMavenMetadata(xml);
    expect(m.versions).toEqual(["1.0.0", "1.5.0", "2.0.0"]);
    expect(m.lastUpdated).toBe("20260420101530");
  });
});

describe("gavToMetadataPath", () => {
  it("converts dots to slashes in group", () => {
    expect(gavToMetadataPath("org.foo.bar", "lib")).toBe("org/foo/bar/lib/maven-metadata.xml");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/repos/metadata.ts
import { XMLParser } from "fast-xml-parser";

export type MavenMetadata = { versions: string[]; lastUpdated?: string };

const parser = new XMLParser({ ignoreAttributes: true });

export function parseMavenMetadata(xml: string): MavenMetadata {
  const obj = parser.parse(xml);
  const v = obj?.metadata?.versioning;
  if (!v) return { versions: [] };
  let versions = v.versions?.version;
  if (!versions) versions = [];
  if (!Array.isArray(versions)) versions = [versions];
  return { versions: versions.map(String), lastUpdated: v.lastUpdated ? String(v.lastUpdated) : undefined };
}

export function gavToMetadataPath(group: string, artifact: string): string {
  return `${group.replace(/\./g, "/")}/${artifact}/maven-metadata.xml`;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git commit -m "Parse maven-metadata.xml"
```

### Task 7.2: HTTP client with on-disk cache

**Files:**
- Create: `src/repos/cache.ts`
- Create: `src/repos/client.ts`
- Create: `src/repos/client.test.ts`
- Create: `test/helpers/mock-repo.ts`

Cache: keyed by URL hash, stored under `~/.gcu/cache/`. `maven-metadata.xml` entries have a 1-hour TTL. Per-version timestamps cached forever.

Client:
- `fetchMetadata(repoUrl, group, artifact, options): Promise<MavenMetadata>` — joins URL, hits cache, falls back to network via `undici`, writes cache.
- Auth: takes a credentials map (loaded by config layer); resolves longest-prefix and adds `Authorization` header.
- `noCache: true` bypasses reads (still writes? No — bypass entirely).
- Network errors after 3 retries with exponential backoff (100ms, 400ms, 1600ms) → throws `RepoNetworkError`. CLI maps this to exit code 4.

`test/helpers/mock-repo.ts`: an in-memory mock that replaces the HTTP client during tests. Tests **must fail loudly if the real `undici.request` is reached.**

- [ ] **Step 1: Implement mock harness**

```ts
// test/helpers/mock-repo.ts
import { vi } from "vitest";

type MockResponse = { status: number; body: string };
const responses = new Map<string, MockResponse>();

export function mockRepo(map: Record<string, string | MockResponse>) {
  responses.clear();
  for (const [url, val] of Object.entries(map)) {
    responses.set(url, typeof val === "string" ? { status: 200, body: val } : val);
  }
}

vi.mock("undici", () => ({
  request: async (url: string) => {
    const r = responses.get(url);
    if (!r) throw new Error(`mock-repo: unexpected request to ${url}`);
    return {
      statusCode: r.status,
      body: { text: async () => r.body },
    };
  },
  Agent: class {},
}));
```

- [ ] **Step 2: Tests for cache**

```ts
// src/repos/cache.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "./cache";

describe("Cache", () => {
  it("misses on unset key, hits after set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-cache-"));
    const c = new Cache(dir);
    expect(await c.get("k", 60_000)).toBeUndefined();
    await c.set("k", "v");
    expect(await c.get("k", 60_000)).toBe("v");
  });
  it("expires on TTL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcu-cache-"));
    const c = new Cache(dir);
    await c.set("k", "v");
    expect(await c.get("k", 0)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement Cache**

```ts
// src/repos/cache.ts
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export class Cache {
  constructor(private readonly dir: string) {}
  private keyPath(key: string): string {
    return join(this.dir, createHash("sha256").update(key).digest("hex"));
  }
  async get(key: string, ttlMs: number): Promise<string | undefined> {
    const p = this.keyPath(key);
    try {
      const s = await stat(p);
      if (Date.now() - s.mtimeMs > ttlMs) return undefined;
      return await readFile(p, "utf8");
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.keyPath(key), value, "utf8");
  }
}
```

- [ ] **Step 4: Implement client + tests**

```ts
// src/repos/client.ts
import { request } from "undici";
import { Cache } from "./cache";
import { parseMavenMetadata, type MavenMetadata, gavToMetadataPath } from "./metadata";

export type RepoCredentials =
  | { username: string; password: string }
  | { token: string };

export type ClientOptions = {
  cache: Cache;
  credentials?: Map<string, RepoCredentials>; // key = repo URL prefix
  noCache?: boolean;
  metadataTtlMs?: number;
};

export class RepoNetworkError extends Error {
  constructor(message: string, readonly url: string) { super(message); }
}

function pickCreds(repoUrl: string, creds?: Map<string, RepoCredentials>) {
  if (!creds) return undefined;
  let best: { len: number; v: RepoCredentials } | undefined;
  for (const [prefix, v] of creds) {
    if (repoUrl.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, v };
  }
  return best?.v;
}

function authHeader(c: RepoCredentials | undefined): Record<string, string> {
  if (!c) return {};
  if ("token" in c) return { authorization: `Bearer ${c.token}` };
  return { authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}` };
}

export async function fetchMetadata(
  repoUrl: string,
  group: string,
  artifact: string,
  opts: ClientOptions,
): Promise<MavenMetadata> {
  const ttl = opts.metadataTtlMs ?? 60 * 60 * 1000;
  const url = repoUrl.replace(/\/?$/, "/") + gavToMetadataPath(group, artifact);
  if (!opts.noCache) {
    const hit = await opts.cache.get(url, ttl);
    if (hit !== undefined) return parseMavenMetadata(hit);
  }
  const headers = authHeader(pickCreds(repoUrl, opts.credentials));
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(url, { headers });
      if (res.statusCode === 404) return { versions: [] };
      if (res.statusCode >= 400) throw new RepoNetworkError(`HTTP ${res.statusCode}`, url);
      const body = await res.body.text();
      if (!opts.noCache) await opts.cache.set(url, body);
      return parseMavenMetadata(body);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 100 * Math.pow(4, attempt)));
    }
  }
  throw new RepoNetworkError(`Failed after retries: ${(lastErr as Error)?.message}`, url);
}
```

- [ ] **Step 5: Tests for client**

```ts
// src/repos/client.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockRepo } from "../../test/helpers/mock-repo";
import { Cache } from "./cache";
import { fetchMetadata } from "./client";

describe("fetchMetadata", () => {
  let cache: Cache;
  beforeEach(async () => {
    cache = new Cache(await mkdtemp(join(tmpdir(), "gcu-c-")));
  });
  it("hits the mock and parses", async () => {
    mockRepo({
      "https://repo/org/foo/bar/maven-metadata.xml": `<metadata><versioning><versions><version>1.0</version><version>2.0</version></versions></versioning></metadata>`,
    });
    const m = await fetchMetadata("https://repo/", "org.foo", "bar", { cache });
    expect(m.versions).toEqual(["1.0", "2.0"]);
  });
  it("returns empty versions on 404", async () => {
    mockRepo({ "https://repo/x/y/maven-metadata.xml": { status: 404, body: "" } });
    const m = await fetchMetadata("https://repo/", "x", "y", { cache });
    expect(m.versions).toEqual([]);
  });
});
```

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: Commit**

```bash
git add src/repos/ test/helpers/mock-repo.ts
git commit -m "Add Maven metadata HTTP client with cache and auth"
```

### Task 7.3: Per-version timestamp lookup

**Files:**
- Modify: `src/repos/client.ts`
- Modify: `src/repos/client.test.ts`

Adds `fetchVersionTimestamp(repoUrl, group, artifact, version, opts)`. Strategy per BOOTSTRAP.md §"Fetching version metadata":
1. If we have `lastUpdated` for this version somewhere in the metadata, use it. (Maven metadata generally only has one `lastUpdated`; per-version timestamps live in per-version directories.)
2. Else issue a HEAD on `<repo>/<group>/<artifact>/<version>/<artifact>-<version>.pom` and read `Last-Modified`.
3. Cache the resolved timestamp **forever** (no TTL).

- [ ] **Step 1: Tests** (mock 200 with `Last-Modified` header).

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Commit**

```bash
git commit -m "Add per-version publish-timestamp lookup"
```

---

## Phase 8 — Config

### Task 8.1: Zod schemas for config & credentials

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/schema.test.ts`

- [ ] **Step 1: Implement schemas**

```ts
// src/config/schema.ts
import { z } from "zod";

export const ProjectConfigSchema = z.object({
  target: z.enum(["major", "minor", "patch"]).optional(),
  pre: z.boolean().optional(),
  cooldown: z.number().int().min(0).optional(),
  allowDowngrade: z.boolean().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  repos: z.array(z.string().url()).optional(),
  noAutoRepos: z.boolean().optional(),
  cacheDir: z.string().optional(),
  noCache: z.boolean().optional(),
}).strict();
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const CredentialEntrySchema = z.union([
  z.object({ username: z.string().min(1), password: z.string().min(1) }).strict(),
  z.object({ token: z.string().min(1) }).strict(),
]);

export const CredentialsFileSchema = z.record(z.string().url(), CredentialEntrySchema);
export type CredentialsFile = z.infer<typeof CredentialsFileSchema>;
```

- [ ] **Step 2: Tests** — happy path, unknown-key rejection, both auth modes set rejection, missing-field error messages naming field.

- [ ] **Step 3: Run — expect PASS.**

- [ ] **Step 4: Commit**

```bash
git commit -m "Add Zod schemas for config and credentials"
```

### Task 8.2: Multi-config resolver

**Files:**
- Create: `src/config/resolve.ts`
- Create: `src/config/resolve.test.ts`
- Create: `test/fixtures/projects/multi-config/{root-only,submodule-override,properties-at-root,catalog-adjacent}/...`

Per BOOTSTRAP.md §"Multi-config overrides" (chained inheritance):
- Each `Occurrence` collects all `.gcu.json` files from project root down to `dirname(file)` and merges outermost-first (innermost wins per field).
- Catalog rule: `gradle/libs.versions.toml` walks up from the parent of `gradle/`.
- Memoize `directory → fully-merged ResolvedConfig` so the walk runs once per directory.
- Merge: CLI flags > chained project configs (outermost→innermost) > user `~/.gcu/config.json` > defaults.

- [ ] **Step 1: Tests** — one test per fixture above:
  - `root-only`: every Occurrence resolves to the same root config.
  - `submodule-override`: Occurrences inside `submodule/` get the submodule config; Occurrences at root get the root config.
  - `properties-at-root`: a `gradle.properties` at root consumed by both root and submodule resolves to the root config (since the literal lives at root, the upward walk starts from root).
  - `catalog-adjacent`: a `.gcu.json` next to the `gradle/` folder governs `libs.versions.toml`.

- [ ] **Step 2: Implement resolver** with directory-walk memoization.

```ts
// src/config/resolve.ts (sketch)
import { readFile, stat } from "node:fs/promises";
import { dirname, join, parse as parsePath } from "node:path";
import { ProjectConfigSchema, type ProjectConfig } from "./schema";

const CONFIG_NAMES = [".gcu.json", ".gcu.json5"];

export class ConfigResolver {
  private cache = new Map<string, ProjectConfig | null>();
  private readonly stopAt: string;
  constructor(projectRoot: string, private readonly userConfig: ProjectConfig | undefined) {
    this.stopAt = parsePath(projectRoot).root;
  }
  /** Returns the merged effective config for an Occurrence's literal path. */
  async resolveForFile(filePath: string, isCatalogToml = false): Promise<ProjectConfig> {
    let dir = isCatalogToml ? dirname(dirname(filePath)) : dirname(filePath);
    const project = await this.findProjectConfig(dir);
    return mergeConfig(this.userConfig ?? {}, project ?? {});
  }
  private async findProjectConfig(startDir: string): Promise<ProjectConfig | null> {
    let dir = startDir;
    while (true) {
      if (this.cache.has(dir)) return this.cache.get(dir)!;
      const found = await this.tryLoadAt(dir);
      if (found) { this.cache.set(dir, found); return found; }
      this.cache.set(dir, null);
      const parent = dirname(dir);
      if (parent === dir || dir === this.stopAt) return null;
      dir = parent;
    }
  }
  private async tryLoadAt(dir: string): Promise<ProjectConfig | null> {
    for (const name of CONFIG_NAMES) {
      const p = join(dir, name);
      try {
        const text = await readFile(p, "utf8");
        const parsed = JSON.parse(text);
        return ProjectConfigSchema.parse(parsed);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
    }
    return null;
  }
}

function mergeConfig(user: ProjectConfig, project: ProjectConfig): ProjectConfig {
  return { ...user, ...project };
}
```

- [ ] **Step 3: Run — expect PASS.**

- [ ] **Step 4: Commit**

```bash
git add src/config/ test/fixtures/projects/multi-config/
git commit -m "Resolve per-Occurrence config via upward walk"
```

### Task 8.3: Credentials loader with `$` env-var indirection

**Files:**
- Create: `src/config/credentials.ts`
- Create: `src/config/credentials.test.ts`

Reads `~/.gcu/credentials.json`, validates with `CredentialsFileSchema`, resolves `$VARNAME` from `process.env`. Missing env var → throw `ConfigError` (CLI exits 2).

On Unix, if file mode isn't `0600`, print a warning on first read (non-fatal).

- [ ] **Step 1: Tests** — happy path with literal password; with `$NEXUS_PASSWORD` resolved from `process.env`; missing env var fails; `username`+`token` in same entry fails.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Commit**

```bash
git commit -m "Load credentials.json with env-var indirection"
```

---

## Phase 9 — Policy pipeline

### Task 9.1: Track filter (stage 1)

**Files:**
- Create: `src/policy/track.ts`
- Create: `src/policy/track.test.ts`

Per BOOTSTRAP.md §"Update policy" stage 1.

- [ ] **Step 1: Tests** — current=stable filters out prerelease; current=prerelease keeps both; `--pre` forces include of prereleases regardless.

- [ ] **Step 2: Implement.**

```ts
// src/policy/track.ts
import { isStable, isPrerelease, isSnapshot } from "../version/shape";

export function trackFilter(current: string, candidates: string[], opts: { pre?: boolean }): string[] {
  if (opts.pre) return candidates;
  if (isStable(current)) return candidates.filter(c => isStable(c));
  // current is prerelease or snapshot → keep newer prereleases AND newer stables
  return candidates.filter(c => isStable(c) || isPrerelease(c) || isSnapshot(c));
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "Add track filter (stage 1)"
```

### Task 9.2: Cooldown filter (stage 2)

**Files:**
- Create: `src/policy/cooldown.ts`
- Create: `src/policy/cooldown.test.ts`

Drops candidates published within the last N days. Takes a `(version) => Date | null` lookup the orchestrator wires up against `fetchVersionTimestamp`.

- [ ] **Step 1: Tests.**
- [ ] **Step 2: Implement.**

```ts
export function cooldownFilter(
  candidates: string[],
  publishedAt: (v: string) => Date | undefined,
  cooldownDays: number,
  now: Date,
): string[] {
  if (cooldownDays <= 0) return candidates;
  const cutoff = now.getTime() - cooldownDays * 86_400_000;
  return candidates.filter(v => {
    const t = publishedAt(v);
    if (!t) return true; // unknown timestamp → don't filter
    return t.getTime() <= cutoff;
  });
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "Add cooldown filter (stage 2)"
```

### Task 9.3: Include/exclude filter (stage 3)

**Files:**
- Create: `src/policy/filter.ts`
- Create: `src/policy/filter.test.ts`

`--include` and `--exclude` accept strings, globs (via `picomatch`), or `/regex/` (delimited with slashes). Match against `group:artifact`. Repeatable; semantics: include = OR; exclude = OR; an Occurrence passes if (no include, or matches any include) AND (no exclude, or matches none).

- [ ] **Step 1: Tests** for all three syntaxes and combination semantics.
- [ ] **Step 2: Implement** using `picomatch`. For `/regex/`, slice slashes and `new RegExp(...)`.
- [ ] **Step 3: Commit**

```bash
git commit -m "Add include/exclude filter (stage 3)"
```

### Task 9.4: Target ceiling (stage 4) and never-downgrade invariant

**Files:**
- Create: `src/policy/target.ts`
- Create: `src/policy/target.test.ts`

- [ ] **Step 1: Tests** — `1.+` under `--target patch` does not bump to `2.+`; `1.2.3` under `--target minor` keeps minor and patch but not major.
- [ ] **Step 2: Implement** using `withinTarget` from Phase 2.
- [ ] **Step 3: Commit**

```bash
git commit -m "Add target ceiling (stage 4)"
```

### Task 9.5: Per-shape eligibility & shape-specific writers

**Files:**
- Create: `src/policy/shape-rules.ts`
- Create: `src/policy/shape-rules.test.ts`

Per BOOTSTRAP.md §"Per-shape rewrite behavior":
- `snapshot`, `latestQualifier`, `mavenRange`, `richReject` → never write.
- `richStrictly` → write only if value is a single version, else report.
- `prefix` → preserve depth.
- `strictlyShorthand` → preserve `!!`.
- `strictlyPreferShort` → write new range + new prefer; range bounds shifted to enclose new prefer; halves stay coherent.

`shape-rules.ts` exposes `isEligible(shape)` and `renderReplacement(occurrence, newWinner): string`.

- [ ] **Step 1: Tests** — one per shape, asserting both eligibility and replacement string.
- [ ] **Step 2: Implement.**

```ts
// Sketch: renderReplacement for strictlyPreferShort
//   raw = "[1.7,1.8)!!1.7.25"; winner = "2.0.1"
//   → "[2.0,2.1)!!2.0.1" (compute the next-minor upper bound from winner's tokens)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "Add per-shape eligibility and replacement rendering"
```

### Task 9.6: Coherence rule for rich blocks

**Files:**
- Create: `src/policy/coherence.ts`
- Create: `src/policy/coherence.test.ts`

Group Occurrences by `dependencyKey`. For groups with `@<blockId>`:
- Pick winner using strongest constraint (`strictly` > `require` > `prefer`).
- Bump siblings to match.
- If a `reject` would now match the winner → abort the block, emit `Decision { status: "conflict" }` for the group.

- [ ] **Step 1: Tests** — three scenarios: simple coherent bump, reject-conflict abort, no rich block (no-op).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Add rich-block coherence rule"
```

### Task 9.7: Shared-variable disagreement

**Files:**
- Create: `src/policy/shared-var.ts`
- Create: `src/policy/shared-var.test.ts`

After per-Occurrence policy runs, collect Occurrences that share the same canonical edit site `(file, byteStart)` (i.e., consumers pointing at the same `gradle.properties` value or `[versions]` entry). Take the **lowest** of the per-dep winners; emit a warning naming the dep that constrained the choice.

- [ ] **Step 1: Tests** — using `refs/shared-variable-disagreement/` fixture: two consumers, different winners, lowest wins, warning text contains the constraining dep.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Resolve shared-variable disagreement to lowest winner"
```

### Task 9.8: Allow-downgrade escape hatch

**Files:**
- Create: `src/policy/downgrade.ts`
- Create: `src/policy/downgrade.test.ts`
- Create: `test/fixtures/projects/cooldown-allow-downgrade/...`

Per BOOTSTRAP.md §"--allow-downgrade":
1. CLI rejects bare `--allow-downgrade` (no `--cooldown`) with exit 2 (handled in CLI layer, but unit-test the policy guard too).
2. If after stage 2 nothing `≥ current` survives AND the current version is itself inside the cooldown window → may select highest cooldown-eligible candidate strictly below current.

- [ ] **Step 1: Tests** — exact worked example from BOOTSTRAP.md (current `2.0.21` 3d old, candidates `2.0.20` 10d, `2.0.10` 40d, cooldown 7d → pick `2.0.20`).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Add allow-downgrade cooldown escape hatch"
```

### Task 9.9: Policy orchestrator

**Files:**
- Create: `src/policy/index.ts`
- Create: `src/policy/index.test.ts`

Composes stages 1–6 + coherence + shared-var + downgrade. Input: `Occurrence[]`, repo metadata accessor, effective config per Occurrence. Output: `Decision[]`.

- [ ] **Step 1: Integration-style tests** running through full pipeline against synthetic Occurrences.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Compose policy pipeline"
```

---

## Phase 10 — Report renderers

### Task 10.1: Byte-offset → line/column helper

**Files:**
- Create: `src/report/byteOffsetToLineCol.ts`
- Create: `src/report/byteOffsetToLineCol.test.ts`

Caches file contents for the run. Computes `(line, column)` from `byteStart`.

- [ ] **Step 1: Tests** including CRLF-safe handling.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Add byte-offset to line/column helper"
```

### Task 10.2: Table renderer

**Files:**
- Create: `src/report/table.ts`
- Create: `src/report/table.test.ts`

Per BOOTSTRAP.md §"Default (table) output". Group dependencies by file then by group; group with 2+ siblings becomes a tree, single-dep group renders flat. Color via `kleur`; auto-disabled when `process.stdout.isTTY` is falsy. ASCII fallback for arrows and tree glyphs in non-TTY mode.

- [ ] **Step 1: Snapshot tests**:
  - Tree-grouping with 3 deps in same group.
  - Single-dep flat fallback.
  - Held-by-target annotation.
  - Downgrade row with `↓` and magenta color.
  - Non-TTY mode: ASCII glyphs `->`, `v`, `|--`, `\\--`.
  - TTY mode: ANSI color codes present (test by mocking `process.stdout.isTTY`).

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Commit**

```bash
git commit -m "Add table renderer with tree grouping and color"
```

### Task 10.3: JSON renderer

**Files:**
- Create: `src/report/json.ts`
- Create: `src/report/json.test.ts`

Output the schema in BOOTSTRAP.md §"--json output". Only post-policy winners; `direction: "down"` only when `--allow-downgrade` triggered the choice.

- [ ] **Step 1: Tests** — empty updates `{updates: []}`; multi-entry; downgrade case includes `direction: "down"`; up case omits direction.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Add JSON renderer"
```

### Task 10.4: Interactive picker

**Files:**
- Create: `src/report/interactive.ts`
- Create: `src/report/interactive.test.ts`

Uses `@inquirer/prompts` `checkbox`. In `NODE_ENV=test`, expose a non-interactive path that takes a pre-chosen selection (so tests can snapshot the post-selection result).

- [ ] **Step 1: Tests** — non-interactive path with selected indices.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Add interactive picker"
```

---

## Phase 11 — CLI orchestration

### Task 11.1: Argument parsing with `cac`

**Files:**
- Create: `src/cli/args.ts`
- Create: `src/cli/args.test.ts`

Define every flag from BOOTSTRAP.md §"Flags". Note the renames: `-i, --include` (NOT `--filter`), `-x, --exclude` (NOT `--skip`), `--interactive` long-form only.

- [ ] **Step 1: Tests** — defaults, repeatable flags, `--allow-downgrade` without `--cooldown` returns a usage error.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Add CLI argument parser"
```

### Task 11.2: End-to-end orchestrator

**Files:**
- Modify: `src/cli/index.ts`
- Create: `src/cli/run.ts`
- Create: `src/cli/run.test.ts`

Wires every stage together:

1. Parse args + load configs.
2. Walk the project, run each format's locator, collect all `Occurrence`s.
3. Resolve refs (Phase 5).
4. Discover repos from build files (Phase 6.2), merge with `--repo` and built-in defaults; honor `--no-auto-repos`.
5. For each unique `(group, artifact)`, fetch metadata across all repos in declared order; aggregate the union of versions.
6. For each Occurrence, resolve the per-Occurrence config (Phase 8.2), then run the policy pipeline.
7. Render report (table | JSON | interactive). When `--json`, all human output goes to **stderr**.
8. If `-u` (or post-interactive selection), apply edits via the rewriter (Phase 3).
9. Exit with the right code (table from BOOTSTRAP.md §"Exit codes").

- [ ] **Step 1: Tests** — small end-to-end test with mocked repo and a tmpdir project; verify table output, JSON output, `-u` writes file byte-cleanly.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Wire bin** — confirm `dist/index.js` shebangs and runs.
- [ ] **Step 4: Commit**

```bash
git commit -m "Orchestrate end-to-end CLI flow"
```

### Task 11.3: Exit-code handling

**Files:**
- Modify: `src/cli/run.ts`
- Create: `src/cli/exit.ts`
- Create: `src/cli/exit.test.ts`

Map errors to exit codes:
- `0` clean.
- `1` outdated when `--error-on-outdated` and `-u` not passed and any upgrade available.
- `2` usage / config / credentials validation errors (Zod errors thrown anywhere).
- `3` parse error from format locators (catch unresolved-ref errors, locator throws).
- `4` `RepoNetworkError`.
- `5` rich-block coherence conflict.

- [ ] **Step 1: Tests** — one test per code.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Map errors to exit codes"
```

---

## Phase 12 — End-to-end integration & polish

### Task 12.1: Multi-module fixture

**Files:**
- Create: `test/fixtures/projects/multi-module/...`
- Create: `test/integration/multi-module.test.ts`

Realistic project: `settings.gradle.kts` + 3 modules + `libs.versions.toml` + `gradle.properties` consumed by 2 modules. Run `gcu` end-to-end with mocked repo, verify table + JSON outputs and `-u` byte-clean rewrite.

- [ ] **Step 1: Build the fixture.**
- [ ] **Step 2: Tests covering preview mode, `-u` mode, `--target patch`, `--include` filter.**
- [ ] **Step 3: Run — expect PASS.**
- [ ] **Step 4: Commit**

```bash
git commit -m "Add multi-module integration fixture"
```

### Task 12.2: Cooldown-stairstep fixture

**Files:**
- Create: `test/fixtures/projects/cooldown-stairstep/...`
- Create: `test/integration/cooldown-stairstep.test.ts`

Mocked repo with timestamps; assert pipeline picks highest non-blocked version (per BOOTSTRAP.md §"Cooldown behavior — worked example").

- [ ] **Step 1: Build fixture; assert outputs.**
- [ ] **Step 2: Commit**

```bash
git commit -m "Add cooldown-stairstep integration test"
```

### Task 12.3: Pre-track and target-major-minor-patch fixtures

**Files:**
- Create: `test/fixtures/projects/{pre-track,target-major-minor-patch}/...`
- Create: corresponding integration tests

- [ ] **Step 1: Build fixtures.**
- [ ] **Step 2: Tests** — `target-major-minor-patch` runs the same project three times with different `--target` flags and asserts three different outputs.
- [ ] **Step 3: Commit**

```bash
git commit -m "Add pre-track and target ceiling integration tests"
```

### Task 12.4: Config validation integration

**Files:**
- Create: `test/fixtures/config/{invalid-unknown-key,invalid-credentials-both-modes}/...`
- Create: `test/integration/config-validation.test.ts`

Run the CLI against fixtures with a malformed `.gcu.json` / `credentials.json`; assert exit code `2` and that the error message names the file and field.

- [ ] **Step 1: Tests, fixtures, implement any plumbing missed.**
- [ ] **Step 2: Commit**

```bash
git commit -m "Add config validation integration tests"
```

### Task 12.5: No-network safety

**Files:**
- Modify: `vitest.config.ts` or add `test/setup.ts`

Add a global setup that throws if any test tries to make a real outbound HTTP request not routed through the mock. Trip wire: monkey-patch `undici.request` in setup; verify the mock harness unmocks correctly.

- [ ] **Step 1: Implement setup file with global guard.**
- [ ] **Step 2: Add a test that intentionally tries an unmocked URL and asserts the guard fires.**
- [ ] **Step 3: Commit**

```bash
git commit -m "Enforce no-network safety in tests"
```

### Task 12.6: Coverage thresholds

**Files:**
- Modify: `vitest.config.ts`

Add coverage thresholds for `version/`, `policy/`, `rewrite/`, `config/`, and each format locator (≥85% lines, ≥85% branches per directory).

- [ ] **Step 1: Run `pnpm test --coverage`; raise thresholds to current observed level minus 2pp.**
- [ ] **Step 2: Commit**

```bash
git commit -m "Add per-directory coverage thresholds"
```

### Task 12.7: README + manual sanity run

**Files:**
- Create: `README.md`
- Verify: `node dist/index.js .` against this repo

- [ ] **Step 1: Build**: `pnpm build`. Verify `dist/index.js` exists.
- [ ] **Step 2: Run dry**: `node dist/index.js .` — should produce a table or "no upgrades available" depending on what's listed.
- [ ] **Step 3: Run with `-u`**: `node dist/index.js -u .`. Inspect `git diff` — only version-string bytes should change.
- [ ] **Step 4: Write a brief `README.md`** linking to `docs/BOOTSTRAP.md` for the spec, with install + quick-start + flag table summarised.
- [ ] **Step 5: Commit**

```bash
git commit -m "Add README and verify end-to-end on this repo"
```

### Task 12.8: Final sweep

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test && pnpm build && pnpm format`. All green.
- [ ] **Step 2: Verify** every fixture under BOOTSTRAP.md §"Test fixture inventory" exists and is exercised by at least one test.
- [ ] **Step 3: Run** `node dist/index.js --help`. Verify every flag from §"Flags" is present and labeled.
- [ ] **Step 4: Run** `node dist/index.js --json . 2>/dev/null | jq .` against this repo. Verify clean JSON on stdout.
- [ ] **Step 5: Commit any small fixes; tag a v0.1.0 release branch.**

```bash
git commit -m "Final sweep: typecheck, tests, build, format all green"
```

---

## Notes for the implementer

- **DRY across locators:** `splitGav`, `charIndexToByte`, `depKey`, and the version-shape detector should be the only places GAV/version logic lives. Locators describe what to scan for; they should not re-derive shape.
- **YAGNI:** v1 is `gradle.properties`, Groovy DSL, Kotlin DSL, version catalog. No `.gcuignore`, no `--no-color`, no XDG, no general-purpose TOML library, no AST. Stick to the spec.
- **TDD:** every task above puts the failing test first. Don't skip — the locators in particular are easy to get subtly wrong on byte offsets, and the tests catch that.
- **Frequent commits:** commit at the end of each task (one logical change per commit). Conventional message style (`feat:`, `fix:`, `chore:`) matches existing repo history.
- **Spec is the truth:** when this plan and `docs/BOOTSTRAP.md` disagree, BOOTSTRAP.md wins. Open an issue, then update the plan.

## Phasing flexibility

If you'd rather break this into separate plans per phase (each producing testable software on its own), the natural seams are:

- **Plan A** — Phases 1–3: types, version core, rewriter (no I/O, no CLI; pure foundation).
- **Plan B** — Phase 4: format locators (against fixtures, no orchestration).
- **Plan C** — Phases 5–7: refs, discovery, repo client (everything except policy and CLI).
- **Plan D** — Phases 8–9: config + policy.
- **Plan E** — Phases 10–12: report, CLI, integration.

Each plan would deliver tested, mergeable code; later plans build on earlier-plan exports.

---

## Phase 13 — Settings.gradle.kts full support + real-project-mix tests

**Branch:** `feat/settings-and-real-project-mix`

Added full `settings.gradle(.kts)` awareness across the pipeline, plus a comprehensive integration test suite against a realistic multi-module Kotlin/Spring project fixture.

- **Phase A — Settings parser** (`src/discover/settings.ts`): New module using the kotlin-dsl tokenizer to parse `settings.gradle(.kts)`. Extracts: `versionCatalogs { create("name") { from(files("path")) } }` → resolved absolute catalog paths; `pluginManagement { repositories { ... } }` and `dependencyResolutionManagement { repositories { ... } }` → plugin/dependency repository URLs; `pluginManagement { plugins { ... } }` → byte ranges of the inner plugins block. `from("group:artifact:version")` published coordinates are silently ignored (v1 limitation). Public API: `parseSettingsFile(filePath): Promise<SettingsParseResult>`.

- **Phase B — Walker integration** (`src/discover/walk.ts`): Return type changed to `WalkResult = { files: DiscoveredFile[], settingsRepositories: string[] }`. After the walk, settings files are parsed via `parseSettingsFile`; catalog files declared via `versionCatalogs {}` that exist on disk are added with `isCatalogToml: true`. Non-standard catalog paths (e.g. `gradle/libs/versions.toml`) are correctly discovered.

- **Phase C — Repo wiring** (`cli/run.ts`): `walk()` now returns `settingsRepositories` (deduplicated union of pluginManagement and dependencyResolutionManagement repos). `run.ts` wires these into the final repo list, respecting `--no-auto-repos`.

- **Phase D — Plugin block tagging** (`src/formats/kotlin-dsl/locate.ts`): When the file is `settings.gradle.kts`, `pluginManagement { plugins { id(...) version "..." } }` occurrences are tagged with `via: ["pluginManagement"]` for reporting clarity. Top-level `plugins {}` in settings still works without a tag. Also added `"force"` to `DEPENDENCY_CONFIG_NAMES` so `force("group:artifact:version")` calls in `resolutionStrategy` blocks are detected and updated.

- **Phase E — Integration tests** (`test/integration/real-project-mix.test.ts`): Six test cases covering: non-standard catalog path discovery via settings, `force()` detection in root build file, module `version = "1.0.0-SNAPSHOT"` exclusion (project versions not updated), apply mode (`-u`) byte-precision, `--include` filter scoping, and settings repository discovery validation. All HTTP mocked via `test/helpers/mock-repo.ts`; tests fail loudly on any real network call.

- **Phase F — Documentation** (`docs/BOOTSTRAP.md`, `CLAUDE.md`, this plan): Added "Settings.gradle.kts handling" section to BOOTSTRAP.md covering version catalog discovery, repository discovery, plugin occurrence detection, and v1 limitations. Added `version-catalog/real-project-mix/` to the test fixture inventory. Updated CLAUDE.md discovery skip list and tech stack sections.
