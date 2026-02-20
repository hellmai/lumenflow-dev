// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type {
  Disposable,
  KernelEvent,
  KernelRuntime,
  ReplayFilter,
  TaskSpec,
} from '@lumenflow/kernel';
import { describe, expect, it, vi } from 'vitest';
import { createRunAgentRouter, type RunAgentConfig, type RunAgentInput } from '../run-agent.js';
import { AG_UI_EVENT_TYPES } from '../ag-ui-adapter.js';
import type { EventSubscriber } from '../event-stream.js';

// --- Constants ---

const WORKSPACE_ID = 'ws-test-1923';

const HTTP_METHOD = {
  POST: 'POST',
  GET: 'GET',
} as const;

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
} as const;

const HTTP_HEADERS = {
  CONTENT_TYPE: 'content-type',
} as const;

const CONTENT_TYPE = {
  JSON: 'application/json; charset=utf-8',
  EVENT_STREAM: 'text/event-stream; charset=utf-8',
} as const;

const TIMESTAMP = {
  ZERO: '2026-02-20T00:00:00.000Z',
} as const;

const RUN_ID = 'run-task-1923-1';

// --- Test helpers ---

class MockResponse extends EventEmitter {
  statusCode = HTTP_STATUS.OK;
  body = '';
  readonly headers = new Map<string, string>();
  ended = false;

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  write(chunk: string | Buffer): boolean {
    this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    return true;
  }

  end(chunk?: string | Buffer): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.ended = true;
    this.emit('finish');
    return this;
  }
}

function createRequest(options: { method: string; url: string; body?: unknown }): IncomingMessage {
  const request = new PassThrough() as unknown as IncomingMessage & {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
  };

  request.method = options.method;
  request.url = options.url;
  request.headers = {
    [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
  };

  const payload = options.body === undefined ? '' : JSON.stringify(options.body);
  (request as unknown as PassThrough).end(payload);
  return request;
}

function createRunAgentInput(): RunAgentInput {
  return {
    threadId: 'thread-1923',
    runId: 'copilot-run-1923',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'List all tasks',
      },
    ],
    tools: [
      {
        name: 'task.list',
        description: 'Lists available tasks',
        parameters: { type: 'object', properties: {} },
      },
    ],
  };
}

function createRuntimeStub(): Pick<
  KernelRuntime,
  'createTask' | 'claimTask' | 'completeTask' | 'inspectTask'
> {
  return {
    createTask: vi.fn(async (taskSpec: TaskSpec) => ({
      task: taskSpec,
      task_spec_path: `/tmp/${taskSpec.id}.yaml`,
      event: {
        schema_version: 1,
        kind: 'task_created' as const,
        task_id: taskSpec.id,
        timestamp: TIMESTAMP.ZERO,
        spec_hash: 'spec-hash',
      },
    })),
    claimTask: vi.fn(async (input) => ({
      task_id: input.task_id,
      run: {
        run_id: RUN_ID,
        task_id: input.task_id,
        status: 'executing',
        started_at: TIMESTAMP.ZERO,
        by: input.by,
        session_id: input.session_id,
      },
      events: [
        {
          schema_version: 1,
          kind: 'task_claimed' as const,
          task_id: input.task_id,
          timestamp: TIMESTAMP.ZERO,
          by: input.by,
          session_id: input.session_id,
        },
        {
          schema_version: 1,
          kind: 'run_started' as const,
          task_id: input.task_id,
          run_id: RUN_ID,
          timestamp: TIMESTAMP.ZERO,
          by: input.by,
          session_id: input.session_id,
        },
      ],
      policy: { decision: 'allow', decisions: [] },
    })),
    completeTask: vi.fn(async (input) => ({
      task_id: input.task_id,
      run_id: input.run_id ?? RUN_ID,
      events: [],
      policy: { decision: 'allow', decisions: [] },
    })),
    inspectTask: vi.fn(async (taskId: string) => ({ task_id: taskId })),
  };
}

function createEventSubscriberStub(): {
  subscriber: EventSubscriber;
  triggerEvent: (event: KernelEvent) => void;
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  let callback: ((event: KernelEvent) => void | Promise<void>) | null = null;

  return {
    subscriber: {
      subscribe: vi.fn((_filter: ReplayFilter, cb: (event: KernelEvent) => void) => {
        callback = cb;
        return { dispose } satisfies Disposable;
      }),
    },
    triggerEvent: (event: KernelEvent) => {
      callback?.(event);
    },
    dispose,
  };
}

function createDefaultConfig(): RunAgentConfig {
  return {
    workspaceId: WORKSPACE_ID,
  };
}

// --- Tests ---

describe('RunAgent workspace_id from config (B-WSVAL)', () => {
  it('passes workspace_id from config to createTask, not hardcoded ag-ui', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const config = createDefaultConfig();

    const router = createRunAgentRouter(
      runtime as unknown as KernelRuntime,
      eventStub.subscriber,
      config,
    );

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/ag-ui/v1/run',
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    // Allow time for async event processing
    const createTaskArg = (runtime.createTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(createTaskArg).toBeDefined();
    expect(createTaskArg.workspace_id).toBe(WORKSPACE_ID);
    expect(createTaskArg.workspace_id).not.toBe('ag-ui');
  });
});

describe('RunAgent acceptance non-empty (B-ACCEPT)', () => {
  it('builds TaskSpec with at least one acceptance criterion', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const config = createDefaultConfig();

    const router = createRunAgentRouter(
      runtime as unknown as KernelRuntime,
      eventStub.subscriber,
      config,
    );

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/ag-ui/v1/run',
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const createTaskArg = (runtime.createTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(createTaskArg).toBeDefined();
    expect(Array.isArray(createTaskArg.acceptance)).toBe(true);
    expect(createTaskArg.acceptance.length).toBeGreaterThanOrEqual(1);
    expect(typeof createTaskArg.acceptance[0]).toBe('string');
    expect(createTaskArg.acceptance[0].length).toBeGreaterThan(0);
  });
});

describe('RunAgent subscribes to events and streams them (B-RUNAG)', () => {
  it('subscribes to task events via EventSubscriber', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const config = createDefaultConfig();

    const router = createRunAgentRouter(
      runtime as unknown as KernelRuntime,
      eventStub.subscriber,
      config,
    );

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/ag-ui/v1/run',
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(eventStub.subscriber.subscribe).toHaveBeenCalledTimes(1);
  });

  it('streams kernel events as AG-UI events to the response', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const config = createDefaultConfig();

    const router = createRunAgentRouter(
      runtime as unknown as KernelRuntime,
      eventStub.subscriber,
      config,
    );

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/ag-ui/v1/run',
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    // Simulate a kernel event being emitted
    const kernelEvent = {
      schema_version: 1,
      kind: 'task_claimed',
      task_id: 'some-task-id',
      timestamp: TIMESTAMP.ZERO,
      by: 'test',
      session_id: 'test-session',
    } as unknown as KernelEvent;

    eventStub.triggerEvent(kernelEvent);

    // The streamed event should appear in the response body
    const lines = response.body.split('\n').filter((line) => line.trim().length > 0);
    // Should have at least RUN_STARTED + the streamed kernel event
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('emits RUN_COMPLETED only when task_completed kernel event arrives', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const config = createDefaultConfig();

    const router = createRunAgentRouter(
      runtime as unknown as KernelRuntime,
      eventStub.subscriber,
      config,
    );

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/ag-ui/v1/run',
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    // handleRequest returns but should NOT have ended the response yet
    // (it stays open waiting for events)
    const handlePromise = router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    // Wait for the handler to set up
    await handlePromise;

    // Before task_completed, the response should NOT contain RUN_COMPLETED
    const linesBeforeComplete = response.body.split('\n').filter((line) => line.trim().length > 0);
    const hasRunCompletedBefore = linesBeforeComplete.some((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.type === AG_UI_EVENT_TYPES.RUN_COMPLETED;
      } catch {
        return false;
      }
    });
    expect(hasRunCompletedBefore).toBe(false);

    // Now emit the task_completed kernel event
    const taskCompletedEvent = {
      schema_version: 1,
      kind: 'task_completed',
      task_id: 'some-task-id',
      timestamp: '2026-02-20T00:00:05.000Z',
    } as unknown as KernelEvent;

    eventStub.triggerEvent(taskCompletedEvent);

    // Now RUN_COMPLETED should appear
    const linesAfterComplete = response.body.split('\n').filter((line) => line.trim().length > 0);
    const hasRunCompletedAfter = linesAfterComplete.some((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.type === AG_UI_EVENT_TYPES.RUN_COMPLETED;
      } catch {
        return false;
      }
    });
    expect(hasRunCompletedAfter).toBe(true);
  });

  it('does NOT emit fake RUN_COMPLETED immediately after RUN_STARTED', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const config = createDefaultConfig();

    const router = createRunAgentRouter(
      runtime as unknown as KernelRuntime,
      eventStub.subscriber,
      config,
    );

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/ag-ui/v1/run',
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    // Parse all events from the response body at this point (before any
    // kernel events are triggered via the subscriber)
    const lines = response.body.split('\n').filter((line) => line.trim().length > 0);
    const events = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // RUN_STARTED should be the only (or first) event
    const runStartedEvents = events.filter(
      (e: Record<string, unknown>) => e.type === AG_UI_EVENT_TYPES.RUN_STARTED,
    );
    expect(runStartedEvents.length).toBe(1);

    // RUN_COMPLETED should NOT be present yet (no execution happened)
    const runCompletedEvents = events.filter(
      (e: Record<string, unknown>) => e.type === AG_UI_EVENT_TYPES.RUN_COMPLETED,
    );
    expect(runCompletedEvents.length).toBe(0);
  });
});
