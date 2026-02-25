// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-brief-sizing.ts
 * @description Sizing advisory and strict mode for wu:brief (WU-2141)
 *
 * In advisory mode (default): emits warnings for oversize WUs, always passes.
 * In strict mode (--strict-sizing): blocks when sizing metadata is missing
 * or estimate exceeds thresholds without exception.
 */

import { type SizingEstimate, checkSizingAdvisory } from './wu-sizing-validation.js';

/** Input for wu:brief sizing check */
export interface BriefSizingInput {
  /** WU identifier for messages */
  wuId: string;
  /** Log prefix (e.g., '[wu:brief]') */
  logPrefix: string;
  /** Whether --strict-sizing flag is active */
  strictSizing: boolean;
  /** Optional sizing_estimate from WU YAML */
  sizingEstimate?: SizingEstimate;
}

/** Result of wu:brief sizing check */
export interface BriefSizingResult {
  /** Whether the check passed (true = proceed, false = block in strict mode) */
  pass: boolean;
  /** Advisory warnings (emitted but non-blocking) */
  warnings: string[];
  /** Blocking errors (only in strict mode) */
  errors: string[];
}

/**
 * Check sizing compliance for wu:brief.
 *
 * Advisory mode (strictSizing=false):
 *   - Always passes
 *   - Emits warnings for oversize estimates without exceptions
 *   - Silent for missing sizing_estimate (backward compat)
 *
 * Strict mode (strictSizing=true):
 *   - Blocks when sizing_estimate is missing
 *   - Blocks when estimate exceeds thresholds without exception
 *   - Passes when estimate is within thresholds or has valid exception
 */
export function checkBriefSizing(input: BriefSizingInput): BriefSizingResult {
  const { wuId, logPrefix, strictSizing, sizingEstimate } = input;

  const warnings: string[] = [];
  const errors: string[] = [];

  // ─── Missing sizing_estimate ───

  if (!sizingEstimate) {
    if (strictSizing) {
      errors.push(
        `${wuId}: --strict-sizing requires sizing_estimate metadata in WU YAML. ` +
          `Add sizing_estimate with estimated_files, estimated_tool_calls, and strategy.`,
      );
      return { pass: false, warnings, errors };
    }
    // Advisory mode: silent for missing estimate (backward compat)
    return { pass: true, warnings, errors };
  }

  // ─── Check thresholds ───

  const advisory = checkSizingAdvisory(sizingEstimate);

  if (advisory.oversize) {
    if (strictSizing) {
      errors.push(...advisory.warnings.map((w) => `${wuId}: ${w}`));
      return { pass: false, warnings, errors };
    }

    // Advisory mode: warn but pass
    for (const w of advisory.warnings) {
      const message = `${logPrefix} WARNING (${wuId}): ${w}`;
      warnings.push(message);
      console.warn(message);
    }
    return { pass: true, warnings, errors };
  }

  return { pass: true, warnings, errors };
}
