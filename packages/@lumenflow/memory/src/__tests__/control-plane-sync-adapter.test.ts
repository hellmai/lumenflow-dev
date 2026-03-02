// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSignals } from '../mem-signal-core.js';
import {
  createControlPlaneSyncAdapter,
  DEFAULT_CONTROL_PLANE_SYNC_STATE_PATH,
  type SyncMemoryResult,
} from '../control-plane-sync-adapter.js';

const SIGNALS_FILE = path.join('.lumenflow', 'memory', 'signals.jsonl');
const MEMORY_FILE = path.join('.lumenflow', 'memory', 'memory.jsonl');

const WORKSPACE_ID = 'workspace-test';
const SESSION_ID = 'session-test';

type LocalSignal = {
  id: string;
  message: string;
  created_at: string;
  read: boolean;
  wu_id?: string;
  lane?: string;
  type?: string;
  origin?: string;
  sender?: string;
  target_agent?: string;
  remote_id?: string;
};

type SignalEntry = {
  id: string;
  kind: string;
  timestamp: string;
  payload: Record<string, unknown>;
  origin?: 'local' | 'remote';
  source_agent_id?: string;
};

type PullSignalsResult = {
  signals: SignalEntry[];
  next_cursor?: string;
};

type MemoryNodeFixture = {
  id: string;
  type: 'session' | 'discovery' | 'checkpoint' | 'note' | 'summary';
  lifecycle: 'ephemeral' | 'session' | 'wu' | 'project';
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
};

async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.writeFile(filePath, `${content}${content ? '\n' : ''}`, 'utf-8');
}

async function readSyncState(baseDir: string): Promise<Record<string, unknown>> {
  const statePath = path.join(baseDir, DEFAULT_CONTROL_PLANE_SYNC_STATE_PATH);
  const raw = await fs.readFile(statePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('control-plane sync adapter (WU-2152)', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('pushes local-only signals and ignores origin:remote entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'control-plane-sync-adapter-'));
    tempRoots.push(root);

    await writeJsonl(path.join(root, SIGNALS_FILE), [
      {
        id: 'sig-local01',
        message: 'local signal',
        created_at: '2026-03-02T00:00:00.000Z',
        read: false,
        wu_id: 'WU-2152',
        type: 'handoff',
      } satisfies LocalSignal,
      {
        id: 'sig-remote01',
        message: 'remote signal',
        created_at: '2026-03-02T00:00:01.000Z',
        read: false,
        wu_id: 'WU-2152',
        origin: 'remote',
      } satisfies LocalSignal,
    ]);

    const pushInputs: SignalEntry[][] = [];
    const adapter = createControlPlaneSyncAdapter({
      baseDir: root,
      workspaceId: WORKSPACE_ID,
      sessionId: SESSION_ID,
      signalPort: {
        async pushSignals(input) {
          pushInputs.push(input.signals);
          return { accepted: input.signals.length };
        },
        async pullSignals(): Promise<PullSignalsResult> {
          return { signals: [] };
        },
      },
      memoryPort: {
        async syncMemory(): Promise<SyncMemoryResult> {
          return { pushed: 0, pulled: 0, conflicts: [] };
        },
      },
    });

    const result = await adapter.pushLocalSignals();
    expect(result.pushed).toBe(1);
    expect(pushInputs).toHaveLength(1);
    expect(pushInputs[0]).toEqual([
      expect.objectContaining({
        id: 'sig-local01',
        kind: 'handoff',
        origin: 'local',
      }),
    ]);

    const syncState = await readSyncState(root);
    expect(syncState.lastPushedSignalId).toBe('sig-local01');
  });

  it('pulls remote signals to local JSONL and prevents re-push echo loops', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'control-plane-sync-adapter-'));
    tempRoots.push(root);

    const pushedSignals: SignalEntry[][] = [];
    const adapter = createControlPlaneSyncAdapter({
      baseDir: root,
      workspaceId: WORKSPACE_ID,
      sessionId: SESSION_ID,
      signalPort: {
        async pushSignals(input) {
          pushedSignals.push(input.signals);
          return { accepted: input.signals.length };
        },
        async pullSignals() {
          return {
            signals: [
              {
                id: 'sig-remote-100',
                kind: 'handoff',
                timestamp: '2026-03-02T00:10:00.000Z',
                payload: {
                  message: 'remote handoff',
                  wu_id: 'WU-2152',
                  lane: 'Framework: Memory',
                },
                origin: 'remote',
                source_agent_id: 'agent-remote',
              },
            ],
            next_cursor: 'cursor-100',
          } satisfies PullSignalsResult;
        },
      },
      memoryPort: {
        async syncMemory(): Promise<SyncMemoryResult> {
          return { pushed: 0, pulled: 0, conflicts: [] };
        },
      },
    });

    const pullResult = await adapter.pullSignals();
    expect(pullResult.pulled).toBe(1);

    const localSignals = await loadSignals(root, { wuId: 'WU-2152' });
    expect(localSignals).toHaveLength(1);
    expect(localSignals[0]).toEqual(
      expect.objectContaining({
        message: 'remote handoff',
        origin: 'remote',
        remote_id: 'sig-remote-100',
      }),
    );

    const pushResult = await adapter.pushLocalSignals();
    expect(pushResult.pushed).toBe(0);
    expect(pushedSignals).toHaveLength(0);

    const syncState = await readSyncState(root);
    expect(syncState.pullCursor).toBe('cursor-100');
  });

  it('syncs only project lifecycle memory nodes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'control-plane-sync-adapter-'));
    tempRoots.push(root);

    await writeJsonl(path.join(root, MEMORY_FILE), [
      {
        id: 'mem-p001',
        type: 'note',
        lifecycle: 'project',
        content: 'project memory',
        created_at: '2026-03-02T00:00:00.000Z',
      } satisfies MemoryNodeFixture,
      {
        id: 'mem-w001',
        type: 'note',
        lifecycle: 'wu',
        content: 'wu memory',
        created_at: '2026-03-02T00:00:01.000Z',
      } satisfies MemoryNodeFixture,
    ]);

    let capturedLocalRecords: { id: string; namespace: string; key: string }[] = [];
    const adapter = createControlPlaneSyncAdapter({
      baseDir: root,
      workspaceId: WORKSPACE_ID,
      sessionId: SESSION_ID,
      signalPort: {
        async pushSignals() {
          return { accepted: 0 };
        },
        async pullSignals(): Promise<PullSignalsResult> {
          return { signals: [] };
        },
      },
      memoryPort: {
        async syncMemory(input: {
          local_records: Array<{ id: string; namespace: string; key: string }>;
        }) {
          capturedLocalRecords = input.local_records.map((record) => ({
            id: record.id,
            namespace: record.namespace,
            key: record.key,
          }));
          return { pushed: input.local_records.length, pulled: 0, conflicts: [] };
        },
      },
    });

    const result = await adapter.syncProjectMemory();
    expect(result.pushed).toBe(1);
    expect(capturedLocalRecords).toEqual([
      {
        id: 'mem-p001',
        namespace: 'project',
        key: 'mem-p001',
      },
    ]);
  });

  it('opens circuit breaker after 3 consecutive remote failures', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'control-plane-sync-adapter-'));
    tempRoots.push(root);

    await writeJsonl(path.join(root, SIGNALS_FILE), [
      {
        id: 'sig-local-fail',
        message: 'local signal',
        created_at: '2026-03-02T00:00:00.000Z',
        read: false,
      } satisfies LocalSignal,
    ]);

    const nowMs = 1_000;
    let remoteAttempts = 0;
    const adapter = createControlPlaneSyncAdapter({
      baseDir: root,
      workspaceId: WORKSPACE_ID,
      sessionId: SESSION_ID,
      now: () => nowMs,
      signalPort: {
        async pushSignals() {
          remoteAttempts += 1;
          throw new Error('remote unavailable');
        },
        async pullSignals(): Promise<PullSignalsResult> {
          return { signals: [] };
        },
      },
      memoryPort: {
        async syncMemory(): Promise<SyncMemoryResult> {
          return { pushed: 0, pulled: 0, conflicts: [] };
        },
      },
    });

    await adapter.pushLocalSignals();
    await adapter.pushLocalSignals();
    await adapter.pushLocalSignals();
    expect(remoteAttempts).toBe(3);

    const result = await adapter.pushLocalSignals();
    expect(result.skippedReason).toBe('circuit-open');
    expect(remoteAttempts).toBe(3);
  });
});
