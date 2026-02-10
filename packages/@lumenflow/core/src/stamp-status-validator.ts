/**
 * @fileoverview Stamp-status validation utilities
 *
 * WU-1781: Provides utilities to detect and handle legacy WUs with stamp-status mismatches.
 *
 * The problem: WUs with .done stamps but non-done status (e.g., cancelled, ready) cause
 * wu:validate to fail, which blocks husky pre-push and prevents wu:done from completing.
 *
 * The solution: Detect these legacy artifacts and exempt them from validation to prevent
 * deadlocks, while still enforcing validation on new/active WUs.
 */

import { WU_STATUS } from './wu-constants.js';

/**
 * List of parent-only lanes that are deprecated (legacy).
 * WUs with these lanes are considered legacy artifacts and may have stamp-status mismatches.
 * Modern WUs should use sub-lanes like "Operations: Tooling".
 *
 * @type {readonly string[]}
 */
export const LEGACY_PARENT_ONLY_LANES = Object.freeze([
  'Intelligence',
  'Core Systems',
  'Operations',
  'Experience',
  'Discovery',
]);

/**
 * Check if a lane is a deprecated parent-only lane (no sub-lane specified).
 *
 * @param {string|null|undefined} lane - The lane to check
 * @returns {boolean} True if the lane is a parent-only legacy lane
 *
 * @example
 * isLegacyParentOnlyLane('Intelligence') // true
 * isLegacyParentOnlyLane('Operations: Tooling') // false
 */
export function isLegacyParentOnlyLane(lane) {
  if (!lane || typeof lane !== 'string') {
    return false;
  }

  const normalizedLane = lane.trim();

  // Check if it's an exact match to a parent-only lane (case-insensitive)
  const lowerLane = normalizedLane.toLowerCase();
  return LEGACY_PARENT_ONLY_LANES.some((parentLane) => parentLane.toLowerCase() === lowerLane);
}

/**
 * Check if a WU is a legacy artifact with stamp-status mismatch.
 *
 * A legacy stamped WU is one that:
 * - Has a .done stamp file
 * - Has a status that is NOT 'done'
 *
 * These WUs are historical artifacts from before validation was strict,
 * and should be exempted from the stamp-status consistency check.
 *
 * @param {object} wu - The parsed WU YAML object
 * @param {string} wu.id - WU ID (e.g., 'WU-100')
 * @param {string} wu.status - WU status (e.g., 'done', 'cancelled', 'ready')
 * @param {Set<string>} stampedIds - Set of WU IDs that have .done stamp files
 * @returns {boolean} True if this is a legacy stamped WU with mismatch
 *
 * @example
 * const stampedIds = new Set(['WU-100', 'WU-101']);
 * isLegacyStampedWU({ id: 'WU-100', status: 'cancelled' }, stampedIds) // true
 * isLegacyStampedWU({ id: 'WU-100', status: 'done' }, stampedIds) // false (no mismatch)
 * isLegacyStampedWU({ id: 'WU-999', status: 'cancelled' }, stampedIds) // false (no stamp)
 */
export function isLegacyStampedWU(wu, stampedIds) {
  if (!wu || !wu.id || !stampedIds) {
    return false;
  }

  // Must have a stamp
  const hasStamp = stampedIds.has(wu.id);
  if (!hasStamp) {
    return false;
  }

  // Must have a status that is NOT done
  const status = wu.status;
  if (!status || typeof status !== 'string') {
    return false;
  }

  // If status is 'done', this is a normal WU (no mismatch)
  if (status.toLowerCase() === WU_STATUS.DONE) {
    return false;
  }

  // Has stamp + status != done = legacy mismatch
  return true;
}

/**
 * Check if a WU ID is exempted from stamp-status validation via config.
 *
 * The .lumenflow.config.yaml can specify exemptions for known historical
 * artifacts that cannot be fixed (e.g., WU-307, WU-311, WU-1152).
 *
 * @param {string} id - WU ID to check
 * @param {string[]|null|undefined} exemptions - List of exempted WU IDs from config
 * @returns {boolean} True if the WU is exempted
 *
 * @example
 * isExemptedFromStampStatusCheck('WU-307', ['WU-307', 'WU-311']) // true
 * isExemptedFromStampStatusCheck('WU-999', ['WU-307', 'WU-311']) // false
 */
export function isExemptedFromStampStatusCheck(id, exemptions) {
  if (!id || !exemptions || !Array.isArray(exemptions)) {
    return false;
  }

  return exemptions.includes(id);
}

/**
 * Determine if a WU should be exempted from stamp-status validation.
 *
 * A WU is exempted if:
 * 1. It's explicitly listed in the config exemptions, OR
 * 2. It's a legacy stamped WU (has stamp but status != done) AND has a legacy parent-only lane
 *
 * @param {object} wu - The parsed WU YAML object
 * @param {Set<string>} stampedIds - Set of WU IDs that have .done stamp files
 * @param {string[]} exemptions - List of exempted WU IDs from config
 * @returns {{ exempted: boolean, reason: string|null }} Whether exempted and why
 */
export function shouldExemptFromStampStatusCheck(wu, stampedIds, exemptions = []) {
  const id = wu?.id;

  // Check config exemption first
  if (isExemptedFromStampStatusCheck(id, exemptions)) {
    return { exempted: true, reason: 'config exemption' };
  }

  // Check if it's a legacy stamped WU with a legacy lane
  if (isLegacyStampedWU(wu, stampedIds)) {
    const lane = wu.lane;
    if (isLegacyParentOnlyLane(lane)) {
      return { exempted: true, reason: 'legacy parent-only lane with stamp' };
    }
  }

  return { exempted: false, reason: null };
}
