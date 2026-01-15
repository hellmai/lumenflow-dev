/**
 * Locked WU Guard (WU-2539)
 *
 * Prevents edits to locked WUs.
 * WUs in terminal states (done, cancelled) cannot be modified.
 *
 * @module @lumenflow/core/guards
 */

import { WUStatus, TERMINAL_STATUSES } from '../shared/wu-status.js';

export { WUStatus } from '../shared/wu-status.js';

/**
 * WU state for guard checks.
 */
export interface WUState {
  id: string;
  status: WUStatus;
  locked?: boolean;
  lane: string;
  title: string;
}

/**
 * Result of checking if a WU can be edited.
 */
export interface WUEditAllowedResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * Checks if a WU is locked based on its status or locked flag.
 *
 * @param status - WU status
 * @param locked - Optional explicit lock flag
 * @returns True if WU is locked
 */
export function isWULocked(status: WUStatus, locked?: boolean): boolean {
  if (locked) {
    return true;
  }
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Checks if a WU can be edited.
 *
 * @param wu - WU state to check
 * @returns Result indicating if edit is allowed
 */
export function checkWUEditAllowed(wu: WUState): WUEditAllowedResult {
  if (wu.locked) {
    return {
      allowed: false,
      reason: `${wu.id} is locked and cannot be edited`,
    };
  }

  if (wu.status === WUStatus.DONE) {
    return {
      allowed: false,
      reason: `${wu.id} is locked (status: done) and cannot be edited`,
    };
  }

  if (wu.status === WUStatus.CANCELLED) {
    return {
      allowed: false,
      reason: `${wu.id} is cancelled and cannot be edited`,
    };
  }

  return { allowed: true, reason: null };
}
