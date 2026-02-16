import { setup } from 'xstate';
import type { TaskState } from '../kernel.schemas.js';

export const TASK_LIFECYCLE_STATES = {
  READY: 'ready',
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  WAITING: 'waiting',
  DONE: 'done',
} as const;

export const TASK_LIFECYCLE_EVENTS = {
  CLAIM: 'task.claim',
  BLOCK: 'task.block',
  WAIT: 'task.wait',
  COMPLETE: 'task.complete',
  RELEASE: 'task.release',
  UNBLOCK: 'task.unblock',
  RESUME: 'task.resume',
} as const;

export type TaskLifecycleState = TaskState['status'];
export type TaskStateAliases = Partial<Record<TaskLifecycleState, string>>;

interface ClaimEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.CLAIM;
}

interface BlockEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.BLOCK;
}

interface WaitEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.WAIT;
}

interface CompleteEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.COMPLETE;
}

interface ReleaseEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.RELEASE;
}

interface UnblockEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.UNBLOCK;
}

interface ResumeEvent {
  type: typeof TASK_LIFECYCLE_EVENTS.RESUME;
}

export type TaskLifecycleEvent =
  | ClaimEvent
  | BlockEvent
  | WaitEvent
  | CompleteEvent
  | ReleaseEvent
  | UnblockEvent
  | ResumeEvent;

const CANONICAL_STATES: TaskLifecycleState[] = [
  TASK_LIFECYCLE_STATES.READY,
  TASK_LIFECYCLE_STATES.ACTIVE,
  TASK_LIFECYCLE_STATES.BLOCKED,
  TASK_LIFECYCLE_STATES.WAITING,
  TASK_LIFECYCLE_STATES.DONE,
];

const ALLOWED_TRANSITIONS: Record<TaskLifecycleState, TaskLifecycleState[]> = {
  ready: ['active'],
  active: ['blocked', 'waiting', 'done', 'ready'],
  blocked: ['active', 'done'],
  waiting: ['active', 'done'],
  done: [],
};

export const taskLifecycleMachine = setup({
  types: {
    events: {} as TaskLifecycleEvent,
  },
}).createMachine({
  id: 'kernelTaskLifecycle',
  initial: TASK_LIFECYCLE_STATES.READY,
  states: {
    [TASK_LIFECYCLE_STATES.READY]: {
      on: {
        [TASK_LIFECYCLE_EVENTS.CLAIM]: TASK_LIFECYCLE_STATES.ACTIVE,
      },
    },
    [TASK_LIFECYCLE_STATES.ACTIVE]: {
      on: {
        [TASK_LIFECYCLE_EVENTS.BLOCK]: TASK_LIFECYCLE_STATES.BLOCKED,
        [TASK_LIFECYCLE_EVENTS.WAIT]: TASK_LIFECYCLE_STATES.WAITING,
        [TASK_LIFECYCLE_EVENTS.COMPLETE]: TASK_LIFECYCLE_STATES.DONE,
        [TASK_LIFECYCLE_EVENTS.RELEASE]: TASK_LIFECYCLE_STATES.READY,
      },
    },
    [TASK_LIFECYCLE_STATES.BLOCKED]: {
      on: {
        [TASK_LIFECYCLE_EVENTS.UNBLOCK]: TASK_LIFECYCLE_STATES.ACTIVE,
        [TASK_LIFECYCLE_EVENTS.COMPLETE]: TASK_LIFECYCLE_STATES.DONE,
      },
    },
    [TASK_LIFECYCLE_STATES.WAITING]: {
      on: {
        [TASK_LIFECYCLE_EVENTS.RESUME]: TASK_LIFECYCLE_STATES.ACTIVE,
        [TASK_LIFECYCLE_EVENTS.COMPLETE]: TASK_LIFECYCLE_STATES.DONE,
      },
    },
    [TASK_LIFECYCLE_STATES.DONE]: {
      type: 'final',
    },
  },
});

function buildAliasLookup(aliases: TaskStateAliases): Map<string, TaskLifecycleState> {
  const lookup = new Map<string, TaskLifecycleState>();

  for (const state of CANONICAL_STATES) {
    lookup.set(state, state);
  }

  for (const [state, alias] of Object.entries(aliases) as Array<[TaskLifecycleState, string]>) {
    if (!alias) {
      continue;
    }
    const normalizedAlias = alias.trim();
    if (!normalizedAlias) {
      throw new Error(`Invalid alias for state "${state}": alias must be non-empty`);
    }
    const existing = lookup.get(normalizedAlias);
    if (existing && existing !== state) {
      throw new Error(
        `Ambiguous alias "${normalizedAlias}" resolves to both "${existing}" and "${state}"`,
      );
    }
    lookup.set(normalizedAlias, state);
  }

  return lookup;
}

export function resolveTaskState(
  state: string | null | undefined,
  aliases: TaskStateAliases = {},
): TaskLifecycleState {
  if (state === null || state === undefined) {
    throw new Error(`Invalid state: ${state}`);
  }

  const normalized = state.trim();
  if (!normalized) {
    throw new Error(`Invalid state: ${state}`);
  }

  const lookup = buildAliasLookup(aliases);
  const resolved = lookup.get(normalized);
  if (!resolved) {
    throw new Error(
      `Invalid state: ${state}. Expected one of: ${Array.from(lookup.keys()).join(', ')}`,
    );
  }

  return resolved;
}

export function assertTransition(
  from: string | null | undefined,
  to: string | null | undefined,
  taskId: string,
  aliases: TaskStateAliases = {},
): void {
  const fromState = resolveTaskState(from, aliases);
  const toState = resolveTaskState(to, aliases);
  const allowed = ALLOWED_TRANSITIONS[fromState];

  if (!allowed.includes(toState)) {
    const terminalHint =
      fromState === TASK_LIFECYCLE_STATES.DONE ? ' (done is a terminal state)' : '';
    const allowedNext = allowed.length > 0 ? allowed.join(', ') : '(none)';
    throw new Error(
      `Illegal state transition for ${taskId}: ${fromState} -> ${toState}${terminalHint}. Allowed next states: ${allowedNext}`,
    );
  }
}
