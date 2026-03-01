// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { createMockSignalSyncPort } from '../src/mock/mock-signal-sync-port.js';

describe('mock signal sync port', () => {
  it('supports signal push/pull round-trip with cursor pagination', async () => {
    const port = createMockSignalSyncPort();

    await port.pushSignals({
      workspace_id: 'ws-1',
      session_id: 'session-1',
      signals: [
        {
          id: 'sig-1',
          kind: 'wu.claimed',
          timestamp: '2026-03-01T00:00:00.000Z',
          payload: { wuId: 'WU-2151' },
        },
        {
          id: 'sig-2',
          kind: 'wu.done',
          timestamp: '2026-03-01T00:01:00.000Z',
          payload: { wuId: 'WU-2150' },
        },
      ],
    });

    const firstPage = await port.pullSignals({
      workspace_id: 'ws-1',
      session_id: 'session-1',
      limit: 1,
    });
    expect(firstPage.signals).toHaveLength(1);
    expect(firstPage.signals[0]?.id).toBe('sig-1');
    expect(firstPage.next_cursor).toBe('1');

    const secondPage = await port.pullSignals({
      workspace_id: 'ws-1',
      session_id: 'session-1',
      cursor: firstPage.next_cursor,
      limit: 1,
    });
    expect(secondPage.signals).toHaveLength(1);
    expect(secondPage.signals[0]?.id).toBe('sig-2');
    expect(secondPage.next_cursor).toBeUndefined();
  });

  it('supports session register/list/deregister lifecycle', async () => {
    const port = createMockSignalSyncPort({ now: () => '2026-03-01T00:00:00.000Z' });

    await port.registerSession({
      workspace_id: 'ws-1',
      session_id: 'session-a',
      agent_id: 'agent-a',
      started_at: '2026-03-01T00:00:00.000Z',
      lane: 'Framework: Core Lifecycle',
      wu_id: 'WU-2151',
    });
    await port.registerSession({
      workspace_id: 'ws-1',
      session_id: 'session-b',
      agent_id: 'agent-b',
      started_at: '2026-03-01T00:00:30.000Z',
      lane: 'Framework: Core Lifecycle',
      wu_id: 'WU-2151',
    });

    const activeOnly = await port.listSessions({
      workspace_id: 'ws-1',
      lane: 'Framework: Core Lifecycle',
    });
    expect(activeOnly.sessions).toHaveLength(2);

    const result = await port.deregisterSession({
      workspace_id: 'ws-1',
      session_id: 'session-a',
      ended_at: '2026-03-01T00:05:00.000Z',
      reason: 'done',
    });
    expect(result.accepted).toBe(1);

    const filtered = await port.listSessions({
      workspace_id: 'ws-1',
      include_inactive: false,
    });
    expect(filtered.sessions).toHaveLength(1);
    expect(filtered.sessions[0]?.session_id).toBe('session-b');

    const includeInactive = await port.listSessions({
      workspace_id: 'ws-1',
      include_inactive: true,
    });
    expect(includeInactive.sessions).toHaveLength(2);
    expect(
      includeInactive.sessions.find((session) => session.session_id === 'session-a')?.active,
    ).toBe(false);
  });

  it('supports bidirectional memory sync with conflict simulation', async () => {
    const port = createMockSignalSyncPort({ conflict_keys: ['project:WU-2149'] });

    await port.syncMemory({
      workspace_id: 'ws-1',
      direction: 'push',
      local_records: [
        {
          id: 'remote-seed-1',
          namespace: 'project',
          key: 'WU-2149',
          value: { status: 'ready' },
          updated_at: '2026-03-01T00:00:00.000Z',
          revision: 'r1',
        },
      ],
    });

    const result = await port.syncMemory({
      workspace_id: 'ws-1',
      direction: 'bidirectional',
      local_records: [
        {
          id: 'local-1',
          namespace: 'project',
          key: 'WU-2151',
          value: { status: 'in_progress' },
          updated_at: '2026-03-01T00:01:00.000Z',
          revision: 'r2',
        },
        {
          id: 'local-2',
          namespace: 'project',
          key: 'WU-2149',
          value: { status: 'done' },
          updated_at: '2026-03-01T00:02:00.000Z',
          revision: 'r3',
        },
      ],
      limit: 10,
    });

    expect(result.pushed).toBe(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      namespace: 'project',
      key: 'WU-2149',
      resolution: 'manual',
      local_revision: 'r3',
      remote_revision: 'r1',
    });
    expect(result.remote_records).toBeDefined();
    expect(result.remote_records?.map((record) => record.key).sort()).toEqual([
      'WU-2149',
      'WU-2151',
    ]);
  });
});
