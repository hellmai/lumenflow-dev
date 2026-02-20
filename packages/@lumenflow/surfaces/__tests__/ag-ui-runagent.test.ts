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
import { createHttpSurface } from '../http/index.js';
import { AG_UI_EVENT_TYPES } from '../http/ag-ui-adapter.js';

const HTTP_METHOD = {
  POST: 'POST',
} as const;

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
} as const;

const HTTP_HEADERS = {
  CONTENT_TYPE: 'content-type',
} as const;

const CONTENT_TYPE = {
  JSON: 'application/json; charset=utf-8',
  EVENT_STREAM: 'text/event-stream; charset=utf-8',
} as const;

const ROUTE = {
  RUN_AGENT: '/ag-ui/v1/run',
} as const;

const TASK = {
  ID: 'task-1830-run',
  WORKSPACE_ID: 'workspace-default',
  LANE_ID: 'lane-default',
  DOMAIN: 'kernel',
  TITLE: 'AG-UI RunAgent Task',
  CREATED: '2026-02-18',
} as const;

const USER = {
  BY: 'copilotkit-agent',
  SESSION_ID: 'session-ag-ui-1830',
  RUN_ID: 'run-task-1830-run-1',
} as const;

const TIMESTAMP = {
  ZERO: '2026-02-18T00:00:00.000Z',
  ONE: '2026-02-18T00:00:01.000Z',
} as const;

interface RequestOptions {
  method: string;
  url: string;
  body?: unknown;
}

class MockResponse extends EventEmitter {
  statusCode = HTTP_STATUS.OK;
  body = '';
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value);
      }
    }
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
    this.emit('finish');
    return this;
  }
}

function createRequest(options: RequestOptions): IncomingMessage {
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

function createRunAgentInput(): Record<string, unknown> {
  return {
    threadId: 'thread-1830',
    runId: 'copilot-run-1830',
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
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
    context: [
      {
        name: 'workspace',
        description: 'Current workspace',
        value: 'workspace-default',
      },
    ],
    forwardedProps: {},
  };
}

type RuntimeLifecyclePort = Pick<
  KernelRuntime,
  'createTask' | 'claimTask' | 'completeTask' | 'inspectTask'
>;

function createRuntimeStub(): RuntimeLifecyclePort & {
  createTaskEvents: KernelEvent[];
  claimTaskEvents: KernelEvent[];
} {
  const createTaskEvents: KernelEvent[] = [];
  const claimTaskEvents: KernelEvent[] = [];

  return {
    createTaskEvents,
    claimTaskEvents,
    createTask: vi.fn(async (taskSpec: TaskSpec) => {
      const event = {
        schema_version: 1,
        kind: 'task_created' as const,
        task_id: taskSpec.id,
        timestamp: TIMESTAMP.ZERO,
        spec_hash: 'spec-hash',
      };
      createTaskEvents.push(event as unknown as KernelEvent);
      return {
        task: taskSpec,
        task_spec_path: `/tmp/${taskSpec.id}.yaml`,
        event,
      };
    }),
    claimTask: vi.fn(async (input) => {
      const claimedEvent = {
        schema_version: 1,
        kind: 'task_claimed' as const,
        task_id: input.task_id,
        timestamp: TIMESTAMP.ZERO,
        by: input.by,
        session_id: input.session_id,
      };
      const runStartedEvent = {
        schema_version: 1,
        kind: 'run_started' as const,
        task_id: input.task_id,
        run_id: USER.RUN_ID,
        timestamp: TIMESTAMP.ZERO,
        by: input.by,
        session_id: input.session_id,
      };
      claimTaskEvents.push(
        claimedEvent as unknown as KernelEvent,
        runStartedEvent as unknown as KernelEvent,
      );
      return {
        task_id: input.task_id,
        run: {
          run_id: USER.RUN_ID,
          task_id: input.task_id,
          status: 'executing',
          started_at: TIMESTAMP.ZERO,
          by: input.by,
          session_id: input.session_id,
        },
        events: [claimedEvent, runStartedEvent],
        policy: { decision: 'allow', decisions: [] },
      };
    }),
    completeTask: vi.fn(async (input) => ({
      task_id: input.task_id,
      run_id: input.run_id ?? USER.RUN_ID,
      events: [],
      policy: { decision: 'allow', decisions: [] },
    })),
    inspectTask: vi.fn(async (taskId: string) => ({ task_id: taskId })),
  };
}

function createEventSubscriberStub(): {
  subscriber: {
    subscribe: ReturnType<typeof vi.fn>;
  };
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

describe('surfaces/http AG-UI RunAgent endpoint', () => {
  it('accepts POST /ag-ui/v1/run with RunAgentInput and returns 200 SSE stream', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(response.headers.get(HTTP_HEADERS.CONTENT_TYPE)).toBe(CONTENT_TYPE.EVENT_STREAM);
  });

  it('maps AG-UI RunAgentInput to kernel task lifecycle: create + claim', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const input = createRunAgentInput();
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: input,
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(runtime.createTask).toHaveBeenCalledTimes(1);
    expect(runtime.claimTask).toHaveBeenCalledTimes(1);

    const createTaskArg = (runtime.createTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(createTaskArg).toBeDefined();
    expect(createTaskArg.title).toBeDefined();
    expect(typeof createTaskArg.title).toBe('string');

    const claimTaskArg = (runtime.claimTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(claimTaskArg).toBeDefined();
    expect(claimTaskArg.task_id).toBe(createTaskArg.id);
    expect(typeof claimTaskArg.by).toBe('string');
    expect(typeof claimTaskArg.session_id).toBe('string');
  });

  it('emits RUN_STARTED AG-UI event at the beginning of the stream', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const lines = response.body.split('\n').filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const firstEvent = JSON.parse(lines[0] ?? '{}');
    expect(firstEvent.type).toBe(AG_UI_EVENT_TYPES.RUN_STARTED);
  });

  it('emits RUN_COMPLETED AG-UI event when task_completed kernel event arrives', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    // Before task_completed, only RUN_STARTED should be present
    const linesBefore = response.body.split('\n').filter((line) => line.trim().length > 0);
    expect(linesBefore.length).toBe(1);
    const firstEvent = JSON.parse(linesBefore[0] ?? '{}');
    expect(firstEvent.type).toBe(AG_UI_EVENT_TYPES.RUN_STARTED);

    // Trigger task_completed via subscriber
    eventStub.triggerEvent({
      schema_version: 1,
      kind: 'task_completed',
      task_id: 'any-task',
      timestamp: TIMESTAMP.ONE,
    } as unknown as KernelEvent);

    // Now RUN_COMPLETED should be present
    const linesAfter = response.body.split('\n').filter((line) => line.trim().length > 0);
    const lastEvent = JSON.parse(linesAfter[linesAfter.length - 1] ?? '{}');
    expect(lastEvent.type).toBe(AG_UI_EVENT_TYPES.RUN_COMPLETED);
  });

  it('includes threadId and runId from input in AG-UI events', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const input = createRunAgentInput();
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: input,
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const lines = response.body.split('\n').filter((line) => line.trim().length > 0);
    const firstEvent = JSON.parse(lines[0] ?? '{}');
    expect(firstEvent.threadId).toBe('thread-1830');
    expect(firstEvent.runId).toBe('copilot-run-1830');
  });

  it('returns 400 when RunAgentInput is missing required messages field', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: {
        threadId: 'thread-1830',
        runId: 'copilot-run-1830',
        tools: [],
      },
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('forwards AG-UI tools in the context to the kernel task spec', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const input = createRunAgentInput();
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: input,
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const createTaskArg = (runtime.createTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(createTaskArg.declared_scopes).toBeDefined();
    expect(Array.isArray(createTaskArg.declared_scopes)).toBe(true);
  });

  it('emits schema-compatible declared_scopes entries (no legacy string scopes)', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const createTaskArg = (runtime.createTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const declaredScopes = Array.isArray(createTaskArg.declared_scopes)
      ? createTaskArg.declared_scopes
      : [];

    const usesLegacyStringScopes = declaredScopes.some((scope) => typeof scope === 'string');
    expect(usesLegacyStringScopes).toBe(false);
  });

  it('streams events as newline-delimited JSON for CopilotKit compatibility', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const rawLines = response.body.split('\n');
    const nonEmptyLines = rawLines.filter((line) => line.trim().length > 0);

    for (const line of nonEmptyLines) {
      const parsed = JSON.parse(line);
      expect(parsed).toBeDefined();
      expect(typeof parsed.type).toBe('string');
      expect(typeof parsed.timestamp).toBe('string');
    }
  });

  it('includes SSE headers compatible with CopilotKit (cache-control, connection)', async () => {
    const runtime = createRuntimeStub();
    const eventStub = createEventSubscriberStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber: eventStub.subscriber,
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.RUN_AGENT,
      body: createRunAgentInput(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');
  });
});
