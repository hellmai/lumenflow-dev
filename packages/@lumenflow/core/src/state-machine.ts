/**
 * State Machine Validation Library
 *
 * Enforces canonical WU state transitions according to LumenFlow §2.4
 * Prevents illegal state changes (e.g., done → in_progress) and ensures workflow integrity.
 *
 * Canonical state machine:
 * - ready → in_progress (claim)
 * - in_progress → blocked (block)
 * - in_progress → waiting (implementation complete, awaiting sign-off)
 * - in_progress → done (direct completion)
 * - in_progress → ready (release - WU-1080: orphan recovery)
 * - blocked → in_progress (unblock)
 * - blocked → done (blocker resolved, direct completion)
 * - waiting → in_progress (changes requested)
 * - waiting → done (approved)
 * - done → (terminal, no transitions)
 */

import { createError, ErrorCodes } from './error-handler.js';

/**
 * Valid WU states as defined in LumenFlow §2.4
 */
const VALID_STATES = new Set(['ready', 'in_progress', 'blocked', 'waiting', 'done']);

/**
 * Transition table mapping each state to its allowed next states
 * Based on LumenFlow §2.4 Flow States & Lanes
 */
const TRANSITIONS = {
  ready: ['in_progress'],
  in_progress: ['blocked', 'waiting', 'done', 'ready'], // WU-1080: 'ready' via release for orphan recovery
  blocked: ['in_progress', 'done'],
  waiting: ['in_progress', 'done'],
  done: [], // Terminal state - no outgoing transitions
};

/**
 * Validates a state transition and throws if illegal
 *
 * @param {string|null|undefined} from - Current WU status
 * @param {string|null|undefined} to - Desired WU status
 * @param {string} wuid - Work Unit ID (e.g., 'WU-416') for error messages
 * @throws {Error} If transition is illegal or states are invalid
 */
export function assertTransition(from, to, wuid) {
  // Validate states exist and are non-empty
  if (from === null || from === undefined || from === '') {
    throw createError(ErrorCodes.STATE_ERROR, `Invalid state: ${from}`, {
      wuid,
      from,
      to,
      reason: 'from state is null/undefined/empty',
    });
  }
  if (to === null || to === undefined || to === '') {
    throw createError(ErrorCodes.STATE_ERROR, `Invalid state: ${to}`, {
      wuid,
      from,
      to,
      reason: 'to state is null/undefined/empty',
    });
  }

  // Validate states are recognized
  if (!VALID_STATES.has(from)) {
    throw createError(ErrorCodes.STATE_ERROR, `Invalid state: ${from}`, {
      wuid,
      from,
      to,
      validStates: Array.from(VALID_STATES),
    });
  }
  if (!VALID_STATES.has(to)) {
    throw createError(ErrorCodes.STATE_ERROR, `Invalid state: ${to}`, {
      wuid,
      from,
      to,
      validStates: Array.from(VALID_STATES),
    });
  }

  // Check if transition is allowed
  const allowedNextStates = TRANSITIONS[from];
  if (!allowedNextStates.includes(to)) {
    const terminalHint = from === 'done' ? ' (done is a terminal state)' : '';
    throw createError(
      ErrorCodes.STATE_ERROR,
      `Illegal state transition for ${wuid}: ${from} → ${to}${terminalHint}`,
      { wuid, from, to, allowedNextStates },
    );
  }
}
