// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  KERNEL_EVENT_KINDS,
  TOOL_TRACE_KINDS,
  type KernelEvent,
  type PolicyDecision,
  type TaskState,
  type ToolTraceEntry,
} from '@lumenflow/kernel';

const SOURCE = {
  KERNEL_EVENT: 'kernel_event',
  POLICY: 'policy',
  STATE_SYNC: 'state_sync',
  TOOL_TRACE: 'tool_trace',
} as const;

const JSON_POINTER_PREFIX = '/';

export const AG_UI_EVENT_TYPES = {
  RUN_STARTED: 'RUN_STARTED',
  STEP_STARTED: 'STEP_STARTED',
  STEP_BLOCKED: 'STEP_BLOCKED',
  STEP_UNBLOCKED: 'STEP_UNBLOCKED',
  STEP_WAITING: 'STEP_WAITING',
  STEP_RESUMED: 'STEP_RESUMED',
  RUN_COMPLETED: 'RUN_COMPLETED',
  RUN_RELEASED: 'RUN_RELEASED',
  RUN_DELEGATED: 'RUN_DELEGATED',
  STEP_PAUSED: 'STEP_PAUSED',
  STEP_FAILED: 'STEP_FAILED',
  STEP_SUCCEEDED: 'STEP_SUCCEEDED',
  WORKSPACE_UPDATED: 'WORKSPACE_UPDATED',
  WORKSPACE_WARNING: 'WORKSPACE_WARNING',
  SPEC_TAMPERED: 'SPEC_TAMPERED',
  CHECKPOINT: 'CHECKPOINT',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_END: 'TOOL_CALL_END',
  TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
  GOVERNANCE_DECISION: 'GOVERNANCE_DECISION',
  STATE_SNAPSHOT: 'StateSnapshot',
  STATE_DELTA: 'StateDelta',
  MESSAGES_SNAPSHOT: 'MessagesSnapshot',
} as const;

type AgUiEventType = (typeof AG_UI_EVENT_TYPES)[keyof typeof AG_UI_EVENT_TYPES];

interface EventMetadata {
  source: string;
  kernel_kind?: KernelEvent['kind'];
}

export interface AgUiEvent {
  type: AgUiEventType | string;
  timestamp: string;
  task_id?: string;
  run_id?: string;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
}

interface PolicyEventContext {
  task_id: string;
  run_id?: string;
  timestamp: string;
}

interface StateDeltaOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

function hasTaskId(event: KernelEvent): event is Extract<KernelEvent, { task_id: string }> {
  return 'task_id' in event;
}

function hasRunId(event: KernelEvent): event is Extract<KernelEvent, { run_id: string }> {
  return 'run_id' in event;
}

function hasToolRunId(
  entry: ToolTraceEntry,
): entry is Extract<ToolTraceEntry, { run_id: string; task_id: string }> {
  return 'run_id' in entry && 'task_id' in entry;
}

const KERNEL_KIND_TO_AG_UI_TYPE: Record<KernelEvent['kind'], AgUiEventType> = {
  [KERNEL_EVENT_KINDS.TASK_CREATED]: AG_UI_EVENT_TYPES.RUN_STARTED,
  [KERNEL_EVENT_KINDS.TASK_CLAIMED]: AG_UI_EVENT_TYPES.STEP_STARTED,
  [KERNEL_EVENT_KINDS.TASK_BLOCKED]: AG_UI_EVENT_TYPES.STEP_BLOCKED,
  [KERNEL_EVENT_KINDS.TASK_UNBLOCKED]: AG_UI_EVENT_TYPES.STEP_UNBLOCKED,
  [KERNEL_EVENT_KINDS.TASK_WAITING]: AG_UI_EVENT_TYPES.STEP_WAITING,
  [KERNEL_EVENT_KINDS.TASK_RESUMED]: AG_UI_EVENT_TYPES.STEP_RESUMED,
  [KERNEL_EVENT_KINDS.TASK_COMPLETED]: AG_UI_EVENT_TYPES.RUN_COMPLETED,
  [KERNEL_EVENT_KINDS.TASK_RELEASED]: AG_UI_EVENT_TYPES.RUN_RELEASED,
  [KERNEL_EVENT_KINDS.TASK_DELEGATED]: AG_UI_EVENT_TYPES.RUN_DELEGATED,
  [KERNEL_EVENT_KINDS.RUN_STARTED]: AG_UI_EVENT_TYPES.STEP_STARTED,
  [KERNEL_EVENT_KINDS.RUN_PAUSED]: AG_UI_EVENT_TYPES.STEP_PAUSED,
  [KERNEL_EVENT_KINDS.RUN_FAILED]: AG_UI_EVENT_TYPES.STEP_FAILED,
  [KERNEL_EVENT_KINDS.RUN_SUCCEEDED]: AG_UI_EVENT_TYPES.STEP_SUCCEEDED,
  [KERNEL_EVENT_KINDS.WORKSPACE_UPDATED]: AG_UI_EVENT_TYPES.WORKSPACE_UPDATED,
  [KERNEL_EVENT_KINDS.WORKSPACE_WARNING]: AG_UI_EVENT_TYPES.WORKSPACE_WARNING,
  [KERNEL_EVENT_KINDS.SPEC_TAMPERED]: AG_UI_EVENT_TYPES.SPEC_TAMPERED,
  [KERNEL_EVENT_KINDS.CHECKPOINT]: AG_UI_EVENT_TYPES.CHECKPOINT,
};

function createEventFromKernel(
  event: KernelEvent,
  type: AgUiEventType,
  payload: Record<string, unknown>,
): AgUiEvent {
  const mapped: AgUiEvent = {
    type,
    timestamp: event.timestamp,
    payload,
    metadata: {
      source: SOURCE.KERNEL_EVENT,
      kernel_kind: event.kind,
    },
  };

  if (hasTaskId(event)) {
    mapped.task_id = event.task_id;
  }
  if (hasRunId(event)) {
    mapped.run_id = event.run_id;
  }

  return mapped;
}

export function mapKernelEventToAgUiEvent(event: KernelEvent): AgUiEvent {
  const type = KERNEL_KIND_TO_AG_UI_TYPE[event.kind];
  return createEventFromKernel(event, type, {
    event,
  });
}

export function mapToolTraceEntryToAgUiEvents(entry: ToolTraceEntry): AgUiEvent[] {
  if (entry.kind === TOOL_TRACE_KINDS.TOOL_CALL_STARTED) {
    return [
      {
        type: AG_UI_EVENT_TYPES.TOOL_CALL_START,
        timestamp: entry.timestamp,
        task_id: entry.task_id,
        run_id: entry.run_id,
        payload: {
          receipt_id: entry.receipt_id,
          tool_name: entry.tool_name,
          execution_mode: entry.execution_mode,
          input_ref: entry.input_ref,
          input_hash: entry.input_hash,
          scope_requested: entry.scope_requested,
          scope_allowed: entry.scope_allowed,
          scope_enforced: entry.scope_enforced,
        },
        metadata: {
          source: SOURCE.TOOL_TRACE,
        },
      },
    ];
  }

  const common: AgUiEvent = {
    type: AG_UI_EVENT_TYPES.TOOL_CALL_END,
    timestamp: entry.timestamp,
    payload: {
      receipt_id: entry.receipt_id,
      result: entry.result,
      duration_ms: entry.duration_ms,
      policy_decisions: entry.policy_decisions,
      artifacts_written: entry.artifacts_written,
    },
    metadata: {
      source: SOURCE.TOOL_TRACE,
    },
  };

  const resultEvent: AgUiEvent = {
    type: AG_UI_EVENT_TYPES.TOOL_CALL_RESULT,
    timestamp: entry.timestamp,
    payload: {
      receipt_id: entry.receipt_id,
      output_hash: entry.output_hash,
      output_ref: entry.output_ref,
      redaction_summary: entry.redaction_summary,
      scope_enforcement_note: entry.scope_enforcement_note,
      result: entry.result,
    },
    metadata: {
      source: SOURCE.TOOL_TRACE,
    },
  };

  if (hasToolRunId(entry)) {
    common.task_id = entry.task_id;
    common.run_id = entry.run_id;
    resultEvent.task_id = entry.task_id;
    resultEvent.run_id = entry.run_id;
  }

  return [common, resultEvent];
}

export function mapPolicyDecisionToAgUiEvent(
  decision: PolicyDecision,
  context: PolicyEventContext,
): AgUiEvent {
  return {
    type: AG_UI_EVENT_TYPES.GOVERNANCE_DECISION,
    timestamp: context.timestamp,
    task_id: context.task_id,
    run_id: context.run_id,
    payload: {
      policy_id: decision.policy_id,
      decision: decision.decision,
      reason: decision.reason,
      governance: true,
    },
    metadata: {
      source: SOURCE.POLICY,
    },
  };
}

function toStateDeltaOperations(previous: TaskState, next: TaskState): StateDeltaOperation[] {
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)]);
  const operations: StateDeltaOperation[] = [];

  for (const key of keys) {
    const previousValue = previousRecord[key];
    const nextValue = nextRecord[key];

    const unchanged = JSON.stringify(previousValue) === JSON.stringify(nextValue);
    if (unchanged) {
      continue;
    }

    if (previousValue === undefined) {
      operations.push({
        op: 'add',
        path: `${JSON_POINTER_PREFIX}${key}`,
        value: nextValue,
      });
      continue;
    }

    if (nextValue === undefined) {
      operations.push({
        op: 'remove',
        path: `${JSON_POINTER_PREFIX}${key}`,
      });
      continue;
    }

    operations.push({
      op: 'replace',
      path: `${JSON_POINTER_PREFIX}${key}`,
      value: nextValue,
    });
  }

  return operations;
}

export function createStateSyncEvents(
  previousState: TaskState | undefined,
  nextState: TaskState,
  timestamp: string,
): AgUiEvent[] {
  const snapshotEvent: AgUiEvent = {
    type: AG_UI_EVENT_TYPES.STATE_SNAPSHOT,
    timestamp,
    task_id: nextState.task_id,
    payload: {
      state: nextState,
    },
    metadata: {
      source: SOURCE.STATE_SYNC,
    },
  };

  if (!previousState) {
    return [snapshotEvent];
  }

  const operations = toStateDeltaOperations(previousState, nextState);
  if (operations.length === 0) {
    return [snapshotEvent];
  }

  const deltaEvent: AgUiEvent = {
    type: AG_UI_EVENT_TYPES.STATE_DELTA,
    timestamp,
    task_id: nextState.task_id,
    payload: {
      patch: operations,
      from_status: previousState.status,
      to_status: nextState.status,
    },
    metadata: {
      source: SOURCE.STATE_SYNC,
    },
  };

  return [snapshotEvent, deltaEvent];
}

function isEventForTask(event: KernelEvent, taskId: string): boolean {
  if (!hasTaskId(event)) {
    // Global events (workspace_updated, workspace_warning, spec_tampered) are
    // included because they affect all tasks.
    return true;
  }
  return event.task_id === taskId;
}

export function createMessagesSnapshot(
  taskId: string,
  kernelEvents: KernelEvent[],
  timestamp: string,
): AgUiEvent {
  const relevantEvents = kernelEvents.filter((event) => isEventForTask(event, taskId));

  const sorted = [...relevantEvents].sort((left, right) => {
    return left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0;
  });

  return {
    type: AG_UI_EVENT_TYPES.MESSAGES_SNAPSHOT,
    timestamp,
    task_id: taskId,
    payload: {
      messages: sorted,
    },
    metadata: {
      source: SOURCE.STATE_SYNC,
    },
  };
}
