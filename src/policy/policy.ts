import type { Decision, Occurrence } from "../types.js";
import type { ProjectConfig } from "../config/schema.js";
import { compareVersions } from "../version/compare.js";
import { trackFilter } from "./track.js";
import { cooldownFilter } from "./cooldown.js";
import { includeExcludeFilter } from "./filter.js";
import { targetFilter } from "./target.js";
import { isEligible } from "./shape-rules.js";
import { applyCoherence, type BlockEntry } from "./coherence.js";
import { resolveSharedVarDisagreements } from "./shared-var.js";
import { attemptAllowDowngrade } from "./downgrade.js";

export type MetadataAccessor = {
  getVersions(group: string, artifact: string): string[];
  getPublishedAt(group: string, artifact: string, version: string): number | undefined;
};

export type PolicyOptions = {
  pre?: boolean;
  cooldownDays?: number;
  allowDowngrade?: boolean;
  includes?: string[];
  excludes?: string[];
  target?: ProjectConfig["target"];
};

/**
 * Runs the full policy pipeline for a set of occurrences.
 *
 * @param occurrences All occurrences from all locators (after ref resolution)
 * @param metadata    Accessor for version lists and publish timestamps
 * @param getConfig   Function that returns effective PolicyOptions for a given Occurrence
 * @param now         Reference time (for cooldown calculation)
 * @returns           One Decision per Occurrence
 */
export function runPolicy(
  occurrences: Occurrence[],
  metadata: MetadataAccessor,
  getConfig: (occurrence: Occurrence) => PolicyOptions,
  now: Date,
): Decision[] {
  // Compute a per-occurrence proposed winner via stages 1–5
  const proposedWinners = new Map<Occurrence, string | undefined>();
  const decisionOverrides = new Map<Occurrence, Decision>();

  for (const occurrence of occurrences) {
    const config = getConfig(occurrence);
    const { group, artifact, currentRaw } = occurrence;

    // Stage 5a – Shape eligibility check (done first to short-circuit before fetching candidates)
    // Checked first — ineligible shapes are always report-only, regardless of include/exclude filters.
    if (!isEligible(occurrence)) {
      decisionOverrides.set(occurrence, { occurrence, status: "report-only" });
      proposedWinners.set(occurrence, undefined);
      continue;
    }

    const allCandidates = metadata.getVersions(group, artifact);

    // Compute latestAvailable: highest candidate >= current (before track/cooldown/include/target)
    const candidatesAboveOrEqualCurrent = allCandidates.filter(
      (candidate) => compareVersions(candidate, currentRaw) >= 0,
    );
    const latestAvailable =
      candidatesAboveOrEqualCurrent.length > 0
        ? candidatesAboveOrEqualCurrent.reduce((highest, candidate) =>
            compareVersions(candidate, highest) > 0 ? candidate : highest,
          )
        : undefined;

    // Stage 1 – Track filter
    const postTrackCandidates = trackFilter(currentRaw, allCandidates, {
      pre: config.pre,
    });

    // Stage 2 – Cooldown filter
    const cooldownDays = config.cooldownDays ?? 0;
    const publishedAtResolver = (version: string): Date | undefined => {
      const timestamp = metadata.getPublishedAt(group, artifact, version);
      return timestamp !== undefined ? new Date(timestamp) : undefined;
    };
    const postCooldownCandidates = cooldownFilter(
      postTrackCandidates,
      publishedAtResolver,
      cooldownDays,
      now,
    );

    // Determine whether cooldown blocked all upgrade candidates (strictly above current)
    // Also accounts for the case where current itself is inside the cooldown window and
    // no soaked versions above current exist (allow-downgrade scenario).
    const preTrackStrictlyAboveCurrent = postTrackCandidates.filter(
      (candidate) => compareVersions(candidate, currentRaw) > 0,
    );
    const postCooldownStrictlyAboveCurrent = postCooldownCandidates.filter(
      (candidate) => compareVersions(candidate, currentRaw) > 0,
    );
    // Determine if current itself is inside the cooldown window (not yet soaked).
    // This covers the allow-downgrade case where current is the newest version and was
    // released too recently — there are no strictly-above candidates to block, but the
    // current version itself has not "soaked" yet.
    const currentTimestamp = metadata.getPublishedAt(group, artifact, currentRaw);
    const cutoffMs = cooldownDays > 0 ? now.getTime() - cooldownDays * 86_400_000 : 0;
    // Unknown timestamp → pass through (same as cooldownFilter rule for unknown timestamps).
    // Only treat as "inside window" when we have an actual recent timestamp.
    const currentIsInsideCooldownWindow =
      cooldownDays > 0 && currentTimestamp !== undefined && currentTimestamp > cutoffMs;
    // Cooldown blocked upgrades when:
    // 1. Cooldown is active
    // 2. No candidate strictly above current survived cooldown
    // 3. Either there were real upgrade candidates (strictly above) that cooldown blocked,
    //    or current itself is inside the window (allow-downgrade: no soaked newer version exists)
    const cooldownBlockedUpgrades =
      cooldownDays > 0 &&
      postCooldownStrictlyAboveCurrent.length === 0 &&
      (preTrackStrictlyAboveCurrent.length > 0 || currentIsInsideCooldownWindow);

    if (cooldownBlockedUpgrades) {
      // Cooldown removed all upgrade candidates — attempt allow-downgrade or emit cooldown-blocked
      // The CLI layer is responsible for calling isAllowDowngradeValid before invoking runPolicy —
      // bare --allow-downgrade without --cooldown should never reach here.
      if (config.allowDowngrade && cooldownDays > 0) {
        const publishedAtMap = new Map<string, number>();
        for (const candidate of allCandidates) {
          const timestamp = metadata.getPublishedAt(group, artifact, candidate);
          if (timestamp !== undefined) {
            publishedAtMap.set(candidate, timestamp);
          }
        }
        const downgradedVersion = attemptAllowDowngrade({
          currentVersion: currentRaw,
          candidates: allCandidates,
          publishedAt: publishedAtMap,
          cooldownDays,
          currentPublishedAt: currentTimestamp,
          now,
        });
        if (downgradedVersion !== undefined) {
          decisionOverrides.set(occurrence, {
            occurrence,
            status: "upgrade",
            newVersion: downgradedVersion,
            latestAvailable,
            direction: "down",
          });
          proposedWinners.set(occurrence, downgradedVersion);
        } else {
          decisionOverrides.set(occurrence, {
            occurrence,
            status: "cooldown-blocked",
            latestAvailable,
          });
          proposedWinners.set(occurrence, undefined);
        }
        continue;
      }

      decisionOverrides.set(occurrence, {
        occurrence,
        status: "cooldown-blocked",
        latestAvailable,
      });
      proposedWinners.set(occurrence, undefined);
      continue;
    }

    // Stage 3 – Include/exclude filter
    const includes = config.includes ?? [];
    const excludes = config.excludes ?? [];
    const passesFilter = includeExcludeFilter(
      occurrence.dependencyKey,
      includes,
      excludes,
    );
    if (!passesFilter) {
      decisionOverrides.set(occurrence, {
        occurrence,
        status: "no-change",
        latestAvailable,
        reason: "excluded",
      });
      proposedWinners.set(occurrence, undefined);
      continue;
    }

    // Stage 4 – Target ceiling + never-downgrade
    const preTargetCandidates = postCooldownCandidates;
    const postTargetCandidates = targetFilter(
      currentRaw,
      preTargetCandidates,
      config.target,
    );

    // Stage 5b – Pick max
    if (postTargetCandidates.length === 0) {
      const heldByTarget =
        config.target !== undefined &&
        preTargetCandidates.some(
          (candidate) => compareVersions(candidate, currentRaw) > 0,
        );
      decisionOverrides.set(occurrence, {
        occurrence,
        status: heldByTarget ? "held-by-target" : "no-change",
        latestAvailable,
      });
      proposedWinners.set(occurrence, undefined);
      continue;
    }

    const winner = postTargetCandidates.reduce((highest, candidate) =>
      compareVersions(candidate, highest) > 0 ? candidate : highest,
    );

    if (compareVersions(winner, currentRaw) <= 0) {
      decisionOverrides.set(occurrence, {
        occurrence,
        status: "no-change",
        latestAvailable,
      });
      proposedWinners.set(occurrence, undefined);
    } else {
      proposedWinners.set(occurrence, winner);
      // Store a preliminary decision; coherence/shared-var may override it
      decisionOverrides.set(occurrence, {
        occurrence,
        status: "upgrade",
        newVersion: winner,
        latestAvailable,
      });
    }
  }

  // Stage 6 – Rich-block coherence
  // Build groups map: dependencyKey → BlockEntry[] for keys containing "@"
  const richBlockGroups = new Map<string, BlockEntry[]>();
  for (const occurrence of occurrences) {
    if (!occurrence.dependencyKey.includes("@")) continue;
    const existingEntries = richBlockGroups.get(occurrence.dependencyKey) ?? [];
    existingEntries.push({
      occurrence,
      proposedWinner: proposedWinners.get(occurrence),
    });
    richBlockGroups.set(occurrence.dependencyKey, existingEntries);
  }

  const coherenceResults = applyCoherence(richBlockGroups);

  // Merge coherence decisions back; also update proposedWinners accordingly
  for (const [occurrence, coherenceDecision] of coherenceResults) {
    const preCoherenceDecision = decisionOverrides.get(occurrence);
    decisionOverrides.set(occurrence, {
      ...coherenceDecision,
      latestAvailable: preCoherenceDecision?.latestAvailable,
      direction: preCoherenceDecision?.direction,
    });
    proposedWinners.set(
      occurrence,
      coherenceDecision.status === "upgrade" ? coherenceDecision.newVersion : undefined,
    );
  }

  // Stage 7 – Shared-variable disagreement resolution
  // Build edit sites map keyed by "${file}:${byteStart}" for upgrade decisions
  const editSites = new Map<
    string,
    Array<{ occurrence: Occurrence; proposedWinner: string }>
  >();
  for (const occurrence of occurrences) {
    const winner = proposedWinners.get(occurrence);
    if (winner === undefined) continue;
    const currentDecision = decisionOverrides.get(occurrence);
    if (currentDecision?.status !== "upgrade") continue;

    const editSiteKey = `${occurrence.file}:${occurrence.byteStart}`;
    const existingEntries = editSites.get(editSiteKey) ?? [];
    existingEntries.push({ occurrence, proposedWinner: winner });
    editSites.set(editSiteKey, existingEntries);
  }

  const sharedVarResults = resolveSharedVarDisagreements(editSites);

  // Apply shared-var resolved winners back to decisions
  for (const [editSiteKey, sharedVarResult] of sharedVarResults) {
    const entriesForSite = editSites.get(editSiteKey);
    if (entriesForSite === undefined) continue;
    for (const entry of entriesForSite) {
      const existingDecision = decisionOverrides.get(entry.occurrence);
      const resolvedWinner = sharedVarResult.resolvedWinner;
      // A downgrade decision is intentionally below current — treat it as a valid upgrade.
      const isIntentionalDowngrade = existingDecision?.direction === "down";
      const resolvedIsAboveCurrent =
        compareVersions(resolvedWinner, entry.occurrence.currentRaw) > 0;
      if (!resolvedIsAboveCurrent && !isIntentionalDowngrade) {
        decisionOverrides.set(entry.occurrence, {
          occurrence: entry.occurrence,
          status: "no-change",
          latestAvailable: existingDecision?.latestAvailable,
          warning: sharedVarResult.warning,
        });
      } else {
        const preservedDirection =
          existingDecision?.direction === "down" &&
          existingDecision.newVersion === resolvedWinner
            ? "down"
            : undefined;
        decisionOverrides.set(entry.occurrence, {
          occurrence: entry.occurrence,
          status: "upgrade",
          newVersion: resolvedWinner,
          latestAvailable: existingDecision?.latestAvailable,
          direction: preservedDirection,
          warning: sharedVarResult.warning,
        });
      }
    }
  }

  // Build final decision list in the same order as occurrences input
  return occurrences.map((occurrence) => {
    const override = decisionOverrides.get(occurrence);
    if (override !== undefined) return override;
    // Fallback: should not normally be reached
    return { occurrence, status: "no-change" };
  });
}
