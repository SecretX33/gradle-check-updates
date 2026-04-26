// src/report/interactive.test.ts

import { checkbox } from "@inquirer/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision, Occurrence } from "../types.js";
import { runInteractivePicker } from "./interactive.js";

vi.mock("@inquirer/prompts");

function makeOccurrence(group: string, artifact: string, currentRaw: string): Occurrence {
  return {
    group,
    artifact,
    file: "build.gradle.kts",
    byteStart: 0,
    byteEnd: 10,
    fileType: "kotlin-dsl",
    currentRaw,
    shape: "exact",
    dependencyKey: `${group}:${artifact}`,
  };
}

function makeUpgradeDecision(
  group: string,
  artifact: string,
  currentRaw: string,
  newVersion: string,
): Decision {
  return {
    occurrence: makeOccurrence(group, artifact, currentRaw),
    status: "upgrade",
    newVersion,
  };
}

function makeNonUpgradeDecision(
  group: string,
  artifact: string,
  currentRaw: string,
): Decision {
  return {
    occurrence: makeOccurrence(group, artifact, currentRaw),
    status: "no-change",
  };
}

describe("runInteractivePicker (non-interactive path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only decisions whose dependencyKey is in preSelectedKeys", async () => {
    const decisions: Decision[] = [
      makeUpgradeDecision("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0", "2.0.21"),
      makeUpgradeDecision("com.squareup.okhttp3", "okhttp", "4.11.0", "4.12.0"),
      makeUpgradeDecision("io.ktor", "ktor-server-core", "2.3.5", "2.3.12"),
    ];

    const result = await runInteractivePicker(decisions, {
      preSelectedKeys: ["org.jetbrains.kotlin:kotlin-stdlib", "io.ktor:ktor-server-core"],
    });

    expect(result.selectedDecisions).toHaveLength(2);
    expect(result.selectedDecisions[0].occurrence.dependencyKey).toBe(
      "org.jetbrains.kotlin:kotlin-stdlib",
    );
    expect(result.selectedDecisions[1].occurrence.dependencyKey).toBe(
      "io.ktor:ktor-server-core",
    );
  });

  it("excludes decisions whose dependencyKey is not in preSelectedKeys", async () => {
    const decisions: Decision[] = [
      makeUpgradeDecision("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0", "2.0.21"),
      makeUpgradeDecision("com.squareup.okhttp3", "okhttp", "4.11.0", "4.12.0"),
    ];

    const result = await runInteractivePicker(decisions, {
      preSelectedKeys: ["org.jetbrains.kotlin:kotlin-stdlib"],
    });

    expect(result.selectedDecisions).toHaveLength(1);
    expect(result.selectedDecisions[0].occurrence.artifact).toBe("kotlin-stdlib");
  });

  it("excludes non-upgrade decisions even if their dependencyKey is in preSelectedKeys", async () => {
    const decisions: Decision[] = [
      makeUpgradeDecision("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0", "2.0.21"),
      makeNonUpgradeDecision("com.squareup.okhttp3", "okhttp", "4.11.0"),
    ];

    const result = await runInteractivePicker(decisions, {
      preSelectedKeys: [
        "org.jetbrains.kotlin:kotlin-stdlib",
        // okhttp is no-change — should be excluded despite being in preSelectedKeys
        "com.squareup.okhttp3:okhttp",
      ],
    });

    expect(result.selectedDecisions).toHaveLength(1);
    expect(result.selectedDecisions[0].occurrence.artifact).toBe("kotlin-stdlib");
  });

  it("returns empty selectedDecisions when preSelectedKeys is empty", async () => {
    const decisions: Decision[] = [
      makeUpgradeDecision("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0", "2.0.21"),
      makeUpgradeDecision("com.squareup.okhttp3", "okhttp", "4.11.0", "4.12.0"),
    ];

    const result = await runInteractivePicker(decisions, {
      preSelectedKeys: [],
    });

    expect(result.selectedDecisions).toHaveLength(0);
  });

  it("throws when an upgrade decision has newVersion undefined, including the dependencyKey in the message", async () => {
    const decisions: Decision[] = [
      makeUpgradeDecision("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0", "2.0.21"),
      {
        occurrence: makeOccurrence("com.squareup.okhttp3", "okhttp", "4.11.0"),
        status: "upgrade",
        newVersion: undefined,
      },
    ];

    await expect(
      runInteractivePicker(decisions, {
        preSelectedKeys: ["org.jetbrains.kotlin:kotlin-stdlib"],
      }),
    ).rejects.toThrow("com.squareup.okhttp3:okhttp");
  });
});

describe("runInteractivePicker (normal interactive path)", () => {
  const mockCheckbox = vi.mocked(checkbox);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns decisions resolved by checkbox and calls checkbox with correctly shaped choices", async () => {
    const kotlinDecision = makeUpgradeDecision(
      "org.jetbrains.kotlin",
      "kotlin-stdlib",
      "1.9.0",
      "2.0.21",
    );
    const okhttpDecision = makeUpgradeDecision(
      "com.squareup.okhttp3",
      "okhttp",
      "4.11.0",
      "4.12.0",
    );

    // Simulate the user selecting only the kotlin dependency
    mockCheckbox.mockResolvedValue([kotlinDecision]);

    const result = await runInteractivePicker([kotlinDecision, okhttpDecision]);

    expect(result.selectedDecisions).toEqual([kotlinDecision]);
    expect(mockCheckbox).toHaveBeenCalledOnce();

    const callArg = mockCheckbox.mock.calls[0]![0];
    const stripAnsi = (s: string) =>
      s
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
        .trim();

    // choices are sorted alphabetically by group:artifact
    const choice0 = callArg.choices[0] as {
      name: string;
      value: Decision;
      checked: boolean;
    };
    expect(choice0.value).toBe(okhttpDecision);
    expect(choice0.checked).toBe(true);
    expect(stripAnsi(choice0.name)).toContain("com.squareup.okhttp3:okhttp");
    expect(stripAnsi(choice0.name)).toContain("4.11.0");
    expect(stripAnsi(choice0.name)).toContain("4.12.0");

    const choice1 = callArg.choices[1] as {
      name: string;
      value: Decision;
      checked: boolean;
    };
    expect(choice1.value).toBe(kotlinDecision);
    expect(choice1.checked).toBe(true);
    expect(stripAnsi(choice1.name)).toContain("org.jetbrains.kotlin:kotlin-stdlib");
    expect(stripAnsi(choice1.name)).toContain("1.9.0");
    expect(stripAnsi(choice1.name)).toContain("2.0.21");
  });

  it("returns empty selectedDecisions when checkbox resolves with an empty array", async () => {
    const decision = makeUpgradeDecision(
      "org.jetbrains.kotlin",
      "kotlin-stdlib",
      "1.9.0",
      "2.0.21",
    );

    mockCheckbox.mockResolvedValue([]);

    const result = await runInteractivePicker([decision]);

    expect(result.selectedDecisions).toEqual([]);
    expect(mockCheckbox).toHaveBeenCalledOnce();
  });

  it("excludes non-upgrade decisions from the choices passed to checkbox", async () => {
    const upgradeDecision = makeUpgradeDecision(
      "org.jetbrains.kotlin",
      "kotlin-stdlib",
      "1.9.0",
      "2.0.21",
    );
    const noChangeDecision = makeNonUpgradeDecision(
      "com.squareup.okhttp3",
      "okhttp",
      "4.11.0",
    );

    mockCheckbox.mockResolvedValue([upgradeDecision]);

    await runInteractivePicker([upgradeDecision, noChangeDecision]);

    const callArg = mockCheckbox.mock.calls[0]![0];
    expect(callArg.choices).toHaveLength(1);
    expect(callArg.choices[0]).toMatchObject({ value: upgradeDecision });
  });
});
