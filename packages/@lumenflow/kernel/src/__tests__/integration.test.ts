import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActor } from 'xstate';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { canonical_json } from '../canonical-json.js';
import { EventStore } from '../event-store/index.js';
import type { KernelEvent, TaskSpec } from '../kernel.schemas.js';
import {
  TASK_LIFECYCLE_EVENTS,
  taskLifecycleMachine,
  assertTransition,
} from '../state-machine/index.js';

describe('kernel integration', () => {
  let tempDir: string;
  let eventsFilePath: string;
  let lockFilePath: string;

  const taskId = 'WU-1727';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-integration-'));
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
      lane_id: 'framework-core-state-recovery',
      domain: 'runtime',
      title: 'Kernel lifecycle integration',
      description: 'Validate XState lifecycle with event projection',
      acceptance: ['Lifecycle projection reaches done'],
      declared_scopes: [],
      risk: 'medium',
      type: 'feature',
      priority: 'P0',
      created: '2026-02-16',
    };
  }

  it('runs create->claim->run_start->run_succeed->complete and projects done state', async () => {
    const spec = makeTaskSpec();
    const store = new EventStore({
      eventsFilePath,
      lockFilePath,
      taskSpecLoader: async (requestedTaskId) => (requestedTaskId === taskId ? spec : null),
    });
    const actor = createActor(taskLifecycleMachine);
    actor.start();

    const workspaceCreatedEvent: KernelEvent = {
      schema_version: 1,
      kind: 'workspace_updated',
      timestamp: '2026-02-16T23:00:00.000Z',
      config_hash: 'a'.repeat(64),
      changes_summary: 'Workspace initialized for runtime execution',
    };
    await store.append(workspaceCreatedEvent);

    const createdEvent: KernelEvent = {
      schema_version: 1,
      kind: 'task_created',
      task_id: taskId,
      timestamp: '2026-02-16T23:00:01.000Z',
      spec_hash: canonical_json(spec),
    };
    await store.append(createdEvent);

    assertTransition(actor.getSnapshot().value, 'active', taskId);
    actor.send({ type: TASK_LIFECYCLE_EVENTS.CLAIM });
    await store.append({
      schema_version: 1,
      kind: 'task_claimed',
      task_id: taskId,
      timestamp: '2026-02-16T23:00:02.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1727',
    });

    await store.append({
      schema_version: 1,
      kind: 'run_started',
      task_id: taskId,
      run_id: 'run-1727-1',
      timestamp: '2026-02-16T23:00:03.000Z',
      by: 'tom@hellm.ai',
      session_id: 'session-1727',
    });

    await store.append({
      schema_version: 1,
      kind: 'run_succeeded',
      task_id: taskId,
      run_id: 'run-1727-1',
      timestamp: '2026-02-16T23:00:04.000Z',
    });

    assertTransition(actor.getSnapshot().value, 'done', taskId);
    actor.send({ type: TASK_LIFECYCLE_EVENTS.COMPLETE });
    await store.append({
      schema_version: 1,
      kind: 'task_completed',
      task_id: taskId,
      timestamp: '2026-02-16T23:00:05.000Z',
    });

    const projected = await store.project(taskId);
    expect(projected.task_id).toBe(taskId);
    expect(projected.status).toBe('done');
    expect(projected.run_count).toBe(1);
    expect(projected.current_run?.status).toBe('succeeded');
    expect(projected.completed_at).toBe('2026-02-16T23:00:05.000Z');

    actor.stop();
  });
});
