// src/cli/exit.ts

import type { Decision } from "../types.js";

export type RunResult =
  | { kind: "success"; decisions: Decision[] }
  | { kind: "error"; exitCode: number };

export function determineExitCode(
  decisions: Decision[],
  options: { upgradeMode: boolean; errorOnOutdated: boolean },
): number {
  if (decisions.some((decision) => decision.status === "conflict")) return 5;

  const hasUpgrades = decisions.some((decision) => decision.status === "upgrade");
  if (options.errorOnOutdated && !options.upgradeMode && hasUpgrades) return 1;

  return 0;
}
