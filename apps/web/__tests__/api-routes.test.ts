import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forwardToHttpSurface = vi.fn();

vi.mock('../src/server/http-surface-route-adapter', () => ({
  forwardToHttpSurface,
}));

vi.mock('../src/server/http-surface-runtime', () => ({
  getHttpSurfaceForWeb: vi.fn(async () => ({
    handleRequest: vi.fn(),
  })),
  getKernelRuntimeForWeb: vi.fn(async () => ({
    eventStore: {
      replay: vi.fn(async () => ({
        events: [
          {
            schema_version: 1,
            kind: 'task_created',
            task_id: 'WU-test-1',
            timestamp: '2026-02-18T10:00:00.000Z',
            spec_hash: 'hash-1',
          },
        ],
        nextCursor: null,
      })),
    },
  })),
}));

const HTTP_STATUS = {
  OK: 200,
  NO_CONTENT: 204,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
} as const;

const TEST_RESPONSE = new Response(null, { status: HTTP_STATUS.NO_CONTENT });

beforeEach(() => {
  forwardToHttpSurface.mockReset();
  forwardToHttpSurface.mockResolvedValue(TEST_RESPONSE);
});

describe('apps/web API route delegates', () => {
  it('maps /api/events/[taskId] to /events/:taskId', async () => {
    const routeModule = await import('../app/api/events/[taskId]/route');

    const response = await routeModule.GET(
      new Request('http://localhost/api/events/WU-1819?kind=task_claimed'),
      {
        params: Promise.resolve({ taskId: 'WU-1819' }),
      },
    );

    expect(response.status).toBe(HTTP_STATUS.NO_CONTENT);
    expect(forwardToHttpSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        pathName: '/events/WU-1819',
      }),
    );
  });

  it('maps /api/tasks/[...slug] to /tasks/*', async () => {
    const routeModule = await import('../app/api/tasks/[...slug]/route');

    const response = await routeModule.POST(
      new Request('http://localhost/api/tasks/WU-1819/claim', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
        },
      }),
      {
        params: Promise.resolve({ slug: ['WU-1819', 'claim'] }),
      },
    );

    expect(response.status).toBe(HTTP_STATUS.NO_CONTENT);
    expect(forwardToHttpSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        pathName: '/tasks/WU-1819/claim',
      }),
    );
  });

  it('rejects cross-origin POST /api/tasks/[...slug]', async () => {
    const routeModule = await import('../app/api/tasks/[...slug]/route');

    const response = await routeModule.POST(
      new Request('http://localhost/api/tasks/WU-1819/claim', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'claim' }),
      }),
      {
        params: Promise.resolve({ slug: ['WU-1819', 'claim'] }),
      },
    );

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(forwardToHttpSurface).not.toHaveBeenCalled();
  });

  it('rejects oversized POST /api/tasks/[...slug] body', async () => {
    const routeModule = await import('../app/api/tasks/[...slug]/route');

    const response = await routeModule.POST(
      new Request('http://localhost/api/tasks/WU-1819/claim', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024),
        },
        body: JSON.stringify({ action: 'claim' }),
      }),
      {
        params: Promise.resolve({ slug: ['WU-1819', 'claim'] }),
      },
    );

    expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE);
    expect(forwardToHttpSurface).not.toHaveBeenCalled();
  });

  it('GET /api/events/all returns events from EventStore replay', async () => {
    const routeModule = await import('../app/api/events/all/route');

    const response = await routeModule.GET(new NextRequest('http://localhost/api/events/all'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].kind).toBe('task_created');
    expect(body.events[0].task_id).toBe('WU-test-1');
    expect(body.nextCursor).toBeNull();
  });

  it('maps /api/ag-ui/v1/run to /ag-ui/v1/run and preserves SSE responses', async () => {
    const routeModule = await import('../app/api/ag-ui/v1/run/route');
    const sseResponse = new Response('data: {"type":"started"}\n\n', {
      status: HTTP_STATUS.OK,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
      },
    });
    forwardToHttpSurface.mockResolvedValueOnce(sseResponse);

    const response = await routeModule.POST(
      new Request('http://localhost/api/ag-ui/v1/run', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
    );

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(forwardToHttpSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        pathName: '/ag-ui/v1/run',
      }),
    );
  });
});
