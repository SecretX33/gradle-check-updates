import { checkbox } from "@inquirer/prompts";
import kleur from "kleur";
import type { Decision } from "../types.js";
import { bumpKind } from "../version/diff.js";
import { formatDependencyName } from "./table.js";

export type PickerResult = {
  selectedDecisions: Decision[];
};

export type PickerOptions = {
  /** In test mode, skip the actual prompt and use these pre-selected dependency keys. */
  preSelectedKeys?: string[];
};

function colorizeVersion(version: string, from: string, isDowngrade: boolean): string {
  if (isDowngrade) return kleur.magenta(version);
  switch (bumpKind(from, version)) {
    case "patch":
      return kleur.green(version);
    case "minor":
      return kleur.cyan(version);
    case "major":
      return kleur.red(version);
  }
}

function padRight(text: string, length: number): string {
  return text.length >= length ? text : text + " ".repeat(length - text.length);
}

function padLeft(text: string, length: number): string {
  return text.length >= length ? text : " ".repeat(length - text.length) + text;
}

/**
 * Run the interactive checkbox picker.
 * Returns the decisions the user selected (or the pre-selected ones when
 * `preSelectedKeys` is provided, bypassing any terminal prompt).
 */
export async function runInteractivePicker(
  decisions: Decision[],
  options?: PickerOptions,
): Promise<PickerResult> {
  const upgradeDecisions = decisions.filter((decision) => decision.status === "upgrade");

  for (const decision of upgradeDecisions) {
    if (decision.newVersion === undefined) {
      throw new Error(
        `upgrade decision for ${decision.occurrence.dependencyKey} has no newVersion`,
      );
    }
  }

  if (options?.preSelectedKeys !== undefined) {
    const keySet = new Set(options.preSelectedKeys);
    const selectedDecisions = upgradeDecisions.filter((decision) =>
      keySet.has(decision.occurrence.dependencyKey),
    );
    return { selectedDecisions };
  }

  kleur.enabled = Boolean(process.stdout.isTTY);

  const sorted = [...upgradeDecisions].sort((a, b) => {
    const nameA = formatDependencyName(a.occurrence.group, a.occurrence.artifact);
    const nameB = formatDependencyName(b.occurrence.group, b.occurrence.artifact);
    return nameA.localeCompare(nameB);
  });

  const names = sorted.map((d) =>
    formatDependencyName(d.occurrence.group, d.occurrence.artifact),
  );
  const nameWidth = Math.max(...names.map((n) => n.length));
  const currentWidth = Math.max(...sorted.map((d) => d.occurrence.currentRaw.length));

  const choices = sorted.map((decision, index) => {
    const name = names[index]!;
    const currentVer = decision.occurrence.currentRaw;
    const newVer = decision.newVersion!;
    const isDowngrade = decision.direction === "down";

    const paddedName = padRight(name, nameWidth);
    const paddedCurrent = padLeft(currentVer, currentWidth);
    const arrow = kleur.dim(isDowngrade ? "↓" : "→");
    const coloredNewVer = colorizeVersion(newVer, currentVer, isDowngrade);

    return {
      name: `${paddedName}  ${paddedCurrent}  ${arrow}  ${coloredNewVer}`,
      value: decision,
      checked: true,
    };
  });

  const terminalRows = process.stdout.rows ?? 24;
  const selectedDecisions = await checkbox<Decision>({
    message: "Choose which packages to upgrade »",
    choices,
    pageSize: Math.max(5, terminalRows - 4),
    theme: {
      style: {
        message: (text: string) => {
          const suffix = " »";
          return text.endsWith(suffix)
            ? kleur.bold(text.slice(0, -suffix.length)) + suffix
            : kleur.bold(text);
        },
        highlight: (text: string) => text,
      },
      icon: {
        checked: kleur.green(" ◉"),
        unchecked: " ◯",
        disabledChecked: " ◉",
        disabledUnchecked: " ◯",
      },
    },
  });

  return { selectedDecisions };
}
