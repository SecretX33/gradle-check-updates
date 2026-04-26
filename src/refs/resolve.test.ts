// src/refs/resolve.test.ts

import { describe, it, expect } from "vitest";
import { resolveRefs } from "./resolve";
import type { Occurrence } from "../types";

// Helper: build a definition Occurrence (e.g. gradle.properties or version-catalog)
const propDefinition = (
  file: string,
  key: string,
  raw: string,
  byteStart = 0,
): Occurrence => ({
  group: "",
  artifact: "",
  file,
  byteStart,
  byteEnd: byteStart + raw.length,
  fileType: "properties",
  currentRaw: raw,
  shape: "exact",
  dependencyKey: `prop:${key}`,
});

const catalogDefinition = (
  file: string,
  key: string,
  raw: string,
  byteStart = 0,
): Occurrence => ({
  group: "",
  artifact: "",
  file,
  byteStart,
  byteEnd: byteStart + raw.length,
  fileType: "version-catalog",
  currentRaw: raw,
  shape: "exact",
  dependencyKey: `catalog-version:${key}`,
});

// Helper: build a consumer Occurrence with a single pending-ref
const consumerOccurrence = (
  group: string,
  artifact: string,
  varName: string,
  consumerFile = "/x/build.gradle",
): Occurrence => ({
  group,
  artifact,
  file: consumerFile,
  byteStart: 100,
  byteEnd: 110,
  fileType: "groovy-dsl",
  currentRaw: `$${varName}`,
  shape: "exact",
  dependencyKey: `${group}:${artifact}`,
  via: [`__pending_ref__:${varName}`],
});

// Helper: consumer with multiple via entries (one pending-ref, one normal path)
const consumerWithExtraVia = (
  group: string,
  artifact: string,
  varName: string,
  extraViaEntry: string,
  consumerFile = "/x/build.gradle",
): Occurrence => ({
  group,
  artifact,
  file: consumerFile,
  byteStart: 100,
  byteEnd: 110,
  fileType: "groovy-dsl",
  currentRaw: `$${varName}`,
  shape: "exact",
  dependencyKey: `${group}:${artifact}`,
  via: [`__pending_ref__:${varName}`, extraViaEntry],
});

describe("resolveRefs", () => {
  it("redirects consumer to definition site (prop)", () => {
    const definition = propDefinition(
      "/app/gradle.properties",
      "kotlinVersion",
      "1.9.0",
      14,
    );
    const consumer = consumerOccurrence(
      "org.jetbrains.kotlin",
      "kotlin-stdlib",
      "kotlinVersion",
    );

    const { occurrences, errors } = resolveRefs([definition, consumer]);

    expect(errors).toHaveLength(0);
    // definition passed through + one linked occurrence
    expect(occurrences).toHaveLength(2);

    const linked = occurrences.find(
      (occurrence) => occurrence.dependencyKey === "org.jetbrains.kotlin:kotlin-stdlib",
    );
    expect(linked).toBeDefined();

    // Adopts definition's location fields
    expect(linked!.file).toBe("/app/gradle.properties");
    expect(linked!.byteStart).toBe(14);
    expect(linked!.byteEnd).toBe(14 + "1.9.0".length);
    expect(linked!.fileType).toBe("properties");
    expect(linked!.currentRaw).toBe("1.9.0");
    expect(linked!.shape).toBe("exact");

    // Keeps consumer's identity fields
    expect(linked!.group).toBe("org.jetbrains.kotlin");
    expect(linked!.artifact).toBe("kotlin-stdlib");
    expect(linked!.dependencyKey).toBe("org.jetbrains.kotlin:kotlin-stdlib");

    // via: consumer file path as first element (pending-ref stripped)
    expect(linked!.via).toEqual(["/x/build.gradle"]);
  });

  it("emits unresolved error when definition is missing", () => {
    const consumer = consumerOccurrence("com.example", "missing-dep", "missingVar");

    const { occurrences, errors } = resolveRefs([consumer]);

    expect(errors).toHaveLength(1);
    expect(errors[0].varName).toBe("missingVar");
    expect(errors[0].consumer).toBe(consumer);
    // Consumer is excluded from output occurrences
    expect(
      occurrences.find(
        (occurrence) => occurrence.dependencyKey === "com.example:missing-dep",
      ),
    ).toBeUndefined();
  });

  it("links multiple consumers to the same definition — one linked occurrence per consumer", () => {
    const definition = propDefinition(
      "/app/gradle.properties",
      "kotlinVersion",
      "1.9.0",
      14,
    );
    const consumer1 = consumerOccurrence(
      "org.jetbrains.kotlin",
      "kotlin-stdlib",
      "kotlinVersion",
    );
    const consumer2 = consumerOccurrence(
      "org.jetbrains.kotlin",
      "kotlin-reflect",
      "kotlinVersion",
    );

    const { occurrences, errors } = resolveRefs([definition, consumer1, consumer2]);

    expect(errors).toHaveLength(0);
    // definition + two linked
    expect(occurrences).toHaveLength(3);

    const stdlib = occurrences.find(
      (occurrence) =>
        occurrence.artifact === "kotlin-stdlib" &&
        occurrence.file === "/app/gradle.properties",
    );
    const reflect = occurrences.find(
      (occurrence) =>
        occurrence.artifact === "kotlin-reflect" &&
        occurrence.file === "/app/gradle.properties",
    );

    expect(stdlib).toBeDefined();
    expect(reflect).toBeDefined();
    // Both share the same definition site bytes but are separate objects
    expect(stdlib).not.toBe(reflect);
    expect(stdlib!.byteStart).toBe(14);
    expect(reflect!.byteStart).toBe(14);
  });

  it("falls back to catalog-version lookup when no prop match exists", () => {
    const definition = catalogDefinition(
      "/app/gradle/libs.versions.toml",
      "retrofit",
      "2.9.0",
      50,
    );
    const consumer = consumerOccurrence("com.squareup.retrofit2", "retrofit", "retrofit");

    const { occurrences, errors } = resolveRefs([definition, consumer]);

    expect(errors).toHaveLength(0);
    expect(occurrences).toHaveLength(2);

    const linked = occurrences.find(
      (occurrence) => occurrence.dependencyKey === "com.squareup.retrofit2:retrofit",
    );
    expect(linked!.file).toBe("/app/gradle/libs.versions.toml");
    expect(linked!.fileType).toBe("version-catalog");
    expect(linked!.currentRaw).toBe("2.9.0");
    expect(linked!.byteStart).toBe(50);
  });

  it("prop lookup takes priority over catalog-version when both exist for the same name", () => {
    const propDef = propDefinition(
      "/app/gradle.properties",
      "retrofitVersion",
      "2.9.0",
      0,
    );
    const catalogDef = catalogDefinition(
      "/app/gradle/libs.versions.toml",
      "retrofitVersion",
      "2.8.0",
      10,
    );
    const consumer = consumerOccurrence(
      "com.squareup.retrofit2",
      "retrofit",
      "retrofitVersion",
    );

    const { occurrences, errors } = resolveRefs([propDef, catalogDef, consumer]);

    expect(errors).toHaveLength(0);
    const linked = occurrences.find(
      (occurrence) => occurrence.dependencyKey === "com.squareup.retrofit2:retrofit",
    );
    // Must resolve to prop definition, not catalog
    expect(linked!.file).toBe("/app/gradle.properties");
    expect(linked!.currentRaw).toBe("2.9.0");
  });

  it("definition Occurrence itself is passed through unchanged in output", () => {
    const definition = propDefinition(
      "/app/gradle.properties",
      "kotlinVersion",
      "1.9.0",
      14,
    );
    const consumer = consumerOccurrence(
      "org.jetbrains.kotlin",
      "kotlin-stdlib",
      "kotlinVersion",
    );

    const { occurrences } = resolveRefs([definition, consumer]);

    const passedThrough = occurrences.find(
      (occurrence) => occurrence.dependencyKey === "prop:kotlinVersion",
    );
    expect(passedThrough).toBeDefined();
    expect(passedThrough).toBe(definition); // exact same reference, untouched
  });

  it("consumer with multiple via entries: pending-ref stripped, normal entries kept", () => {
    const definition = propDefinition(
      "/app/gradle.properties",
      "slf4jVersion",
      "2.0.0",
      0,
    );
    const consumer = consumerWithExtraVia(
      "org.slf4j",
      "slf4j-api",
      "slf4jVersion",
      "some-normal-via-entry",
      "/x/build.gradle",
    );

    const { occurrences, errors } = resolveRefs([definition, consumer]);

    expect(errors).toHaveLength(0);
    const linked = occurrences.find((occurrence) => occurrence.artifact === "slf4j-api");
    expect(linked).toBeDefined();
    // via: consumer file first, then remaining non-pending-ref entries
    expect(linked!.via).toEqual(["/x/build.gradle", "some-normal-via-entry"]);
  });

  it("linked occurrence via array has consumer file path as first element", () => {
    const definition = propDefinition(
      "/app/gradle.properties",
      "guavaVersion",
      "32.1.3-jre",
      0,
    );
    const consumer: Occurrence = {
      group: "com.google.guava",
      artifact: "guava",
      file: "/sub/module/build.gradle",
      byteStart: 200,
      byteEnd: 215,
      fileType: "kotlin-dsl",
      currentRaw: "$guavaVersion",
      shape: "exact",
      dependencyKey: "com.google.guava:guava",
      via: ["__pending_ref__:guavaVersion"],
    };

    const { occurrences, errors } = resolveRefs([definition, consumer]);

    expect(errors).toHaveLength(0);
    const linked = occurrences.find((occurrence) => occurrence.artifact === "guava");
    expect(linked!.via![0]).toBe("/sub/module/build.gradle");
  });

  it("non-consumer occurrences (no via) are passed through unchanged", () => {
    const directDep: Occurrence = {
      group: "com.example",
      artifact: "direct",
      file: "/app/build.gradle",
      byteStart: 0,
      byteEnd: 5,
      fileType: "groovy-dsl",
      currentRaw: "1.0.0",
      shape: "exact",
      dependencyKey: "com.example:direct",
    };

    const { occurrences, errors } = resolveRefs([directDep]);

    expect(errors).toHaveLength(0);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toBe(directDep);
  });

  it("handles multiple independent pending-ref consumers with separate definitions", () => {
    const defA = propDefinition("/app/gradle.properties", "depAVersion", "1.0.0", 0);
    const defB = propDefinition("/app/gradle.properties", "depBVersion", "2.0.0", 20);
    const consumerA = consumerOccurrence("com.a", "lib-a", "depAVersion");
    const consumerB = consumerOccurrence("com.b", "lib-b", "depBVersion");

    const { occurrences, errors } = resolveRefs([defA, defB, consumerA, consumerB]);

    expect(errors).toHaveLength(0);
    // 2 definitions + 2 linked consumers
    expect(occurrences).toHaveLength(4);

    const linkedA = occurrences.find(
      (occurrence) => occurrence.dependencyKey === "com.a:lib-a",
    );
    const linkedB = occurrences.find(
      (occurrence) => occurrence.dependencyKey === "com.b:lib-b",
    );
    expect(linkedA!.currentRaw).toBe("1.0.0");
    expect(linkedB!.currentRaw).toBe("2.0.0");
  });

  it("emits multiple errors when several consumers reference missing definitions", () => {
    const consumer1 = consumerOccurrence("com.x", "lib-x", "missingX");
    const consumer2 = consumerOccurrence("com.y", "lib-y", "missingY");

    const { occurrences, errors } = resolveRefs([consumer1, consumer2]);

    expect(errors).toHaveLength(2);
    const varNames = errors.map((error) => error.varName).sort();
    expect(varNames).toEqual(["missingX", "missingY"]);
    expect(occurrences).toHaveLength(0);
  });
});
