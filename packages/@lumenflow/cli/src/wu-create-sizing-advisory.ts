// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create-sizing-advisory.ts
 * @description Advisory sizing warnings for wu:create (WU-2141)
 *
 * Emits console.warn when a WU's sizing_estimate exceeds guide thresholds
 * without exception metadata. This is advisory-only (non-blocking).
 */

import { type SizingEstimate, checkSizingAdvisory } from './wu-sizing-validation.js';

/** Input for wu:create sizing advisory check */
export interface SizingAdvisoryInput {
  /** WU identifier for warning messages */
  wuId: string;
  /** Log prefix (e.g., '[wu:create]') */
  logPrefix: string;
  /** Optional sizing_estimate from WU creation args */
  sizingEstimate?: SizingEstimate;
}

/**
 * Emit advisory sizing warnings during wu:create.
 *
 * Non-blocking: always allows creation to proceed.
 * Warns when estimate exceeds guide thresholds without exception metadata.
 * Silent when sizing_estimate is absent (backward compatibility).
 */
export function emitSizingAdvisory(input: SizingAdvisoryInput): void {
  const { wuId, logPrefix, sizingEstimate } = input;

  if (!sizingEstimate) {
    return;
  }

  const advisory = checkSizingAdvisory(sizingEstimate);

  if (!advisory.oversize) {
    return;
  }

  for (const warning of advisory.warnings) {
    console.warn(`${logPrefix} WARNING (${wuId}): ${warning}`);
  }

  console.warn(
    `${logPrefix} Tip: Add exception_type and exception_reason to sizing_estimate to suppress this warning.`,
  );
}
