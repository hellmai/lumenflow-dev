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
import { describe, expect, it } from 'vitest';
import {
  AG_UI_EVENT_TYPES,
  createStateSyncEvents,
  mapKernelEventToAgUiEvent,
  mapPolicyDecisionToAgUiEvent,
  mapToolTraceEntryToAgUiEvents,
} from '../http/ag-ui-adapter.js';

const TIMESTAMP = {
  ZERO: '2026-02-18T00:00:00.000Z',
  ONE: '2026-02-18T00:00:01.000Z',
} as const;

const TASK = {
  ID: 'WU-1818',
  RUN_ID: 'run-WU-1818-1',
  SESSION_ID: 'session-WU-1818',
} as const;

const HASH = {
  SPEC: 'a'.repeat(64),
  EXPECTED: 'b'.repeat(64),
  ACTUAL: 'c'.repeat(64),
  INPUT: 'd'.repeat(64),
  OUTPUT: 'e'.repeat(64),
  WORKSPACE: 'f'.repeat(64),
  CONFIG: '1'.repeat(64),
} as const;

const TOOL = {
  RECEIPT_ID: 'receipt-1818',
  NAME: 'task.inspect',
  VERSION: '1.0.0',
  RUNTIME_VERSION: '2.21.0',
  INPUT_REF: 'evidence://input/1',
  OUTPUT_REF: 'evidence://output/1',
} as const;

function makeKernelEvents(): KernelEvent[] {
  return [
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_CREATED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      spec_hash: HASH.SPEC,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_CLAIMED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      by: 'tom',
      session_id: TASK.SESSION_ID,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_BLOCKED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      reason: 'blocked',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_UNBLOCKED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_WAITING,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      reason: 'waiting',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_RESUMED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_COMPLETED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_RELEASED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      reason: 'released',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_DELEGATED,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      parent_task_id: 'WU-parent',
      delegation_id: 'delegate-1818',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.RUN_STARTED,
      task_id: TASK.ID,
      run_id: TASK.RUN_ID,
      timestamp: TIMESTAMP.ZERO,
      by: 'tom',
      session_id: TASK.SESSION_ID,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.RUN_PAUSED,
      task_id: TASK.ID,
      run_id: TASK.RUN_ID,
      timestamp: TIMESTAMP.ZERO,
      reason: 'pause',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.RUN_FAILED,
      task_id: TASK.ID,
      run_id: TASK.RUN_ID,
      timestamp: TIMESTAMP.ZERO,
      reason: 'failure',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.RUN_SUCCEEDED,
      task_id: TASK.ID,
      run_id: TASK.RUN_ID,
      timestamp: TIMESTAMP.ZERO,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.WORKSPACE_UPDATED,
      timestamp: TIMESTAMP.ZERO,
      config_hash: HASH.CONFIG,
      changes_summary: 'updated',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.WORKSPACE_WARNING,
      timestamp: TIMESTAMP.ZERO,
      message: 'warning',
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.SPEC_TAMPERED,
      timestamp: TIMESTAMP.ZERO,
      spec: 'workspace',
      id: TASK.ID,
      expected_hash: HASH.EXPECTED,
      actual_hash: HASH.ACTUAL,
    },
    {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.CHECKPOINT,
      task_id: TASK.ID,
      timestamp: TIMESTAMP.ZERO,
      note: 'checkpoint',
    },
  ];
}

function makeToolTraceStarted(): ToolTraceEntry {
  return {
    schema_version: 1,
    kind: TOOL_TRACE_KINDS.TOOL_CALL_STARTED,
    receipt_id: TOOL.RECEIPT_ID,
    run_id: TASK.RUN_ID,
    task_id: TASK.ID,
    session_id: TASK.SESSION_ID,
    timestamp: TIMESTAMP.ZERO,
    tool_name: TOOL.NAME,
    execution_mode: 'in-process',
    scope_requested: [],
    scope_allowed: [],
    scope_enforced: [],
    input_hash: HASH.INPUT,
    input_ref: TOOL.INPUT_REF,
    tool_version: TOOL.VERSION,
    workspace_config_hash: HASH.WORKSPACE,
    runtime_version: TOOL.RUNTIME_VERSION,
  };
}

function makeToolTraceFinished(): ToolTraceEntry {
  return {
    schema_version: 1,
    kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
    receipt_id: TOOL.RECEIPT_ID,
    timestamp: TIMESTAMP.ONE,
    result: 'success',
    duration_ms: 10,
    output_hash: HASH.OUTPUT,
    output_ref: TOOL.OUTPUT_REF,
    policy_decisions: [],
  };
}

describe('surfaces/http ag-ui adapter', () => {
  it('maps all 17 kernel event kinds to AG-UI events', () => {
    const kernelEvents = makeKernelEvents();
    expect(kernelEvents).toHaveLength(17);

    for (const kernelEvent of kernelEvents) {
      const mapped = mapKernelEventToAgUiEvent(kernelEvent);
      expect(typeof mapped.type).toBe('string');
      expect(mapped.type.length).toBeGreaterThan(0);
      expect(mapped.metadata.kernel_kind).toBe(kernelEvent.kind);
    }
  });

  it('maps ToolTraceEntry to TOOL_CALL_START/END/RESULT events', () => {
    const started = mapToolTraceEntryToAgUiEvents(makeToolTraceStarted());
    const finished = mapToolTraceEntryToAgUiEvents(makeToolTraceFinished());
    const allTypes = [...started, ...finished].map((event) => event.type);

    expect(allTypes).toContain(AG_UI_EVENT_TYPES.TOOL_CALL_START);
    expect(allTypes).toContain(AG_UI_EVENT_TYPES.TOOL_CALL_END);
    expect(allTypes).toContain(AG_UI_EVENT_TYPES.TOOL_CALL_RESULT);
  });

  it('ignores non-schema task/run identifiers on tool_call_finished entries', () => {
    const finishedWithRuntimeExtras = {
      ...makeToolTraceFinished(),
      task_id: TASK.ID,
      run_id: TASK.RUN_ID,
    } as ToolTraceEntry & { task_id: string; run_id: string };

    const [endEvent, resultEvent] = mapToolTraceEntryToAgUiEvents(finishedWithRuntimeExtras);

    expect(endEvent?.task_id).toBeUndefined();
    expect(endEvent?.run_id).toBeUndefined();
    expect(resultEvent?.task_id).toBeUndefined();
    expect(resultEvent?.run_id).toBeUndefined();
  });

  it('maps policy decisions into governance events with metadata', () => {
    const decision: PolicyDecision = {
      policy_id: 'runtime.policy.allow',
      decision: 'allow',
      reason: 'granted',
    };

    const event = mapPolicyDecisionToAgUiEvent(decision, {
      task_id: TASK.ID,
      run_id: TASK.RUN_ID,
      timestamp: TIMESTAMP.ZERO,
    });

    expect(event.type).toBe(AG_UI_EVENT_TYPES.GOVERNANCE_DECISION);
    expect(event.payload.policy_id).toBe(decision.policy_id);
    expect(event.payload.decision).toBe(decision.decision);
    expect(event.payload.reason).toBe(decision.reason);
  });

  it('emits StateSnapshot on initial connection and StateDelta on change', () => {
    const previousState: TaskState = {
      task_id: TASK.ID,
      status: 'ready',
      run_count: 0,
    };
    const nextState: TaskState = {
      task_id: TASK.ID,
      status: 'active',
      run_count: 1,
    };

    const initialEvents = createStateSyncEvents(undefined, previousState, TIMESTAMP.ZERO);
    expect(initialEvents).toHaveLength(1);
    expect(initialEvents[0]?.type).toBe(AG_UI_EVENT_TYPES.STATE_SNAPSHOT);

    const changedEvents = createStateSyncEvents(previousState, nextState, TIMESTAMP.ONE);
    expect(changedEvents.map((event) => event.type)).toContain(AG_UI_EVENT_TYPES.STATE_SNAPSHOT);
    expect(changedEvents.map((event) => event.type)).toContain(AG_UI_EVENT_TYPES.STATE_DELTA);
  });
});
