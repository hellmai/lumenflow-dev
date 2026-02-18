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
      replay: vi.fn(async () => [
        {
          schema_version: 1,
          kind: 'task_created',
          task_id: 'WU-test-1',
          timestamp: '2026-02-18T10:00:00.000Z',
          spec_hash: 'hash-1',
        },
      ]),
    },
  })),
}));

const HTTP_STATUS = {
  NO_CONTENT: 204,
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
      new Request('http://localhost/api/tasks/WU-1819/claim'),
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

  it('GET /api/events/all returns events from EventStore replay', async () => {
    const routeModule = await import('../app/api/events/all/route');

    const response = await routeModule.GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe('task_created');
    expect(body[0].task_id).toBe('WU-test-1');
  });
});
