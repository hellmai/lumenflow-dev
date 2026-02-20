// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Disposable, KernelEvent, ReplayFilter, ToolTraceEntry } from '@lumenflow/kernel';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createEventStreamRouter,
  type EventSubscriber,
  type TraceSubscriber,
  type StreamEvent,
} from '../event-stream.js';

// --- Constants ---

const TASK_ID = 'task-sse-1918';
const SSE_DATA_PREFIX = 'data: ';
const SSE_DOUBLE_NEWLINE = '\n\n';
const SSE_HEARTBEAT_COMMENT = ':heartbeat\n\n';
const HEARTBEAT_INTERVAL_MS = 15_000;

// --- Test helpers ---

class MockResponse extends EventEmitter {
  statusCode = 200;
  body = '';
  readonly headers = new Map<string, string>();

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
    this.emit('finish');
    return this;
  }
}

function createRequest(url: string): IncomingMessage {
  const request = new PassThrough() as unknown as IncomingMessage & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  request.method = 'GET';
  request.url = url;
  request.headers = {};
  return request;
}

function createSampleKernelEvent(): KernelEvent {
  return {
    schema_version: 1,
    kind: 'task_claimed',
    task_id: TASK_ID,
    timestamp: '2026-02-20T00:00:01.000Z',
    by: 'tom',
    session_id: 'session-1',
  } as unknown as KernelEvent;
}

function createSampleTrace(): ToolTraceEntry {
  return {
    schema_version: 1,
    kind: 'tool_call_started',
    receipt_id: 'receipt-001',
    run_id: 'run-1',
    task_id: TASK_ID,
    session_id: 'session-1',
    timestamp: '2026-02-20T00:00:02.000Z',
    tool_name: 'file_read',
    execution_mode: 'in_process',
    scope_requested: [],
    scope_allowed: [],
    scope_enforced: [],
    input_hash: 'a'.repeat(64),
    input_ref: '/tmp/inputs/a',
    tool_version: '1.0.0',
    workspace_config_hash: 'b'.repeat(64),
    runtime_version: '1.0.0',
  } as ToolTraceEntry;
}

// --- Tests ---

describe('event-stream SSE framing (AC-1)', () => {
  it('writes kernel events with data: prefix and double newline', async () => {
    const dispose = vi.fn();
    let capturedCallback: ((event: KernelEvent) => void | Promise<void>) | null = null;
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, callback) => {
        capturedCallback = callback;
        return { dispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber);
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();
    const searchParams = new URLSearchParams();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      searchParams,
    );

    const event = createSampleKernelEvent();
    expect(capturedCallback).not.toBeNull();
    await capturedCallback!(event);

    const expectedPayload = `${SSE_DATA_PREFIX}${JSON.stringify({ source: 'kernel', event })}${SSE_DOUBLE_NEWLINE}`;
    expect(response.body).toContain(expectedPayload);
  });

  it('does NOT write bare NDJSON (no data: prefix)', async () => {
    const dispose = vi.fn();
    let capturedCallback: ((event: KernelEvent) => void | Promise<void>) | null = null;
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, callback) => {
        capturedCallback = callback;
        return { dispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber);
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      new URLSearchParams(),
    );

    const event = createSampleKernelEvent();
    await capturedCallback!(event);

    // The old NDJSON format was: JSON.stringify(event) + '\n'
    // This must NOT appear (without the data: prefix)
    const bareNdjson = `${JSON.stringify(event)}\n`;
    // The body should NOT start with this bare format
    expect(response.body.startsWith(bareNdjson)).toBe(false);
    // Every data line must start with 'data: '
    const lines = response.body.split('\n').filter((line: string) => line.length > 0);
    for (const line of lines) {
      expect(line.startsWith('data: ') || line.startsWith(':')).toBe(true);
    }
  });
});

describe('event-stream StreamEvent envelope (AC-2)', () => {
  it('wraps KernelEvent in StreamEvent with source: kernel', async () => {
    const dispose = vi.fn();
    let capturedCallback: ((event: KernelEvent) => void | Promise<void>) | null = null;
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, callback) => {
        capturedCallback = callback;
        return { dispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber);
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      new URLSearchParams(),
    );

    const event = createSampleKernelEvent();
    await capturedCallback!(event);

    // Parse the data line
    const dataLine = response.body.split('\n').find((line: string) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice('data: '.length)) as StreamEvent;
    expect(parsed.source).toBe('kernel');
    expect(parsed.event).toEqual(event);
  });

  it('wraps ToolTraceEntry in StreamEvent with source: evidence', async () => {
    const dispose = vi.fn();
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, _callback) => {
        return { dispose } satisfies Disposable;
      }),
    };
    let capturedTraceCallback: ((trace: ToolTraceEntry) => void) | null = null;
    const traceSubscriber: TraceSubscriber = {
      subscribe: vi.fn((_taskId, callback) => {
        capturedTraceCallback = callback;
        return { dispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber, { traceSubscriber });
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      new URLSearchParams(),
    );

    const trace = createSampleTrace();
    expect(capturedTraceCallback).not.toBeNull();
    capturedTraceCallback!(trace);

    const dataLine = response.body.split('\n').find((line: string) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice('data: '.length)) as StreamEvent;
    expect(parsed.source).toBe('evidence');
    expect(parsed.trace).toEqual(trace);
  });
});

describe('event-stream heartbeat (AC-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends heartbeat comment every 15 seconds', async () => {
    const dispose = vi.fn();
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, _callback) => {
        return { dispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber);
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      new URLSearchParams(),
    );

    // Initially no heartbeat
    expect(response.body).toBe('');

    // Advance 15 seconds
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(response.body).toContain(SSE_HEARTBEAT_COMMENT);

    // Advance another 15 seconds
    const bodyAfterFirst = response.body;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    // Should have two heartbeats now
    const heartbeatCount = response.body.split(SSE_HEARTBEAT_COMMENT).length - 1;
    expect(heartbeatCount).toBe(2);
  });

  it('stops heartbeat when connection closes', async () => {
    const dispose = vi.fn();
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, _callback) => {
        return { dispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber);
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      new URLSearchParams(),
    );

    // Close the connection
    request.emit('close');

    // Advance past heartbeat interval
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);

    // No heartbeats should have been sent
    expect(response.body).toBe('');
  });
});

describe('event-stream disposes subscriptions on close', () => {
  it('disposes both event and trace subscriptions on request close', async () => {
    const eventDispose = vi.fn();
    const traceDispose = vi.fn();
    const eventSubscriber: EventSubscriber = {
      subscribe: vi.fn((_filter, _callback) => {
        return { dispose: eventDispose } satisfies Disposable;
      }),
    };
    const traceSubscriber: TraceSubscriber = {
      subscribe: vi.fn((_taskId, _callback) => {
        return { dispose: traceDispose } satisfies Disposable;
      }),
    };

    const router = createEventStreamRouter(eventSubscriber, { traceSubscriber });
    const request = createRequest(`/events/${TASK_ID}`);
    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TASK_ID],
      new URLSearchParams(),
    );

    request.emit('close');

    expect(eventDispose).toHaveBeenCalledTimes(1);
    expect(traceDispose).toHaveBeenCalledTimes(1);
  });
});
