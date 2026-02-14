/**
 * Typed XState v5 state machine for the wu:done pipeline.
 *
 * WU-1662: Defines the canonical execution model for wu:done as an explicit
 * state machine with typed states, events, guards, and context.
 *
 * Pipeline stages:
 *   idle -> validating -> preparing -> gating -> committing -> merging -> pushing -> cleaningUp -> done
 *
 * Each operational state has a failure transition to a shared `failed` state.
 * The `failed` state supports a RETRY transition back to `validating`.
 *
 * Gate dedup (WU-1659): The `gating` state accepts GATES_SKIPPED only when
 * prepPassed is true (wu:prep already ran gates successfully).
 *
 * Snapshot support: XState v5 provides built-in getPersistedSnapshot() and
 * snapshot rehydration via createActor(machine, { snapshot }).
 *
 * This module is machine-definition only. No CLI behavior changes.
 * WU-1663 wires the CLI orchestrator to this machine.
 */

import { assign, setup, type SnapshotFrom, type ActorRefFrom } from 'xstate';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Pipeline state identifiers.
 */
export const WU_DONE_STATES = {
  IDLE: 'idle',
  VALIDATING: 'validating',
  PREPARING: 'preparing',
  GATING: 'gating',
  COMMITTING: 'committing',
  MERGING: 'merging',
  PUSHING: 'pushing',
  CLEANING_UP: 'cleaningUp',
  DONE: 'done',
  FAILED: 'failed',
} as const;

/**
 * Pipeline event type identifiers.
 */
export const WU_DONE_EVENTS = {
  START: 'wu.done.start',
  VALIDATION_PASSED: 'wu.done.validation.passed',
  VALIDATION_FAILED: 'wu.done.validation.failed',
  PREPARATION_COMPLETE: 'wu.done.preparation.complete',
  PREPARATION_FAILED: 'wu.done.preparation.failed',
  GATES_PASSED: 'wu.done.gates.passed',
  GATES_FAILED: 'wu.done.gates.failed',
  GATES_SKIPPED: 'wu.done.gates.skipped',
  COMMIT_COMPLETE: 'wu.done.commit.complete',
  COMMIT_FAILED: 'wu.done.commit.failed',
  MERGE_COMPLETE: 'wu.done.merge.complete',
  MERGE_FAILED: 'wu.done.merge.failed',
  PUSH_COMPLETE: 'wu.done.push.complete',
  PUSH_FAILED: 'wu.done.push.failed',
  CLEANUP_COMPLETE: 'wu.done.cleanup.complete',
  CLEANUP_FAILED: 'wu.done.cleanup.failed',
  RETRY: 'wu.done.retry',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context carried through the wu:done pipeline execution.
 */
export interface WuDonePipelineContext {
  /** Work unit ID (e.g., "WU-1662") */
  wuId: string | null;
  /** Path to the worktree for this WU */
  worktreePath: string | null;
  /** Whether wu:prep already ran gates successfully (WU-1659 gate dedup) */
  prepPassed: boolean;
  /** Error message from the most recent failure */
  error: string | null;
  /** The state where the failure occurred */
  failedAt: string | null;
  /** Number of retry attempts */
  retryCount: number;
}

/** Input for creating a wu:done pipeline actor with pre-populated context. */
export interface WuDonePipelineInput {
  wuId?: string | null;
  worktreePath?: string | null;
  prepPassed?: boolean;
}

// --- Event types ---

interface StartEvent {
  type: typeof WU_DONE_EVENTS.START;
  wuId: string;
  worktreePath: string;
}

interface ValidationPassedEvent {
  type: typeof WU_DONE_EVENTS.VALIDATION_PASSED;
}

interface ValidationFailedEvent {
  type: typeof WU_DONE_EVENTS.VALIDATION_FAILED;
  error: string;
}

interface PreparationCompleteEvent {
  type: typeof WU_DONE_EVENTS.PREPARATION_COMPLETE;
}

interface PreparationFailedEvent {
  type: typeof WU_DONE_EVENTS.PREPARATION_FAILED;
  error: string;
}

interface GatesPassedEvent {
  type: typeof WU_DONE_EVENTS.GATES_PASSED;
}

interface GatesFailedEvent {
  type: typeof WU_DONE_EVENTS.GATES_FAILED;
  error: string;
}

interface GatesSkippedEvent {
  type: typeof WU_DONE_EVENTS.GATES_SKIPPED;
}

interface CommitCompleteEvent {
  type: typeof WU_DONE_EVENTS.COMMIT_COMPLETE;
}

interface CommitFailedEvent {
  type: typeof WU_DONE_EVENTS.COMMIT_FAILED;
  error: string;
}

interface MergeCompleteEvent {
  type: typeof WU_DONE_EVENTS.MERGE_COMPLETE;
}

interface MergeFailedEvent {
  type: typeof WU_DONE_EVENTS.MERGE_FAILED;
  error: string;
}

interface PushCompleteEvent {
  type: typeof WU_DONE_EVENTS.PUSH_COMPLETE;
}

interface PushFailedEvent {
  type: typeof WU_DONE_EVENTS.PUSH_FAILED;
  error: string;
}

interface CleanupCompleteEvent {
  type: typeof WU_DONE_EVENTS.CLEANUP_COMPLETE;
}

interface CleanupFailedEvent {
  type: typeof WU_DONE_EVENTS.CLEANUP_FAILED;
  error: string;
}

interface RetryEvent {
  type: typeof WU_DONE_EVENTS.RETRY;
}

/** Union of all wu:done pipeline events. */
export type WuDonePipelineEvent =
  | StartEvent
  | ValidationPassedEvent
  | ValidationFailedEvent
  | PreparationCompleteEvent
  | PreparationFailedEvent
  | GatesPassedEvent
  | GatesFailedEvent
  | GatesSkippedEvent
  | CommitCompleteEvent
  | CommitFailedEvent
  | MergeCompleteEvent
  | MergeFailedEvent
  | PushCompleteEvent
  | PushFailedEvent
  | CleanupCompleteEvent
  | CleanupFailedEvent
  | RetryEvent;

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

/**
 * The wu:done pipeline state machine.
 *
 * Represents the canonical execution stages of the wu:done command with
 * explicit state/event/guard contracts and support for snapshot-based
 * persistence and rehydration.
 */
export const wuDoneMachine = setup({
  types: {
    context: {} as WuDonePipelineContext,
    events: {} as WuDonePipelineEvent,
    input: {} as WuDonePipelineInput,
  },
  guards: {
    /** WU-1659: Allow gate skip only when wu:prep already passed gates. */
    isPrepPassed: ({ context }) => context.prepPassed === true,
  },
}).createMachine({
  id: 'wuDonePipeline',
  initial: WU_DONE_STATES.IDLE,
  context: ({ input }) => ({
    wuId: input?.wuId ?? null,
    worktreePath: input?.worktreePath ?? null,
    prepPassed: input?.prepPassed ?? false,
    error: null,
    failedAt: null,
    retryCount: 0,
  }),
  states: {
    [WU_DONE_STATES.IDLE]: {
      on: {
        [WU_DONE_EVENTS.START]: {
          target: WU_DONE_STATES.VALIDATING,
          actions: assign({
            wuId: ({ event }) => event.wuId,
            worktreePath: ({ event }) => event.worktreePath,
          }),
        },
      },
    },

    [WU_DONE_STATES.VALIDATING]: {
      on: {
        [WU_DONE_EVENTS.VALIDATION_PASSED]: {
          target: WU_DONE_STATES.PREPARING,
        },
        [WU_DONE_EVENTS.VALIDATION_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.VALIDATING,
          }),
        },
      },
    },

    [WU_DONE_STATES.PREPARING]: {
      on: {
        [WU_DONE_EVENTS.PREPARATION_COMPLETE]: {
          target: WU_DONE_STATES.GATING,
        },
        [WU_DONE_EVENTS.PREPARATION_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.PREPARING,
          }),
        },
      },
    },

    [WU_DONE_STATES.GATING]: {
      on: {
        [WU_DONE_EVENTS.GATES_PASSED]: {
          target: WU_DONE_STATES.COMMITTING,
        },
        [WU_DONE_EVENTS.GATES_SKIPPED]: {
          target: WU_DONE_STATES.COMMITTING,
          guard: 'isPrepPassed',
        },
        [WU_DONE_EVENTS.GATES_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.GATING,
          }),
        },
      },
    },

    [WU_DONE_STATES.COMMITTING]: {
      on: {
        [WU_DONE_EVENTS.COMMIT_COMPLETE]: {
          target: WU_DONE_STATES.MERGING,
        },
        [WU_DONE_EVENTS.COMMIT_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.COMMITTING,
          }),
        },
      },
    },

    [WU_DONE_STATES.MERGING]: {
      on: {
        [WU_DONE_EVENTS.MERGE_COMPLETE]: {
          target: WU_DONE_STATES.PUSHING,
        },
        [WU_DONE_EVENTS.MERGE_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.MERGING,
          }),
        },
      },
    },

    [WU_DONE_STATES.PUSHING]: {
      on: {
        [WU_DONE_EVENTS.PUSH_COMPLETE]: {
          target: WU_DONE_STATES.CLEANING_UP,
        },
        [WU_DONE_EVENTS.PUSH_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.PUSHING,
          }),
        },
      },
    },

    [WU_DONE_STATES.CLEANING_UP]: {
      on: {
        [WU_DONE_EVENTS.CLEANUP_COMPLETE]: {
          target: WU_DONE_STATES.DONE,
        },
        [WU_DONE_EVENTS.CLEANUP_FAILED]: {
          target: WU_DONE_STATES.FAILED,
          actions: assign({
            error: ({ event }) => event.error,
            failedAt: WU_DONE_STATES.CLEANING_UP,
          }),
        },
      },
    },

    [WU_DONE_STATES.DONE]: {
      type: 'final',
    },

    [WU_DONE_STATES.FAILED]: {
      on: {
        [WU_DONE_EVENTS.RETRY]: {
          target: WU_DONE_STATES.VALIDATING,
          actions: assign({
            error: null,
            failedAt: null,
            retryCount: ({ context }) => context.retryCount + 1,
          }),
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

/** Snapshot type for the wu:done pipeline machine. */
export type WuDonePipelineSnapshot = SnapshotFrom<typeof wuDoneMachine>;

/** Actor reference type for the wu:done pipeline machine. */
export type WuDonePipelineActorRef = ActorRefFrom<typeof wuDoneMachine>;
