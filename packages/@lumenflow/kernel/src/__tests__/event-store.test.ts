import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { KernelEvent, TaskSpec } from '../kernel.schemas.js';
import { canonical_json } from '../canonical-json.js';
import { EventStore } from '../event-store/index.js';

describe('event-store', () => {
  let tempDir: string;
  let eventsFilePath: string;
  let lockFilePath: string;

  const taskId = 'WU-1726';
  const baseTimestamp = '2026-02-16T22:00:00.000Z';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-event-store-'));
    eventsFilePath = join(tempDir, 'events.jsonl');
    lockFilePath = join(tempDir, 'events.lock');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeTaskSpec(): TaskSpec {
    return {
      id: taskId,
      workspace_id: 'workspace-default',
      lane_id: 'framework-core-lifecycle',
      domain: 'software-delivery',
      title: 'EventStore foundations',
      description: 'Implement generic event sourcing for kernel state.',
      acceptance: ['EventStore roundtrip works'],
      declared_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/event-store/**',
          access: 'write',
        },
      ],
      risk: 'medium',
      type: 'feature',
      priority: 'P0',
      created: '2026-02-16',
    };
  }

  function makeCreatedEvent(specHash: string, timestamp = baseTimestamp): KernelEvent {
    return {
      schema_version: 1,
      kind: 'task_created',
      task_id: taskId,
      timestamp,
      spec_hash: specHash,
    };
  }

  it('append/replay roundtrip preserves all events in append order', async () => {
    const spec = makeTaskSpec();
    const created = makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z');
    const claimed: KernelEvent = {
      schema_version: 1,
      kind: 'task_claimed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:01.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1',
    };
    const completed: KernelEvent = {
      schema_version: 1,
      kind: 'task_completed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:02.000Z',
    };

    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
    });

    await store.append(created);
    await store.append(claimed);
    await store.append(completed);

    const replayed = await store.replay();
    expect(replayed).toHaveLength(3);
    expect(replayed.map((event) => event.kind)).toEqual([
      'task_created',
      'task_claimed',
      'task_completed',
    ]);
  });

  it('appendAll writes multiple events atomically under one append operation', async () => {
    const spec = makeTaskSpec();
    const created = makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z');
    const claimed: KernelEvent = {
      schema_version: 1,
      kind: 'task_claimed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:01.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1',
    };
    const runStarted: KernelEvent = {
      schema_version: 1,
      kind: 'run_started',
      task_id: taskId,
      run_id: 'run-1',
      timestamp: '2026-02-16T22:00:01.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1',
    };

    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
    });

    await store.appendAll([created, claimed, runStarted]);

    const replayed = await store.replay();
    expect(replayed.map((event) => event.kind)).toEqual([
      'task_created',
      'task_claimed',
      'run_started',
    ]);
  });

  it('maintains byTask, byKind, and byTimestamp indexes', async () => {
    const spec = makeTaskSpec();
    const created = makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z');
    const waiting: KernelEvent = {
      schema_version: 1,
      kind: 'task_waiting',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:01.000Z',
      reason: 'waiting for dependency',
    };
    const resumed: KernelEvent = {
      schema_version: 1,
      kind: 'task_resumed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:02.000Z',
    };

    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
    });

    await store.append(created);
    await store.append(waiting);
    await store.append(resumed);

    expect(store.getByTask(taskId)).toHaveLength(3);
    expect(store.getByKind('task_waiting')).toHaveLength(1);
    expect(store.getByTimestamp('2026-02-16T22:00:01.000Z')).toHaveLength(1);
    expect(store.getByTimestamp('2026-02-16T22:00:01.000Z')[0]?.kind).toBe('task_waiting');
  });

  it('projects create->claim->block->unblock->complete into final done state', async () => {
    const spec = makeTaskSpec();
    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
      taskSpecLoader: async (requestedTaskId) => (requestedTaskId === taskId ? spec : null),
    });

    await store.append(makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z'));
    await store.append({
      schema_version: 1,
      kind: 'task_claimed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:01.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1',
    });
    await store.append({
      schema_version: 1,
      kind: 'task_blocked',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:02.000Z',
      reason: 'blocked on dependency',
    });
    await store.append({
      schema_version: 1,
      kind: 'task_unblocked',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:03.000Z',
    });
    await store.append({
      schema_version: 1,
      kind: 'task_completed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:04.000Z',
    });

    const projected = await store.project(taskId);
    expect(projected.task_id).toBe(taskId);
    expect(projected.status).toBe('done');
    expect(projected.completed_at).toBe('2026-02-16T22:00:04.000Z');
    expect(projected.run_count).toBe(0);
  });

  it('projects create->claim->waiting->resumed->complete waiting lifecycle correctly', async () => {
    const spec = makeTaskSpec();
    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
      taskSpecLoader: async (requestedTaskId) => (requestedTaskId === taskId ? spec : null),
    });

    await store.append(makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z'));
    await store.append({
      schema_version: 1,
      kind: 'task_claimed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:01.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1',
    });
    await store.append({
      schema_version: 1,
      kind: 'task_waiting',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:02.000Z',
      reason: 'waiting on external signal',
    });
    await store.append({
      schema_version: 1,
      kind: 'task_resumed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:03.000Z',
    });
    await store.append({
      schema_version: 1,
      kind: 'task_completed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:04.000Z',
    });

    const projected = await store.project(taskId);
    expect(projected.status).toBe('done');
    expect(projected.completed_at).toBe('2026-02-16T22:00:04.000Z');
  });

  it('prevents concurrent append corruption with lock-backed appends', async () => {
    const spec = makeTaskSpec();
    const created = makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z');

    const storeA = new EventStore({
      eventsFilePath,
      lockFilePath,
    });
    const storeB = new EventStore({
      eventsFilePath,
      lockFilePath,
    });

    await storeA.append(created);

    const appends: Promise<void>[] = [];
    for (let i = 0; i < 20; i += 1) {
      const ts = `2026-02-16T22:00:${String(i + 1).padStart(2, '0')}.000Z`;
      const event: KernelEvent = {
        schema_version: 1,
        kind: i % 2 === 0 ? 'task_waiting' : 'task_resumed',
        task_id: taskId,
        timestamp: ts,
        ...(i % 2 === 0 ? { reason: `wait-${i}` } : {}),
      };
      appends.push((i % 2 === 0 ? storeA : storeB).append(event));
    }

    await Promise.all(appends);

    const content = await readFile(eventsFilePath, 'utf-8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines).toHaveLength(21);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('recovers stale lock files when lock owner PID is no longer alive', async () => {
    const spec = makeTaskSpec();
    const created = makeCreatedEvent(canonical_json(spec), '2026-02-16T22:00:00.000Z');

    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
      lockRetryDelayMs: 1,
      lockMaxRetries: 1,
    });

    await writeFile(
      lockFilePath,
      JSON.stringify({
        pid: 999999,
        acquired_at: '2026-02-16T22:00:00.000Z',
      }),
      'utf8',
    );

    await expect(store.append(created)).resolves.toBeUndefined();

    const replayed = await store.replay();
    expect(replayed).toHaveLength(1);
    await expect(readFile(lockFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates kernel event schema_version/prefix rules on append', async () => {
    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
    });

    const invalidEvent = {
      schema_version: 2,
      kind: 'created',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:00.000Z',
    } as unknown as KernelEvent;

    await expect(store.append(invalidEvent)).rejects.toThrow('KernelEvent');
  });

  it('verifies task spec hash against task_created spec_hash during projection', async () => {
    const spec = makeTaskSpec();
    const validHash = canonical_json(spec);

    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
      taskSpecLoader: async () => spec,
    });

    await store.append(makeCreatedEvent(validHash));
    await store.append({
      schema_version: 1,
      kind: 'task_claimed',
      task_id: taskId,
      timestamp: '2026-02-16T22:00:01.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1',
    });

    await expect(store.project(taskId)).resolves.toMatchObject({
      task_id: taskId,
      status: 'active',
    });
  });

  it('throws on spec hash mismatch during projection', async () => {
    const spec = makeTaskSpec();
    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
      taskSpecLoader: async () => spec,
    });

    await store.append(makeCreatedEvent('f'.repeat(64)));
    await expect(store.project(taskId)).rejects.toThrow('Spec hash mismatch');
  });
});
