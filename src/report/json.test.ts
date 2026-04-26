// src/report/json.test.ts

import { describe, expect, it } from "vitest";
import type { Decision, Occurrence } from "../types.js";
import { renderJson } from "./json.js";

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

describe("renderJson", () => {
  it("returns empty updates array when no decisions are provided", () => {
    const result = renderJson([]);
    expect(JSON.parse(result)).toEqual({ updates: [] });
  });

  it("returns empty updates array when all decisions are non-upgrade", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("com.example", "alpha", "1.0.0"),
        status: "no-change",
        latestAvailable: "1.0.0",
      },
      {
        occurrence: makeOccurrence("com.example", "beta", "2.0.0"),
        status: "cooldown-blocked",
        latestAvailable: "2.1.0",
      },
      {
        occurrence: makeOccurrence("com.example", "gamma", "3.0.0"),
        status: "held-by-target",
        latestAvailable: "4.0.0",
      },
      {
        occurrence: makeOccurrence("com.example", "delta", "1.0.0"),
        status: "report-only",
        latestAvailable: "1.1.0",
      },
      {
        occurrence: makeOccurrence("com.example", "epsilon", "1.0.0"),
        status: "conflict",
        latestAvailable: "1.1.0",
      },
    ];

    const result = renderJson(decisions);
    expect(JSON.parse(result)).toEqual({ updates: [] });
  });

  it("serializes multiple upgrade decisions correctly", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("org.jetbrains.kotlin", "kotlin-stdlib", "1.9.0"),
        status: "upgrade",
        newVersion: "2.0.21",
        latestAvailable: "2.0.21",
        direction: "up",
      },
      {
        occurrence: makeOccurrence("com.squareup.okhttp3", "okhttp", "4.11.0"),
        status: "upgrade",
        newVersion: "4.12.0",
        latestAvailable: "4.12.0",
      },
      {
        occurrence: makeOccurrence("io.ktor", "ktor-server-core", "2.3.5"),
        status: "upgrade",
        newVersion: "2.3.12",
        latestAvailable: "2.3.12",
      },
    ];

    const result = renderJson(decisions);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      updates: [
        {
          group: "org.jetbrains.kotlin",
          artifact: "kotlin-stdlib",
          current: "1.9.0",
          updated: "2.0.21",
        },
        {
          group: "com.squareup.okhttp3",
          artifact: "okhttp",
          current: "4.11.0",
          updated: "4.12.0",
        },
        {
          group: "io.ktor",
          artifact: "ktor-server-core",
          current: "2.3.5",
          updated: "2.3.12",
        },
      ],
    });
  });

  it("omits direction field when dependency is going up", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("com.example", "lib", "1.0.0"),
        status: "upgrade",
        newVersion: "2.0.0",
        direction: "up",
      },
    ];

    const result = renderJson(decisions);
    const parsed = JSON.parse(result);
    const update = parsed.updates[0];

    expect(update).not.toHaveProperty("direction");
  });

  it("omits direction field when decision has no direction property", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("com.example", "lib", "1.0.0"),
        status: "upgrade",
        newVersion: "2.0.0",
      },
    ];

    const result = renderJson(decisions);
    const parsed = JSON.parse(result);
    const update = parsed.updates[0];

    expect(update).not.toHaveProperty("direction");
  });

  it("includes direction: down only when allow-downgrade triggered the choice", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("com.example", "flaky", "2.0.21"),
        status: "upgrade",
        newVersion: "2.0.20",
        direction: "down",
      },
    ];

    const result = renderJson(decisions);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      updates: [
        {
          group: "com.example",
          artifact: "flaky",
          current: "2.0.21",
          updated: "2.0.20",
          direction: "down",
        },
      ],
    });
  });

  it("filters non-upgrade decisions while keeping upgrade decisions in mixed input", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("com.example", "kept", "1.0.0"),
        status: "upgrade",
        newVersion: "1.1.0",
        latestAvailable: "1.1.0",
      },
      {
        occurrence: makeOccurrence("com.example", "skipped", "2.0.0"),
        status: "no-change",
        latestAvailable: "2.0.0",
      },
    ];

    const result = renderJson(decisions);
    const parsed = JSON.parse(result);

    expect(parsed.updates).toHaveLength(1);
    expect(parsed.updates[0].artifact).toBe("kept");
  });

  it("returns valid JSON string", () => {
    const decisions: Decision[] = [
      {
        occurrence: makeOccurrence("com.example", "lib", "1.0.0"),
        status: "upgrade",
        newVersion: "2.0.0",
      },
    ];

    const result = renderJson(decisions);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
