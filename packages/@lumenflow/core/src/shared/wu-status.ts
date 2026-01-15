/**
 * WU Status Constants (WU-2539)
 *
 * Shared WU status values used across modules.
 *
 * @module @lumenflow/core/shared
 */

/**
 * WU status values.
 */
export const WUStatus = {
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const;

export type WUStatus = (typeof WUStatus)[keyof typeof WUStatus];

/**
 * Unclaimed WU statuses (not tracked in state store).
 */
export const UNCLAIMED_STATUSES: string[] = [WUStatus.READY];

/**
 * Terminal WU statuses.
 */
export const TERMINAL_STATUSES: string[] = [WUStatus.DONE, WUStatus.CANCELLED];
