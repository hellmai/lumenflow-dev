// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { KERNEL_EVENT_KINDS, type KernelEvent, type TaskState } from '@lumenflow/kernel';
import { describe, expect, it } from 'vitest';
import {
  AG_UI_EVENT_TYPES,
  createStateSyncEvents,
  createMessagesSnapshot,
  type AgUiEvent,
} from '../http/ag-ui-adapter.js';

const TIMESTAMP = {
  ZERO: '2026-02-18T00:00:00.000Z',
  ONE: '2026-02-18T00:00:01.000Z',
  TWO: '2026-02-18T00:00:02.000Z',
  THREE: '2026-02-18T00:00:03.000Z',
} as const;

const TASK = {
  ID: 'WU-1831',
  RUN_ID: 'run-WU-1831-1',
  SESSION_ID: 'session-WU-1831',
} as const;

const HASH = {
  SPEC: 'a'.repeat(64),
} as const;

describe('AG-UI state synchronization (WU-1831)', () => {
  describe('AC1: StateSnapshot emitted on initial connection', () => {
    it('emits a single StateSnapshot when previousState is undefined', () => {
      const state: TaskState = {
        task_id: TASK.ID,
        status: 'ready',
        run_count: 0,
      };

      const events = createStateSyncEvents(undefined, state, TIMESTAMP.ZERO);

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe(AG_UI_EVENT_TYPES.STATE_SNAPSHOT);
      expect(events[0]?.payload.state).toEqual(state);
      expect(events[0]?.task_id).toBe(TASK.ID);
      expect(events[0]?.timestamp).toBe(TIMESTAMP.ZERO);
      expect(events[0]?.metadata.source).toBe('state_sync');
    });

    it('includes the full TaskState in the snapshot payload', () => {
      const state: TaskState = {
        task_id: TASK.ID,
        status: 'active',
        run_count: 1,
        claimed_by: 'agent-1',
        session_id: TASK.SESSION_ID,
      };

      const events = createStateSyncEvents(undefined, state, TIMESTAMP.ZERO);

      const snapshot = events[0];
      expect(snapshot?.type).toBe(AG_UI_EVENT_TYPES.STATE_SNAPSHOT);
      const payloadState = snapshot?.payload.state as TaskState;
      expect(payloadState.task_id).toBe(TASK.ID);
      expect(payloadState.status).toBe('active');
      expect(payloadState.run_count).toBe(1);
      expect(payloadState.claimed_by).toBe('agent-1');
    });
  });

  describe('AC2: StateDelta emitted as RFC 6902 JSON Patch on state changes', () => {
    it('emits StateDelta with RFC 6902 patch operations when state changes', () => {
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

      const events = createStateSyncEvents(previousState, nextState, TIMESTAMP.ONE);

      const deltaEvent = events.find((event) => event.type === AG_UI_EVENT_TYPES.STATE_DELTA);
      expect(deltaEvent).toBeDefined();
      expect(deltaEvent?.task_id).toBe(TASK.ID);
      expect(deltaEvent?.timestamp).toBe(TIMESTAMP.ONE);
      expect(deltaEvent?.metadata.source).toBe('state_sync');
    });

    it('produces RFC 6902 replace operations for changed fields', () => {
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

      const events = createStateSyncEvents(previousState, nextState, TIMESTAMP.ONE);
      const deltaEvent = events.find((event) => event.type === AG_UI_EVENT_TYPES.STATE_DELTA);

      const patch = deltaEvent?.payload.patch as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;
      expect(Array.isArray(patch)).toBe(true);

      const statusOp = patch.find((op) => op.path === '/status');
      expect(statusOp).toBeDefined();
      expect(statusOp?.op).toBe('replace');
      expect(statusOp?.value).toBe('active');

      const runCountOp = patch.find((op) => op.path === '/run_count');
      expect(runCountOp).toBeDefined();
      expect(runCountOp?.op).toBe('replace');
      expect(runCountOp?.value).toBe(1);
    });

    it('produces RFC 6902 add operations for new fields', () => {
      const previousState: TaskState = {
        task_id: TASK.ID,
        status: 'ready',
        run_count: 0,
      };
      const nextState: TaskState = {
        task_id: TASK.ID,
        status: 'active',
        run_count: 1,
        claimed_by: 'agent-1',
        session_id: TASK.SESSION_ID,
      };

      const events = createStateSyncEvents(previousState, nextState, TIMESTAMP.ONE);
      const deltaEvent = events.find((event) => event.type === AG_UI_EVENT_TYPES.STATE_DELTA);

      const patch = deltaEvent?.payload.patch as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;

      const claimedByOp = patch.find((op) => op.path === '/claimed_by');
      expect(claimedByOp).toBeDefined();
      expect(claimedByOp?.op).toBe('add');
      expect(claimedByOp?.value).toBe('agent-1');
    });

    it('produces RFC 6902 remove operations for removed fields', () => {
      const previousState: TaskState = {
        task_id: TASK.ID,
        status: 'blocked',
        run_count: 1,
        blocked_reason: 'waiting for input',
      };
      const nextState: TaskState = {
        task_id: TASK.ID,
        status: 'active',
        run_count: 1,
      };

      const events = createStateSyncEvents(previousState, nextState, TIMESTAMP.ONE);
      const deltaEvent = events.find((event) => event.type === AG_UI_EVENT_TYPES.STATE_DELTA);

      const patch = deltaEvent?.payload.patch as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;

      const blockedOp = patch.find((op) => op.path === '/blocked_reason');
      expect(blockedOp).toBeDefined();
      expect(blockedOp?.op).toBe('remove');
    });

    it('includes from_status and to_status in delta payload', () => {
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

      const events = createStateSyncEvents(previousState, nextState, TIMESTAMP.ONE);
      const deltaEvent = events.find((event) => event.type === AG_UI_EVENT_TYPES.STATE_DELTA);

      expect(deltaEvent?.payload.from_status).toBe('ready');
      expect(deltaEvent?.payload.to_status).toBe('active');
    });

    it('emits only StateSnapshot when state has not changed', () => {
      const state: TaskState = {
        task_id: TASK.ID,
        status: 'active',
        run_count: 1,
      };

      const events = createStateSyncEvents(state, state, TIMESTAMP.ONE);

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe(AG_UI_EVENT_TYPES.STATE_SNAPSHOT);
    });
  });

  describe('AC3: MessagesSnapshot built from event replay', () => {
    it('returns a MESSAGES_SNAPSHOT event from kernel events', () => {
      const kernelEvents: KernelEvent[] = [
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
          timestamp: TIMESTAMP.ONE,
          by: 'agent-1',
          session_id: TASK.SESSION_ID,
        },
      ];

      const event = createMessagesSnapshot(TASK.ID, kernelEvents, TIMESTAMP.TWO);

      expect(event.type).toBe(AG_UI_EVENT_TYPES.MESSAGES_SNAPSHOT);
      expect(event.task_id).toBe(TASK.ID);
      expect(event.timestamp).toBe(TIMESTAMP.TWO);
      expect(event.metadata.source).toBe('state_sync');
    });

    it('includes kernel events as messages in chronological order', () => {
      const kernelEvents: KernelEvent[] = [
        {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.TASK_CLAIMED,
          task_id: TASK.ID,
          timestamp: TIMESTAMP.ONE,
          by: 'agent-1',
          session_id: TASK.SESSION_ID,
        },
        {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.TASK_CREATED,
          task_id: TASK.ID,
          timestamp: TIMESTAMP.ZERO,
          spec_hash: HASH.SPEC,
        },
      ];

      const event = createMessagesSnapshot(TASK.ID, kernelEvents, TIMESTAMP.TWO);

      const messages = event.payload.messages as Array<{ kind: string; timestamp: string }>;
      expect(Array.isArray(messages)).toBe(true);
      expect(messages).toHaveLength(2);
      // Should be sorted chronologically
      expect(messages[0]?.timestamp).toBe(TIMESTAMP.ZERO);
      expect(messages[1]?.timestamp).toBe(TIMESTAMP.ONE);
    });

    it('returns empty messages array when no events exist', () => {
      const event = createMessagesSnapshot(TASK.ID, [], TIMESTAMP.ZERO);

      expect(event.type).toBe(AG_UI_EVENT_TYPES.MESSAGES_SNAPSHOT);
      const messages = event.payload.messages as unknown[];
      expect(messages).toHaveLength(0);
    });

    it('preserves full event data in each message entry', () => {
      const kernelEvents: KernelEvent[] = [
        {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.TASK_BLOCKED,
          task_id: TASK.ID,
          timestamp: TIMESTAMP.ONE,
          reason: 'external dependency',
        },
      ];

      const event = createMessagesSnapshot(TASK.ID, kernelEvents, TIMESTAMP.TWO);

      const messages = event.payload.messages as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.kind).toBe(KERNEL_EVENT_KINDS.TASK_BLOCKED);
      expect(messages[0]?.reason).toBe('external dependency');
    });

    it('filters events to the specified task_id', () => {
      const kernelEvents: KernelEvent[] = [
        {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.TASK_CREATED,
          task_id: TASK.ID,
          timestamp: TIMESTAMP.ZERO,
          spec_hash: HASH.SPEC,
        },
        {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.TASK_CREATED,
          task_id: 'WU-OTHER',
          timestamp: TIMESTAMP.ONE,
          spec_hash: HASH.SPEC,
        },
        {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.WORKSPACE_UPDATED,
          timestamp: TIMESTAMP.TWO,
          config_hash: 'c'.repeat(64),
          changes_summary: 'updated',
        },
      ];

      const event = createMessagesSnapshot(TASK.ID, kernelEvents, TIMESTAMP.THREE);

      const messages = event.payload.messages as Array<Record<string, unknown>>;
      // Should include TASK.ID event and global workspace event, exclude WU-OTHER
      expect(messages).toHaveLength(2);
      const taskIds = messages.filter((msg) => 'task_id' in msg).map((msg) => msg.task_id);
      expect(taskIds).not.toContain('WU-OTHER');
    });
  });
});
