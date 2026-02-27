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

const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
} as const;

const HTTP_STATUS = {
  OK: 200,
} as const;

const HTTP_HEADERS = {
  CONTENT_TYPE: 'content-type',
} as const;

const CONTENT_TYPE = {
  JSON: 'application/json; charset=utf-8',
  EVENT_STREAM: 'text/event-stream; charset=utf-8',
} as const;

const ROUTE = {
  TASKS: '/tasks',
  TASK_DETAIL: '/tasks/WU-1817-http',
  TASK_CLAIM: '/tasks/WU-1817-http/claim',
  TASK_COMPLETE: '/tasks/WU-1817-http/complete',
  EVENTS: '/events/WU-1817-http?kind=task_claimed&sinceTimestamp=2026-02-18T00:00:00.000Z',
} as const;

const TASK = {
  ID: 'WU-1817-http',
  WORKSPACE_ID: 'workspace-default',
  LANE_ID: 'lane-default',
  DOMAIN: 'kernel',
  TITLE: 'HTTP Surface Task',
  DESCRIPTION: 'Verifies HTTP surface delegation.',
  ACCEPTANCE: ['HTTP surface delegates to runtime methods.'],
  CREATED: '2026-02-18',
} as const;

const USER = {
  BY: 'tom',
  SESSION_ID: 'session-http-1817',
  RUN_ID: 'run-WU-1817-http-1',
} as const;

const EVENT_KIND = {
  TASK_CLAIMED: 'task_claimed',
} as const;

type RuntimeLifecyclePort = Pick<
  KernelRuntime,
  'createTask' | 'claimTask' | 'completeTask' | 'inspectTask'
>;

interface RequestOptions {
  method: (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];
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

function createRuntimeStub(): RuntimeLifecyclePort {
  return {
    createTask: vi.fn(async (taskSpec: TaskSpec) => ({
      task: taskSpec,
      task_spec_path: '/tmp/WU-1817-http.yaml',
      event: {
        schema_version: 1,
        kind: 'task_created',
        task_id: taskSpec.id,
        timestamp: '2026-02-18T00:00:00.000Z',
        spec_hash: 'spec-hash',
      },
    })),
    claimTask: vi.fn(async (input) => ({ task_id: input.task_id })),
    completeTask: vi.fn(async (input) => ({ task_id: input.task_id })),
    inspectTask: vi.fn(async (taskId: string) => ({ task_id: taskId })),
  };
}

function createTaskSpec(): TaskSpec {
  return {
    id: TASK.ID,
    workspace_id: TASK.WORKSPACE_ID,
    lane_id: TASK.LANE_ID,
    domain: TASK.DOMAIN,
    title: TASK.TITLE,
    description: TASK.DESCRIPTION,
    acceptance: [...TASK.ACCEPTANCE],
    declared_scopes: [],
    risk: 'low',
    type: 'runtime',
    priority: 'P1',
    created: TASK.CREATED,
  };
}

function parseJsonBody(body: string): unknown {
  return JSON.parse(body);
}

describe('surfaces/http createHttpSurface', () => {
  it('returns a Node-compatible request handler surface', () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);

    expect(typeof surface.handleRequest).toBe('function');
  });

  it('delegates POST /tasks to runtime.createTask', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.TASKS,
      body: createTaskSpec(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(runtime.createTask).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(response.headers.get(HTTP_HEADERS.CONTENT_TYPE)).toBe(CONTENT_TYPE.JSON);
  });

  it('delegates GET /tasks/:id to runtime.inspectTask', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);
    const request = createRequest({
      method: HTTP_METHOD.GET,
      url: ROUTE.TASK_DETAIL,
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(runtime.inspectTask).toHaveBeenCalledWith(TASK.ID);
  });

  it('delegates POST /tasks/:id/claim to runtime.claimTask with path task id', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.TASK_CLAIM,
      body: {
        by: USER.BY,
        session_id: USER.SESSION_ID,
      },
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(runtime.claimTask).toHaveBeenCalledWith({
      task_id: TASK.ID,
      by: USER.BY,
      session_id: USER.SESSION_ID,
    });
  });

  it('delegates POST /tasks/:id/complete to runtime.completeTask with path task id', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.TASK_COMPLETE,
      body: {
        run_id: USER.RUN_ID,
      },
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(runtime.completeTask).toHaveBeenCalledWith({
      task_id: TASK.ID,
      run_id: USER.RUN_ID,
    });
  });

  it('streams SSE as newline-delimited JSON and disposes on request close', async () => {
    const runtime = createRuntimeStub();
    const dispose = vi.fn();
    let capturedFilter: ReplayFilter | null = null;
    let capturedCallback: ((event: KernelEvent) => void | Promise<void>) | null = null;
    const eventSubscriber = {
      subscribe: vi.fn((filter: ReplayFilter, callback: (event: KernelEvent) => void) => {
        capturedFilter = filter;
        capturedCallback = callback;
        return { dispose } satisfies Disposable;
      }),
    };

    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      eventSubscriber,
    });
    const request = createRequest({
      method: HTTP_METHOD.GET,
      url: ROUTE.EVENTS,
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(eventSubscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(capturedFilter).toEqual({
      taskId: TASK.ID,
      kind: EVENT_KIND.TASK_CLAIMED,
      sinceTimestamp: '2026-02-18T00:00:00.000Z',
    });
    expect(response.headers.get(HTTP_HEADERS.CONTENT_TYPE)).toBe(CONTENT_TYPE.EVENT_STREAM);

    const sampleEvent = {
      schema_version: 1,
      kind: EVENT_KIND.TASK_CLAIMED,
      task_id: TASK.ID,
      timestamp: '2026-02-18T00:00:01.000Z',
      by: USER.BY,
      session_id: USER.SESSION_ID,
    } as unknown as KernelEvent;

    expect(capturedCallback).not.toBeNull();
    await capturedCallback?.(sampleEvent);
    const envelope = { source: 'kernel', event: sampleEvent };
    const sseLine = `data: ${JSON.stringify(envelope)}\n\n`;
    expect(response.body.includes(sseLine)).toBe(true);

    request.emit('close');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('returns JSON payloads from delegated runtime calls', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);
    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: ROUTE.TASKS,
      body: createTaskSpec(),
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    const payload = parseJsonBody(response.body) as { task: { id: string } };
    expect(payload.task.id).toBe(TASK.ID);
  });

  it('delegates POST /tools/:name to runtime.executeTool when allowlistedTools provided', async () => {
    const runtime = {
      ...createRuntimeStub(),
      executeTool: vi.fn(async () => ({
        success: true,
        data: { status: 'ok' },
      })),
    };

    const surface = createHttpSurface(runtime as unknown as KernelRuntime, {
      allowlistedTools: ['task:status'],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/tools/task:status',
      body: {
        input: {},
        context: {
          run_id: 'run-1',
          task_id: TASK.ID,
          session_id: USER.SESSION_ID,
          allowed_scopes: [],
        },
      },
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(runtime.executeTool).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
  });

  it('returns 404 for /tools route when allowlistedTools not provided', async () => {
    const runtime = createRuntimeStub();
    const surface = createHttpSurface(runtime as unknown as KernelRuntime);

    const request = createRequest({
      method: HTTP_METHOD.POST,
      url: '/tools/task:status',
      body: {},
    });
    const response = new MockResponse();

    await surface.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
    );

    expect(response.statusCode).toBe(404);
  });
});
