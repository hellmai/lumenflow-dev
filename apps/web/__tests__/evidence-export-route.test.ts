import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadTracesByTaskId = vi.fn();

vi.mock('../src/server/http-surface-runtime', () => ({
  getKernelRuntimeForWeb: vi.fn(async () => ({
    inspectTask: vi.fn(),
    evidenceStore: {
      readTracesByTaskId: mockReadTracesByTaskId,
    },
  })),
}));

const STARTED_TRACE = {
  schema_version: 1,
  kind: 'tool_call_started',
  receipt_id: 'receipt-001',
  run_id: 'run-task-1-1-abc',
  task_id: 'task-1',
  session_id: 'session-1',
  timestamp: '2026-02-18T10:00:00.000Z',
  tool_name: 'git:status',
  execution_mode: 'in-process',
  scope_requested: [{ type: 'path', pattern: '**', access: 'read' }],
  scope_allowed: [{ type: 'path', pattern: '**', access: 'read' }],
  scope_enforced: [{ type: 'path', pattern: 'src/**', access: 'read' }],
  input_hash: 'a'.repeat(64),
  input_ref: '/inputs/' + 'a'.repeat(64),
  tool_version: '1.0.0',
  workspace_config_hash: 'b'.repeat(64),
  runtime_version: '2.21.0',
};

const FINISHED_TRACE = {
  schema_version: 1,
  kind: 'tool_call_finished',
  receipt_id: 'receipt-001',
  timestamp: '2026-02-18T10:00:01.500Z',
  result: 'success',
  duration_ms: 1500,
  policy_decisions: [{ policy_id: 'default', decision: 'allow', reason: 'No restrictions.' }],
  artifacts_written: [],
};

const SECOND_STARTED_TRACE = {
  ...STARTED_TRACE,
  receipt_id: 'receipt-002',
  timestamp: '2026-02-18T10:01:00.000Z',
  tool_name: 'file:write',
  scope_requested: [{ type: 'network', posture: 'off' }],
  scope_enforced: [{ type: 'network', posture: 'off' }],
};

const SECOND_FINISHED_TRACE = {
  ...FINISHED_TRACE,
  receipt_id: 'receipt-002',
  timestamp: '2026-02-18T10:01:02.000Z',
  result: 'failure',
  duration_ms: 2000,
};

beforeEach(() => {
  mockReadTracesByTaskId.mockReset();
});

describe('GET /api/tasks/[taskId]/evidence/export', () => {
  describe('format=json', () => {
    it('returns JSON array of trace records', async () => {
      mockReadTracesByTaskId.mockResolvedValue([
        STARTED_TRACE,
        FINISHED_TRACE,
        SECOND_STARTED_TRACE,
        SECOND_FINISHED_TRACE,
      ]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=json'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');

      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);

      expect(body[0]).toEqual(
        expect.objectContaining({
          receipt_id: 'receipt-001',
          tool_name: 'git:status',
          started_at: '2026-02-18T10:00:00.000Z',
          finished_at: '2026-02-18T10:00:01.500Z',
          duration_ms: 1500,
          result: 'success',
        }),
      );
    });

    it('includes scope_requested_summary and scope_enforced_summary', async () => {
      mockReadTracesByTaskId.mockResolvedValue([STARTED_TRACE, FINISHED_TRACE]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=json'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      const body = await response.json();
      expect(body[0].scope_requested_summary).toBe('** (read)');
      expect(body[0].scope_enforced_summary).toBe('src/** (read)');
    });

    it('returns empty array for task with no traces', async () => {
      mockReadTracesByTaskId.mockResolvedValue([]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=json'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([]);
    });
  });

  describe('format=csv', () => {
    it('returns CSV with correct headers', async () => {
      mockReadTracesByTaskId.mockResolvedValue([STARTED_TRACE, FINISHED_TRACE]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=csv'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');

      const text = await response.text();
      const lines = text.trim().split('\n');

      expect(lines[0]).toBe(
        'receipt_id,tool_name,started_at,finished_at,duration_ms,result,scope_requested_summary,scope_enforced_summary',
      );
    });

    it('returns Content-Disposition header for file download', async () => {
      mockReadTracesByTaskId.mockResolvedValue([STARTED_TRACE, FINISHED_TRACE]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=csv'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      const disposition = response.headers.get('content-disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('task-1');
      expect(disposition).toContain('.csv');
    });

    it('returns CSV rows matching trace records', async () => {
      mockReadTracesByTaskId.mockResolvedValue([
        STARTED_TRACE,
        FINISHED_TRACE,
        SECOND_STARTED_TRACE,
        SECOND_FINISHED_TRACE,
      ]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=csv'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      const text = await response.text();
      const lines = text.trim().split('\n');

      // Header + 2 data rows
      expect(lines).toHaveLength(3);

      // First row values
      expect(lines[1]).toContain('receipt-001');
      expect(lines[1]).toContain('git:status');
      expect(lines[1]).toContain('success');
      expect(lines[1]).toContain('1500');
    });

    it('escapes CSV values containing commas or quotes', async () => {
      const traceWithComma = {
        ...STARTED_TRACE,
        receipt_id: 'receipt-comma',
        tool_name: 'tool,with,commas',
        scope_requested: [
          { type: 'path', pattern: 'a/**', access: 'read' },
          { type: 'path', pattern: 'b/**', access: 'write' },
        ],
        scope_enforced: [{ type: 'path', pattern: 'a/**', access: 'read' }],
      };
      const finishedComma = {
        ...FINISHED_TRACE,
        receipt_id: 'receipt-comma',
      };

      mockReadTracesByTaskId.mockResolvedValue([traceWithComma, finishedComma]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=csv'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      const text = await response.text();
      const lines = text.trim().split('\n');

      // tool_name with commas should be quoted
      expect(lines[1]).toContain('"tool,with,commas"');
    });

    it('returns empty CSV with only headers for no traces', async () => {
      mockReadTracesByTaskId.mockResolvedValue([]);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=csv'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      const text = await response.text();
      const lines = text.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('receipt_id');
    });
  });

  describe('error handling', () => {
    it('returns 400 for missing format parameter', async () => {
      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(400);
    });

    it('returns 400 for unsupported format', async () => {
      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=xml'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(400);
    });

    it('returns 500 on store failure', async () => {
      mockReadTracesByTaskId.mockRejectedValue(new Error('DB connection failed'));

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=json'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(500);
    });
  });

  describe('no evidence store', () => {
    it('returns empty results when evidence store is not available', async () => {
      // Override the mock to return runtime without evidenceStore
      const { getKernelRuntimeForWeb } = await import('../src/server/http-surface-runtime');
      vi.mocked(getKernelRuntimeForWeb).mockResolvedValueOnce({
        inspectTask: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof getKernelRuntimeForWeb>>);

      const routeModule = await import('../app/api/tasks/[taskId]/evidence/export/route');

      const response = await routeModule.GET(
        new Request('http://localhost/api/tasks/task-1/evidence/export?format=json'),
        { params: Promise.resolve({ taskId: 'task-1' }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([]);
    });
  });
});
