import { describe, expect, it } from "vitest";
import type { Occurrence } from "../types.js";
import { resolveSharedVarDisagreements } from "./shared-var.js";

function makeOccurrence(
  overrides: Partial<Occurrence> &
    Pick<Occurrence, "dependencyKey" | "file" | "byteStart" | "byteEnd">,
): Occurrence {
  return {
    group: "org.jetbrains.kotlin",
    artifact: "kotlin-stdlib",
    fileType: "properties",
    currentRaw: "1.9.0",
    shape: "exact",
    via: ["/app/build.gradle"],
    ...overrides,
  };
}

describe("resolveSharedVarDisagreements", () => {
  describe("Test 1: two consumers with different winners → lowest wins, warning emitted", () => {
    it("takes the lowest proposed winner and names the constraining dep", () => {
      const stdlibOccurrence = makeOccurrence({
        group: "org.jetbrains.kotlin",
        artifact: "kotlin-stdlib",
        dependencyKey: "org.jetbrains.kotlin:kotlin-stdlib",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });
      const reflectOccurrence = makeOccurrence({
        group: "org.jetbrains.kotlin",
        artifact: "kotlin-reflect",
        dependencyKey: "org.jetbrains.kotlin:kotlin-reflect",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });

      const editSites = new Map([
        [
          "/app/gradle.properties:14",
          [
            { occurrence: stdlibOccurrence, proposedWinner: "2.0.0" },
            { occurrence: reflectOccurrence, proposedWinner: "1.9.25" },
          ],
        ],
      ]);

      const result = resolveSharedVarDisagreements(editSites);

      expect(result.size).toBe(1);
      const sharedVarResult = result.get("/app/gradle.properties:14");
      expect(sharedVarResult).toBeDefined();
      expect(sharedVarResult!.resolvedWinner).toBe("1.9.25");
      expect(sharedVarResult!.constrainingDepKey).toBe(
        "org.jetbrains.kotlin:kotlin-reflect",
      );
      expect(sharedVarResult!.depKeys).toContain("org.jetbrains.kotlin:kotlin-stdlib");
      expect(sharedVarResult!.depKeys).toContain("org.jetbrains.kotlin:kotlin-reflect");
      expect(sharedVarResult!.warning).toContain("1.9.25");
      expect(sharedVarResult!.warning).toContain("kotlin-reflect");
      expect(sharedVarResult!.warning).toContain("2.0.0");
    });
  });

  describe("Test 2: two consumers with the same winner → no disagreement warning", () => {
    it("returns a result entry with undefined warning and constrainingDepKey", () => {
      const stdlibOccurrence = makeOccurrence({
        dependencyKey: "org.jetbrains.kotlin:kotlin-stdlib",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });
      const reflectOccurrence = makeOccurrence({
        artifact: "kotlin-reflect",
        dependencyKey: "org.jetbrains.kotlin:kotlin-reflect",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });

      const editSites = new Map([
        [
          "/app/gradle.properties:14",
          [
            { occurrence: stdlibOccurrence, proposedWinner: "2.0.0" },
            { occurrence: reflectOccurrence, proposedWinner: "2.0.0" },
          ],
        ],
      ]);

      const result = resolveSharedVarDisagreements(editSites);

      expect(result.size).toBe(1);
      const sharedVarResult = result.get("/app/gradle.properties:14");
      expect(sharedVarResult).toBeDefined();
      expect(sharedVarResult!.resolvedWinner).toBe("2.0.0");
      expect(sharedVarResult!.warning).toBeUndefined();
      expect(sharedVarResult!.constrainingDepKey).toBeUndefined();
    });
  });

  describe("Test 3: single consumer → not included in the output map", () => {
    it("omits edit sites with only one entry", () => {
      const stdlibOccurrence = makeOccurrence({
        dependencyKey: "org.jetbrains.kotlin:kotlin-stdlib",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });

      const editSites = new Map([
        [
          "/app/gradle.properties:14",
          [{ occurrence: stdlibOccurrence, proposedWinner: "2.0.0" }],
        ],
      ]);

      const result = resolveSharedVarDisagreements(editSites);

      expect(result.has("/app/gradle.properties:14")).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  describe("Test 4: three consumers with different winners → lowest wins", () => {
    it("picks the globally lowest winner among three candidates and names the constraining dep", () => {
      const stdlibOccurrence = makeOccurrence({
        artifact: "kotlin-stdlib",
        dependencyKey: "org.jetbrains.kotlin:kotlin-stdlib",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });
      const reflectOccurrence = makeOccurrence({
        artifact: "kotlin-reflect",
        dependencyKey: "org.jetbrains.kotlin:kotlin-reflect",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });
      const coroutinesOccurrence = makeOccurrence({
        group: "org.jetbrains.kotlinx",
        artifact: "kotlinx-coroutines-core",
        dependencyKey: "org.jetbrains.kotlinx:kotlinx-coroutines-core",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
      });

      const editSites = new Map([
        [
          "/app/gradle.properties:14",
          [
            { occurrence: stdlibOccurrence, proposedWinner: "2.0.0" },
            { occurrence: reflectOccurrence, proposedWinner: "1.9.25" },
            { occurrence: coroutinesOccurrence, proposedWinner: "2.1.0" },
          ],
        ],
      ]);

      const result = resolveSharedVarDisagreements(editSites);

      expect(result.size).toBe(1);
      const sharedVarResult = result.get("/app/gradle.properties:14");
      expect(sharedVarResult).toBeDefined();
      expect(sharedVarResult!.resolvedWinner).toBe("1.9.25");
      expect(sharedVarResult!.constrainingDepKey).toBe(
        "org.jetbrains.kotlin:kotlin-reflect",
      );
      expect(sharedVarResult!.warning).toContain("1.9.25");
      expect(sharedVarResult!.warning).toContain("kotlin-reflect");
      expect(sharedVarResult!.depKeys).toHaveLength(3);
    });
  });

  describe("Test 5: scenario.json fixture smoke test", () => {
    it("handles real Gradle occurrences from the shared-variable-disagreement fixture", () => {
      const stdlibOccurrence: Occurrence = {
        group: "org.jetbrains.kotlin",
        artifact: "kotlin-stdlib",
        dependencyKey: "org.jetbrains.kotlin:kotlin-stdlib",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
        fileType: "properties",
        currentRaw: "1.9.0",
        shape: "exact",
        via: ["/app/build.gradle"],
      };
      const reflectOccurrence: Occurrence = {
        group: "org.jetbrains.kotlin",
        artifact: "kotlin-reflect",
        dependencyKey: "org.jetbrains.kotlin:kotlin-reflect",
        file: "/app/gradle.properties",
        byteStart: 14,
        byteEnd: 19,
        fileType: "properties",
        currentRaw: "1.9.0",
        shape: "exact",
        via: ["/app/build.gradle"],
      };

      const editSites = new Map([
        [
          "/app/gradle.properties:14",
          [
            { occurrence: stdlibOccurrence, proposedWinner: "2.0.0" },
            { occurrence: reflectOccurrence, proposedWinner: "1.9.25" },
          ],
        ],
      ]);

      const result = resolveSharedVarDisagreements(editSites);

      expect(result.size).toBe(1);
      const sharedVarResult = result.get("/app/gradle.properties:14");
      expect(sharedVarResult!.resolvedWinner).toBe("1.9.25");
      expect(sharedVarResult!.constrainingDepKey).toBe(
        "org.jetbrains.kotlin:kotlin-reflect",
      );
      expect(sharedVarResult!.warning).toMatch(
        /Shared variable constrained to 1\.9\.25 by org\.jetbrains\.kotlin:kotlin-reflect/,
      );
      expect(sharedVarResult!.warning).toContain("2.0.0");
    });
  });
});
