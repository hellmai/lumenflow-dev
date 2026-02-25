// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Branch drift detection and graduated warning system
 *
 * WU-1370: Graduated warnings for branch drift
 * - < 10 commits behind: OK (no message)
 * - 10-14 commits behind: INFO ("Consider rebasing")
 * - 15-19 commits behind: WARNING ("Rebase recommended")
 * - >= 20 commits behind: ERROR (hard block, "Must rebase")
 *
 * @see {@link THRESHOLDS} for configurable threshold values
 */

import { THRESHOLDS } from './wu-constants.js';

/**
 * Drift level constants
 * Used as return values from getDriftLevel()
 */
export const DRIFT_LEVELS = {
  OK: 'ok',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
};

/**
 * Calculate drift level based on number of commits behind main
 *
 * @param {number} commitsBehind - Number of commits behind main (from git rev-list --count)
 * @returns {'ok' | 'info' | 'warning' | 'error'} Drift severity level
 *
 * @example
 * getDriftLevel(5)   // 'ok' - no warning needed
 * getDriftLevel(10)  // 'info' - suggest rebasing
 * getDriftLevel(15)  // 'warning' - recommend rebasing
 * getDriftLevel(20)  // 'error' - hard block, must rebase
 */
export function getDriftLevel(commitsBehind: number) {
  // Handle edge cases: negative or non-integer values
  const commits = Math.floor(commitsBehind);

  if (commits < 0) {
    return DRIFT_LEVELS.OK;
  }

  if (commits >= THRESHOLDS.BRANCH_DRIFT_MAX) {
    return DRIFT_LEVELS.ERROR;
  }

  if (commits >= THRESHOLDS.BRANCH_DRIFT_WARNING) {
    return DRIFT_LEVELS.WARNING;
  }

  if (commits >= THRESHOLDS.BRANCH_DRIFT_INFO) {
    return DRIFT_LEVELS.INFO;
  }

  return DRIFT_LEVELS.OK;
}
