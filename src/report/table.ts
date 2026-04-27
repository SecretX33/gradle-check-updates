import { relative } from "node:path";
import kleur from "kleur";
import type { Decision } from "../types.js";
import { bumpKind, type BumpKind } from "../version/diff.js";

function colorizeVersion(
  version: string,
  severity: BumpKind,
  isDowngrade: boolean,
): string {
  if (isDowngrade) return kleur.magenta(version);
  switch (severity) {
    case "patch":
      return kleur.green(version);
    case "minor":
      return kleur.cyan(version);
    case "major":
      return kleur.red(version);
  }
}

function arrowGlyph(isDowngrade: boolean, isTTY: boolean): string {
  if (isDowngrade) return isTTY ? "↓" : "v";
  return isTTY ? "→" : "->";
}

function padRight(text: string, length: number): string {
  if (text.length >= length) return text;
  return text + " ".repeat(length - text.length);
}

function padLeft(text: string, length: number): string {
  if (text.length >= length) return text;
  return " ".repeat(length - text.length) + text;
}

export function formatDependencyName(group: string, artifact: string): string {
  if (artifact === `${group}.gradle.plugin`) return group;
  return `${group}:${artifact}`;
}

function formatFilePath(filePath: string, rootDir?: string): string {
  if (rootDir) {
    const rel = relative(rootDir, filePath).replace(/\\/g, "/");
    return rel.length <= filePath.length ? rel : filePath;
  }
  return filePath.replace(/\\/g, "/");
}

function groupByFile(decisions: Decision[]): Map<string, Decision[]> {
  const fileGroups = new Map<string, Decision[]>();
  for (const decision of decisions) {
    const filePath = decision.occurrence.file;
    if (!fileGroups.has(filePath)) fileGroups.set(filePath, []);
    fileGroups.get(filePath)!.push(decision);
  }
  return fileGroups;
}

export type VerboseLevel = 0 | 1 | 2;

function isVisible(decision: Decision, verboseLevel: VerboseLevel): boolean {
  if (decision.status === "upgrade") return true;
  if (decision.status === "held-by-target") return true;
  if (decision.status === "cooldown-blocked") return verboseLevel >= 1;
  if (decision.status === "no-change") {
    return decision.reason === "excluded" ? verboseLevel >= 1 : verboseLevel >= 2;
  }
  if (decision.status === "report-only" || decision.status === "conflict") {
    return verboseLevel >= 2;
  }
  return false;
}

function isDimmedRow(decision: Decision): boolean {
  return (
    decision.status === "held-by-target" ||
    decision.status === "cooldown-blocked" ||
    decision.status === "no-change" ||
    decision.status === "report-only" ||
    decision.status === "conflict"
  );
}

function computeAnnotation(decision: Decision): string {
  if (decision.status === "held-by-target") return "(held by --target)";
  if (decision.status === "cooldown-blocked") return "(held by cooldown)";
  if (decision.status === "no-change")
    return decision.reason === "excluded" ? "(excluded)" : "(up to date)";
  if (decision.status === "report-only") return "(report-only)";
  if (decision.status === "conflict") return "(conflict)";
  if (decision.direction === "down") return "(downgrade)";
  const severity = bumpKind(decision.occurrence.currentRaw, decision.newVersion ?? "");
  return `(${severity})`;
}

function resolveDisplayVersion(decision: Decision): string {
  if (decision.status === "held-by-target") {
    return (
      decision.latestAvailable ?? decision.newVersion ?? decision.occurrence.currentRaw
    );
  }
  if (decision.status === "cooldown-blocked") {
    return decision.latestAvailable ?? decision.occurrence.currentRaw;
  }
  if (decision.status === "no-change") {
    // Excluded deps: show currentRaw on both sides — there may be a newer version but
    // we're deliberately ignoring it, so showing latestAvailable would be misleading.
    if (decision.reason === "excluded") return decision.occurrence.currentRaw;
    return decision.latestAvailable ?? decision.occurrence.currentRaw;
  }
  if (decision.status === "report-only" || decision.status === "conflict") {
    return decision.latestAvailable ?? decision.occurrence.currentRaw;
  }
  return decision.newVersion ?? decision.occurrence.currentRaw;
}

function renderFileSection(
  filePath: string,
  fileDecisions: Decision[],
  isTTY: boolean,
  verboseLevel: VerboseLevel,
  rootDir?: string,
): string[] {
  const visibleDecisions = fileDecisions.filter((decision) =>
    isVisible(decision, verboseLevel),
  );
  if (visibleDecisions.length === 0) return [];

  const sorted = [...visibleDecisions].sort((a, b) => {
    const order = (d: Decision): number => {
      if (d.status === "no-change") return 5;
      if (d.status === "conflict") return 4;
      if (d.status === "report-only") return 3;
      if (d.status === "cooldown-blocked") return 2;
      if (d.status === "held-by-target") return 1;
      return 0;
    };
    const orderDiff = order(a) - order(b);
    if (orderDiff !== 0) return orderDiff;
    const nameA = formatDependencyName(a.occurrence.group, a.occurrence.artifact);
    const nameB = formatDependencyName(b.occurrence.group, b.occurrence.artifact);
    return nameA.localeCompare(nameB);
  });

  const names = sorted.map((d) =>
    formatDependencyName(d.occurrence.group, d.occurrence.artifact),
  );
  const displayVersions = sorted.map((d) => resolveDisplayVersion(d));

  const nameWidth = Math.max(...names.map((n) => n.length));
  const currentWidth = Math.max(...sorted.map((d) => d.occurrence.currentRaw.length));
  const newWidth = Math.max(...displayVersions.map((v) => v.length));

  const lines: string[] = [];
  lines.push(kleur.bold(`Checking ${formatFilePath(filePath, rootDir)}`));

  for (let index = 0; index < sorted.length; index++) {
    const decision = sorted[index]!;
    const name = names[index]!;
    const currentVer = decision.occurrence.currentRaw;
    const newVer = displayVersions[index]!;
    const isDowngrade = decision.direction === "down";

    const paddedName = padRight(name, nameWidth);
    const paddedCurrent = padLeft(currentVer, currentWidth);
    const versionPadding = " ".repeat(Math.max(0, newWidth - newVer.length));
    const arrow = kleur.dim(arrowGlyph(isDowngrade, isTTY));

    let coloredNewVer: string;
    if (isDimmedRow(decision)) {
      coloredNewVer = versionPadding + kleur.dim(newVer);
    } else {
      const severity = bumpKind(currentVer, newVer);
      coloredNewVer = versionPadding + colorizeVersion(newVer, severity, isDowngrade);
    }

    const annotation =
      verboseLevel >= 1 ? `  ${kleur.dim(computeAnnotation(decision))}` : "";
    lines.push(
      ` ${paddedName}  ${paddedCurrent}  ${arrow}  ${coloredNewVer}${annotation}`,
    );
  }

  return lines;
}

function buildSummaryLine(
  trueUpgradeCount: number,
  heldByTargetCount: number,
  cooldownBlockedCount: number,
  downgradeCount: number,
  upToDateCount: number,
  excludedCount: number,
  reportOnlyCount: number,
  conflictCount: number,
  verboseLevel: VerboseLevel,
  applied: boolean,
): string {
  const verb = applied ? "applied" : "available";
  const countParts: string[] = [];

  // Always emit an upgrade count, even when zero, unless there are only downgrades.
  if (trueUpgradeCount > 0 || downgradeCount === 0) {
    const label = trueUpgradeCount === 1 ? "upgrade" : "upgrades";
    countParts.push(`${trueUpgradeCount} ${label}`);
  }

  if (downgradeCount > 0) {
    const label = downgradeCount === 1 ? "downgrade" : "downgrades";
    countParts.push(`${downgradeCount} ${label}`);
  }

  const statusParts: string[] = [];
  if (heldByTargetCount > 0 && verboseLevel >= 1) {
    statusParts.push(`${heldByTargetCount} held by --target`);
  }
  if (cooldownBlockedCount > 0 && verboseLevel >= 1) {
    statusParts.push(`${cooldownBlockedCount} held by cooldown`);
  }
  if (excludedCount > 0 && verboseLevel >= 1) {
    statusParts.push(`${excludedCount} excluded`);
  }
  if (upToDateCount > 0 && verboseLevel >= 2) {
    statusParts.push(`${upToDateCount} up to date`);
  }
  if (reportOnlyCount > 0 && verboseLevel >= 2) {
    statusParts.push(`${reportOnlyCount} report-only`);
  }
  if (conflictCount > 0 && verboseLevel >= 2) {
    statusParts.push(`${conflictCount} in conflict`);
  }

  const countStr = countParts.length > 0 ? `${countParts.join(", ")} ${verb}` : "";
  const allParts = countStr ? [countStr, ...statusParts] : statusParts;
  return allParts.join(", ") + ".";
}

/**
 * Renders the full output for the given list of decisions.
 *
 * Color and Unicode glyphs are auto-enabled when `process.stdout.isTTY` is true.
 * Verbosity levels:
 *   0 — only `upgrade` and `held-by-target` rows are shown.
 *   1 — additionally surfaces `cooldown-blocked` rows and per-row annotations.
 *   2 — additionally surfaces every `no-change`, `report-only`, and `conflict` row,
 *       so users can confirm that detected dependencies are being processed.
 *
 * When `rootDir` is provided, file paths are rendered relative to it.
 */
export function renderTable(
  decisions: Decision[],
  verboseLevel: VerboseLevel = 0,
  rootDir?: string,
  upgrade = false,
): string {
  const isTTY = Boolean(process.stdout.isTTY);
  kleur.enabled = isTTY;

  let trueUpgradeCount = 0;
  let downgradeCount = 0;
  let heldByTargetCount = 0;
  let cooldownBlockedCount = 0;
  let upToDateCount = 0;
  let excludedCount = 0;
  let reportOnlyCount = 0;
  let conflictCount = 0;

  for (const decision of decisions) {
    if (decision.status === "upgrade") {
      if (decision.direction === "down") {
        downgradeCount++;
      } else {
        trueUpgradeCount++;
      }
    } else if (decision.status === "held-by-target") {
      heldByTargetCount++;
    } else if (decision.status === "cooldown-blocked") {
      cooldownBlockedCount++;
    } else if (decision.status === "no-change") {
      if (decision.reason === "excluded") {
        excludedCount++;
      } else {
        upToDateCount++;
      }
    } else if (decision.status === "report-only") {
      reportOnlyCount++;
    } else if (decision.status === "conflict") {
      conflictCount++;
    }
  }

  const outputParts: string[] = [];
  const fileGroups = groupByFile(decisions);
  let hasAnySections = false;

  for (const [filePath, fileDecisions] of fileGroups) {
    const fileLines = renderFileSection(
      filePath,
      fileDecisions,
      isTTY,
      verboseLevel,
      rootDir,
    );
    if (fileLines.length > 0) {
      outputParts.push("");
      outputParts.push(...fileLines);
      hasAnySections = true;
    }
  }

  if (hasAnySections) outputParts.push("");

  outputParts.push(
    buildSummaryLine(
      trueUpgradeCount,
      heldByTargetCount,
      cooldownBlockedCount,
      downgradeCount,
      upToDateCount,
      excludedCount,
      reportOnlyCount,
      conflictCount,
      verboseLevel,
      upgrade,
    ),
  );

  if (!upgrade && (trueUpgradeCount > 0 || downgradeCount > 0)) {
    outputParts.push(`Run with ${kleur.yellow("-u")} to apply.`);
  }

  return outputParts.join("\n");
}
