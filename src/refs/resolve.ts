// src/refs/resolve.ts

import type { Occurrence } from "../types";

export type RefError = { varName: string; consumer: Occurrence };

const PENDING_REF_PREFIX = "__pending_ref__:";

/**
 * Extracts the variable name from a pending-ref via entry. The entry must
 * already be known to start with PENDING_REF_PREFIX.
 */
function extractPendingRefName(viaEntry: string): string {
  return viaEntry.slice(PENDING_REF_PREFIX.length);
}

/**
 * Resolves cross-file variable references in a flat list of Occurrences.
 *
 * Pass 1: collect all definition Occurrences (dependencyKey starts with
 *   "prop:" or "catalog-version:") into a lookup map keyed by variable name.
 *
 * Pass 2: for each consumer Occurrence (via contains a __pending_ref__ entry):
 *   - Look up prop:<name> first, then catalog-version:<name>.
 *   - If found: emit a new linked Occurrence that adopts the definition's
 *     location fields and the consumer's identity fields.
 *   - If not found: emit a RefError and exclude the consumer from output.
 *
 * Non-consumer Occurrences are passed through unchanged.
 *
 * Multiple consumers pointing at the same definition each produce their own
 * linked Occurrence — deduplication is left to the policy layer.
 */
export function resolveRefs(occurrences: Occurrence[]): {
  occurrences: Occurrence[];
  errors: RefError[];
} {
  // --- Pass 1: build definition map ---
  // Key format: variable name (without "prop:" or "catalog-version:" prefix).
  // We store both prop and catalog definitions separately so that prop takes
  // priority when both exist for the same name.
  const propDefinitions = new Map<string, Occurrence>();
  const catalogDefinitions = new Map<string, Occurrence>();

  for (const occurrence of occurrences) {
    if (occurrence.dependencyKey.startsWith("prop:")) {
      const variableName = occurrence.dependencyKey.slice("prop:".length);
      propDefinitions.set(variableName, occurrence);
    } else if (occurrence.dependencyKey.startsWith("catalog-version:")) {
      const variableName = occurrence.dependencyKey.slice("catalog-version:".length);
      catalogDefinitions.set(variableName, occurrence);
    }
  }

  // --- Pass 2: link consumers or collect errors ---
  const resolvedOccurrences: Occurrence[] = [];
  const errors: RefError[] = [];

  for (const occurrence of occurrences) {
    // Single-pass: find the pending-ref entry (if any) in one scan
    const pendingRefEntry = occurrence.via?.find((viaEntry) =>
      viaEntry.startsWith(PENDING_REF_PREFIX),
    );
    if (!pendingRefEntry) {
      // Non-consumer: pass through unchanged (includes definitions themselves)
      resolvedOccurrences.push(occurrence);
      continue;
    }

    const varName = extractPendingRefName(pendingRefEntry);
    const remainingViaEntries = (occurrence.via ?? []).filter(
      (viaEntry) => !viaEntry.startsWith(PENDING_REF_PREFIX),
    );

    // Resolve: prop takes priority over catalog-version
    const definition = propDefinitions.get(varName) ?? catalogDefinitions.get(varName);

    if (definition === undefined) {
      errors.push({ varName, consumer: occurrence });
      continue;
    }

    // Build linked Occurrence: definition's location + consumer's identity
    const linkedOccurrence: Occurrence = {
      // Identity fields from consumer
      group: occurrence.group,
      artifact: occurrence.artifact,
      dependencyKey: occurrence.dependencyKey,
      // Location fields from definition
      file: definition.file,
      byteStart: definition.byteStart,
      byteEnd: definition.byteEnd,
      fileType: definition.fileType,
      currentRaw: definition.currentRaw,
      shape: definition.shape,
      // via: consumer file first, then remaining non-pending-ref entries
      via: [occurrence.file, ...remainingViaEntries],
    };

    resolvedOccurrences.push(linkedOccurrence);
  }

  return { occurrences: resolvedOccurrences, errors };
}
