/**
 * Lane lock policy management for initiative orchestration.
 *
 * WU-1326: Provides policy-aware lane availability checking and configuration.
 *
 * @module orchestrator/lane-policy
 */

import type { WUEntry } from '../initiative-yaml.js';
import type { LockPolicy, LaneConfig, LockPolicyOptions, LaneAvailabilityResult } from './types.js';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

/**
 * WU-1326: Get lock_policy for a lane from configuration.
 *
 * Returns the lock_policy from config if specified, otherwise defaults to 'all'
 * for backward compatibility.
 *
 * @param {string} lane - Lane name (e.g., 'Framework: Core')
 * @param {Record<string, LaneConfig> | undefined} laneConfigs - Lane configurations
 * @returns {LockPolicy} The lock_policy for the lane ('all' | 'active' | 'none')
 */
export function getLockPolicyForLane(
  lane: string,
  laneConfigs?: Record<string, LaneConfig>,
): LockPolicy {
  if (!laneConfigs) {
    return 'all'; // Default for backward compatibility
  }

  const config = laneConfigs[lane];
  if (!config || !config.lock_policy) {
    return 'all'; // Default for unspecified lanes
  }

  return config.lock_policy;
}

/**
 * WU-1326: Check if a WU status holds the lane lock based on lock_policy.
 *
 * - policy=all: both 'in_progress' and 'blocked' hold lane lock
 * - policy=active: only 'in_progress' holds lane lock
 * - policy=none: nothing holds lane lock (no WIP checking)
 *
 * @param {string} status - WU status
 * @param {LockPolicy} policy - Lane lock policy
 * @returns {boolean} True if status holds lane lock
 */
export function _statusHoldsLaneLock(status: string, policy: LockPolicy): boolean {
  if (policy === 'none') {
    return false; // No WIP checking
  }

  if (policy === 'active') {
    // Only in_progress holds lane lock
    return status === WU_STATUS.IN_PROGRESS;
  }

  // policy === 'all' (default) - both in_progress and blocked hold lane
  return status === WU_STATUS.IN_PROGRESS || status === WU_STATUS.BLOCKED;
}

/**
 * WU-1326: Get lane availability respecting lock_policy.
 *
 * Returns availability status for each lane based on current WU states
 * and configured lock_policy.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to check
 * @param {LockPolicyOptions} options - Lock policy options
 * @returns {Record<string, LaneAvailabilityResult>} Lane availability map
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- lane availability logic with multiple policy branches
export function getLaneAvailability(
  wus: WUEntry[],
  options: LockPolicyOptions = {},
): Record<string, LaneAvailabilityResult> {
  const { laneConfigs = {} } = options;
  const result: Record<string, LaneAvailabilityResult> = {};

  // Group WUs by lane
  const wusByLane = new Map<string, WUEntry[]>();
  for (const wu of wus) {
    const lane = wu.doc.lane;
    if (lane) {
      const laneWUs = wusByLane.get(lane);
      if (laneWUs) {
        laneWUs.push(wu);
      } else {
        wusByLane.set(lane, [wu]);
      }
    }
  }

  // Calculate availability for each lane
  for (const [lane, laneWUs] of wusByLane) {
    const policy = getLockPolicyForLane(lane, laneConfigs);

    let inProgressCount = 0;
    let blockedCount = 0;
    let occupiedBy: string | undefined;

    for (const wu of laneWUs) {
      const status = wu.doc.status ?? 'unknown';
      if (status === WU_STATUS.IN_PROGRESS) {
        inProgressCount++;
        if (!occupiedBy) {
          occupiedBy = wu.id;
        }
      } else if (status === WU_STATUS.BLOCKED) {
        blockedCount++;
        // Only set occupiedBy for blocked if policy=all
        if (policy === 'all' && !occupiedBy) {
          occupiedBy = wu.id;
        }
      }
    }

    // Determine availability based on policy
    let available = false;

    if (policy === 'none') {
      // No WIP checking - always available
      available = true;
      occupiedBy = undefined;
    } else if (policy === 'active') {
      // Only in_progress blocks
      available = inProgressCount === 0;
      if (available) {
        occupiedBy = undefined;
      }
    } else {
      // policy === 'all': both in_progress and blocked block
      available = inProgressCount === 0 && blockedCount === 0;
    }

    result[lane] = {
      available,
      policy,
      occupiedBy,
      blockedCount,
      inProgressCount,
    };
  }

  return result;
}
