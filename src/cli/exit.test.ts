// src/cli/exit.test.ts

import { describe, it, expect } from "vitest";
import { determineExitCode } from "./exit.js";
import type { Decision } from "../types.js";

function makeDecision(status: Decision["status"]): Decision {
  return {
    occurrence: {
      group: "com.example",
      artifact: "library",
      file: "/project/build.gradle",
      byteStart: 0,
      byteEnd: 10,
      fileType: "groovy-dsl",
      currentRaw: "1.0.0",
      shape: "exact",
      dependencyKey: "com.example:library",
    },
    status,
  };
}

describe("determineExitCode", () => {
  it("returns 0 when there are no decisions", () => {
    const exitCode = determineExitCode([], {
      upgradeMode: false,
      errorOnOutdated: false,
    });
    expect(exitCode).toBe(0);
  });

  it("returns 0 when all decisions are no-change", () => {
    const decisions = [makeDecision("no-change"), makeDecision("no-change")];
    const exitCode = determineExitCode(decisions, {
      upgradeMode: false,
      errorOnOutdated: false,
    });
    expect(exitCode).toBe(0);
  });

  it("returns 1 when errorOnOutdated is set, not in upgrade mode, and upgrades are available", () => {
    const decisions = [makeDecision("upgrade"), makeDecision("no-change")];
    const exitCode = determineExitCode(decisions, {
      upgradeMode: false,
      errorOnOutdated: true,
    });
    expect(exitCode).toBe(1);
  });

  it("returns 0 when errorOnOutdated is set but upgrade mode is active (upgrades were applied)", () => {
    const decisions = [makeDecision("upgrade")];
    const exitCode = determineExitCode(decisions, {
      upgradeMode: true,
      errorOnOutdated: true,
    });
    expect(exitCode).toBe(0);
  });

  it("returns 0 when upgrades are available but errorOnOutdated is not set", () => {
    const decisions = [makeDecision("upgrade")];
    const exitCode = determineExitCode(decisions, {
      upgradeMode: false,
      errorOnOutdated: false,
    });
    expect(exitCode).toBe(0);
  });

  it("returns 5 when any decision has conflict status", () => {
    const decisions = [makeDecision("upgrade"), makeDecision("conflict")];
    const exitCode = determineExitCode(decisions, {
      upgradeMode: false,
      errorOnOutdated: false,
    });
    expect(exitCode).toBe(5);
  });

  it("returns 5 for conflict even when errorOnOutdated is set (conflict takes priority)", () => {
    const decisions = [makeDecision("conflict"), makeDecision("upgrade")];
    const exitCode = determineExitCode(decisions, {
      upgradeMode: false,
      errorOnOutdated: true,
    });
    expect(exitCode).toBe(5);
  });
});
