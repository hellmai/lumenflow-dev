// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Initiative scope shape advisory (WU-2142).
 *
 * Pure-function analysis of initiative WU sets for scope-shape anti-patterns:
 * - Over-granular: too many WUs relative to unique files touched
 * - Overlap-heavy: many WUs share the same code_paths
 * - Lane-heavy: most WUs concentrated in a single lane
 *
 * All functions are side-effect-free. Formatting is separated from analysis.
 *
 * @module orchestrator/scope-advisory
 */

import type { WUEntry } from '../initiative-yaml.js';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Advisory type discriminator.
 */
export type ScopeAdvisoryType = 'over-granular' | 'overlap-heavy' | 'lane-heavy';

/**
 * Advisory severity level.
 */
export type ScopeAdvisorySeverity = 'warning' | 'info';

/**
 * A single scope advisory.
 */
export interface ScopeAdvisory {
  /** Anti-pattern type. */
  type: ScopeAdvisoryType;
  /** Severity level. */
  severity: ScopeAdvisorySeverity;
  /** Human-readable detail about the detected anti-pattern. */
  detail: string;
  /** Actionable suggestion to resolve the anti-pattern. */
  suggestion: string;
}

/**
 * Result of scope shape analysis.
 */
export interface ScopeAdvisoryResult {
  /** List of detected advisories (empty if initiative is clean). */
  advisories: ScopeAdvisory[];
  /** True if no advisories were detected. */
  clean: boolean;
}

// ── Thresholds ───────────────────────────────────────────────────────────

/**
 * Configurable thresholds for scope shape detection.
 *
 * These are tuned for typical LumenFlow initiatives. Projects can adjust
 * by passing custom thresholds in the future if needed.
 */
export const SCOPE_ADVISORY_THRESHOLDS = {
  /**
   * WU-to-unique-file ratio above which the initiative is flagged as over-granular.
   * A ratio of 2.0 means there are twice as many WUs as unique files.
   */
  OVER_GRANULAR_RATIO: 2.0,

  /**
   * Percentage of WUs that share the same code path before flagging overlap.
   * 0.5 = 50% of WUs touch at least one common file.
   */
  OVERLAP_PERCENTAGE: 0.5,

  /**
   * Percentage of WUs in a single lane before flagging lane concentration.
   * 0.7 = 70% of WUs are in the same lane.
   */
  LANE_CONCENTRATION_PERCENTAGE: 0.7,

  /**
   * Minimum number of WUs required before lane concentration check fires.
   * Small initiatives (< 4 WUs) naturally have high lane concentration.
   */
  MIN_WUS_FOR_LANE_CHECK: 4,
} as const;

// ── Analysis ─────────────────────────────────────────────────────────────

/**
 * Analyse an initiative's WU set for scope-shape anti-patterns.
 *
 * Pure function with no side effects. Returns structured advisory data.
 *
 * @param wus - WU entries belonging to the initiative
 * @returns Advisory result with any detected anti-patterns
 */
export function analyseScopeShape(wus: WUEntry[]): ScopeAdvisoryResult {
  const advisories: ScopeAdvisory[] = [];

  if (wus.length <= 1) {
    return { advisories, clean: true };
  }

  const overGranularAdvisory = detectOverGranular(wus);
  if (overGranularAdvisory) {
    advisories.push(overGranularAdvisory);
  }

  const overlapAdvisory = detectOverlapConcentration(wus);
  if (overlapAdvisory) {
    advisories.push(overlapAdvisory);
  }

  const laneAdvisory = detectLaneConcentration(wus);
  if (laneAdvisory) {
    advisories.push(laneAdvisory);
  }

  return {
    advisories,
    clean: advisories.length === 0,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────

/**
 * Format scope advisory result for display.
 *
 * Returns empty string if no advisories exist.
 *
 * @param result - Advisory result from analyseScopeShape
 * @returns Formatted multi-line string for terminal output
 */
export function formatScopeAdvisory(result: ScopeAdvisoryResult): string {
  if (result.clean) {
    return '';
  }

  const lines: string[] = [];

  lines.push('Scope Advisory:');

  for (const advisory of result.advisories) {
    lines.push(`  [${advisory.severity}] ${advisory.type}: ${advisory.detail}`);
    lines.push(`    -> ${advisory.suggestion}`);
  }

  return lines.join('\n');
}

// ── Internal detectors ───────────────────────────────────────────────────

/**
 * Collect all code_paths from WU entries, returning per-WU and aggregate sets.
 */
function collectCodePaths(wus: WUEntry[]): {
  uniqueFiles: Set<string>;
  wusWithPaths: number;
  fileToWuCount: Map<string, number>;
} {
  const uniqueFiles = new Set<string>();
  const fileToWuCount = new Map<string, number>();
  let wusWithPaths = 0;

  for (const wu of wus) {
    const paths = (wu.doc as Record<string, unknown>).code_paths as string[] | undefined;
    if (!paths || paths.length === 0) {
      continue;
    }
    wusWithPaths++;

    for (const p of paths) {
      uniqueFiles.add(p);
      fileToWuCount.set(p, (fileToWuCount.get(p) ?? 0) + 1);
    }
  }

  return { uniqueFiles, wusWithPaths, fileToWuCount };
}

/**
 * Detect over-granular WU-to-file ratio.
 *
 * Fires when the number of WUs with code_paths greatly exceeds
 * the number of unique files those WUs touch.
 */
function detectOverGranular(wus: WUEntry[]): ScopeAdvisory | null {
  const { uniqueFiles, wusWithPaths } = collectCodePaths(wus);

  if (uniqueFiles.size === 0 || wusWithPaths === 0) {
    return null;
  }

  const ratio = wusWithPaths / uniqueFiles.size;

  if (ratio > SCOPE_ADVISORY_THRESHOLDS.OVER_GRANULAR_RATIO) {
    return {
      type: 'over-granular',
      severity: 'warning',
      detail: `${wusWithPaths} WUs touch only ${uniqueFiles.size} unique files (ratio: ${ratio.toFixed(1)})`,
      suggestion:
        'Consider merging related WUs to reduce context-switching overhead.',
    };
  }

  return null;
}

/**
 * Detect overlap concentration -- many WUs sharing the same code paths.
 *
 * Fires when any single file is touched by more than OVERLAP_PERCENTAGE
 * of the WUs that have code_paths.
 */
function detectOverlapConcentration(wus: WUEntry[]): ScopeAdvisory | null {
  const { wusWithPaths, fileToWuCount } = collectCodePaths(wus);

  if (wusWithPaths < 2) {
    return null;
  }

  const threshold = SCOPE_ADVISORY_THRESHOLDS.OVERLAP_PERCENTAGE;

  for (const [filePath, count] of fileToWuCount) {
    const percentage = count / wusWithPaths;
    if (percentage > threshold) {
      return {
        type: 'overlap-heavy',
        severity: 'warning',
        detail: `${count} of ${wusWithPaths} WUs (${Math.round(percentage * 100)}%) touch ${filePath}`,
        suggestion:
          'High overlap suggests these WUs could be consolidated or the shared file should be split first.',
      };
    }
  }

  return null;
}

/**
 * Detect lane concentration -- most WUs in a single lane.
 *
 * Fires when any single lane contains more than LANE_CONCENTRATION_PERCENTAGE
 * of the total WUs, provided the initiative has enough WUs for the check
 * to be meaningful.
 */
function detectLaneConcentration(wus: WUEntry[]): ScopeAdvisory | null {
  if (wus.length < SCOPE_ADVISORY_THRESHOLDS.MIN_WUS_FOR_LANE_CHECK) {
    return null;
  }

  const laneCounts = new Map<string, number>();

  for (const wu of wus) {
    const lane = wu.doc.lane ?? 'unknown';
    laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
  }

  const threshold = SCOPE_ADVISORY_THRESHOLDS.LANE_CONCENTRATION_PERCENTAGE;

  for (const [lane, count] of laneCounts) {
    const percentage = count / wus.length;
    if (percentage > threshold) {
      return {
        type: 'lane-heavy',
        severity: 'warning',
        detail: `${count} of ${wus.length} WUs (${Math.round(percentage * 100)}%) are in lane "${lane}"`,
        suggestion:
          'Lane concentration creates a serialisation bottleneck. Consider splitting work across lanes or increasing WIP limits for this lane.',
      };
    }
  }

  return null;
}
