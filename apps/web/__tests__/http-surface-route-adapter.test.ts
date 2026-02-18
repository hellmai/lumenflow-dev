import { describe, expect, it, vi } from 'vitest';
import type {
  Disposable,
  KernelEvent,
  KernelRuntime,
  ReplayFilter,
  TaskSpec,
} from '@lumenflow/kernel';
import { createHttpSurface } from '../../../packages/@lumenflow/surfaces/http/server';
import { forwardToHttpSurface } from '../src/server/http-surface-route-adapter';

const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
} as const;

const HTTP_STATUS = {
  OK: 200,
} as const;

const TASK = {
  ID: 'WU-1819-web',
  WORKSPACE_ID: 'workspace-default',
  LANE_ID: 'lane-default',
  DOMAIN: 'kernel',
  TITLE: 'Web Surface Task',
  DESCRIPTION: 'Verifies web adapter delegation.',
  CREATED: '2026-02-18',
} as const;

function createTaskSpec(): TaskSpec {
  return {
    id: TASK.ID,
    workspace_id: TASK.WORKSPACE_ID,
    lane_id: TASK.LANE_ID,
    domain: TASK.DOMAIN,
    title: TASK.TITLE,
    description: TASK.DESCRIPTION,
    acceptance: ['Delegates to HTTP surface package.'],
    declared_scopes: [],
    risk: 'low',
    type: 'runtime',
    priority: 'P1',
    created: TASK.CREATED,
  };
}

function createRuntimeStub(): KernelRuntime {
  return {
    createTask: vi.fn(async (taskSpec: TaskSpec) => ({
      task: taskSpec,
      task_spec_path: '/tmp/WU-1819-web.yaml',
      event: {
        schema_version: 1,
        kind: 'task_created',
        task_id: taskSpec.id,
        timestamp: '2026-02-18T00:00:00.000Z',
        spec_hash: 'spec-hash',
      },
    })),
    claimTask: vi.fn(async (input) => ({ task_id: input.task_id })),
    completeTask: vi.fn(async (input) => ({
      task_id: input.task_id,
      run_id: input.run_id ?? 'run-1',
    })),
    inspectTask: vi.fn(async (taskId: string) => ({ task_id: taskId })),
    blockTask: vi.fn(),
    unblockTask: vi.fn(),
    executeTool: vi.fn(),
    getToolHost: vi.fn(),
    getPolicyEngine: vi.fn(),
  } as unknown as KernelRuntime;
}

describe('apps/web forwardToHttpSurface', () => {
  it('delegates task endpoints to createHttpSurface handlers', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime);

    const taskDetailResponse = await forwardToHttpSurface({
      request: new Request(`http://localhost/tasks/${TASK.ID}`, { method: HTTP_METHOD.GET }),
      surface,
    });

    expect(taskDetailResponse.status).toBe(HTTP_STATUS.OK);
    expect(runtime.inspectTask).toHaveBeenCalledWith(TASK.ID);

    const taskCreateResponse = await forwardToHttpSurface({
      request: new Request('http://localhost/tasks', {
        method: HTTP_METHOD.POST,
        body: JSON.stringify(createTaskSpec()),
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
      surface,
    });

    expect(taskCreateResponse.status).toBe(HTTP_STATUS.OK);
    expect(runtime.createTask).toHaveBeenCalledTimes(1);
  });

  it('keeps SSE stream open and disposes subscription when consumer closes stream', async () => {
    const runtime = createRuntimeStub() as KernelRuntime & {
      subscribeEvents: (filter: ReplayFilter, callback: (event: KernelEvent) => void) => Disposable;
    };

    let callbackRef: ((event: KernelEvent) => void) | null = null;
    const dispose = vi.fn();

    runtime.subscribeEvents = vi.fn((_: ReplayFilter, callback: (event: KernelEvent) => void) => {
      callbackRef = callback;
      return { dispose };
    });

    const surface = createHttpSurface(runtime);

    const response = await forwardToHttpSurface({
      request: new Request(`http://localhost/events/${TASK.ID}?kind=task_claimed`),
      surface,
    });

    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(callbackRef).not.toBeNull();

    if (!callbackRef) {
      throw new Error('Expected callbackRef to be assigned by event subscriber.');
    }

    const emitEvent = callbackRef;
    emitEvent({
      schema_version: 1,
      kind: 'task_claimed',
      task_id: TASK.ID,
      timestamp: '2026-02-18T00:00:01.000Z',
      by: 'tom',
      session_id: 'session-web',
    } as unknown as KernelEvent);

    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();
    expect(firstChunk?.done).toBe(false);
    expect(firstChunk?.value).toBeInstanceOf(Uint8Array);

    await reader?.cancel();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
