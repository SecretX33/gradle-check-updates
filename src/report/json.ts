// src/report/json.ts

import type { Decision } from "../types.js";

export function renderJson(decisions: Decision[]): string {
  const updates = decisions
    .filter((decision) => decision.status === "upgrade")
    .map((decision) => {
      const newVersion = decision.newVersion;
      if (newVersion === undefined) {
        throw new Error(
          `upgrade decision for ${decision.occurrence.dependencyKey} has no newVersion`,
        );
      }

      return {
        group: decision.occurrence.group,
        artifact: decision.occurrence.artifact,
        current: decision.occurrence.currentRaw,
        updated: newVersion,
        ...(decision.direction === "down" && { direction: "down" as const }),
      };
    });

  return JSON.stringify({ updates }, null, 2);
}
