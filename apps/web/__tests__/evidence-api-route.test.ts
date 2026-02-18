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

const ORPHANED_STARTED_TRACE = {
  ...STARTED_TRACE,
  receipt_id: 'receipt-orphan',
  timestamp: '2026-02-18T10:01:00.000Z',
  tool_name: 'file:write',
};

beforeEach(() => {
  mockReadTracesByTaskId.mockReset();
});

describe('GET /api/tasks/[taskId]/evidence', () => {
  it('returns traces for a valid task ID', async () => {
    mockReadTracesByTaskId.mockResolvedValue([STARTED_TRACE, FINISHED_TRACE]);

    const routeModule = await import('../app/api/tasks/[taskId]/evidence/route');

    const response = await routeModule.GET(
      new Request('http://localhost/api/tasks/task-1/evidence'),
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.traces).toHaveLength(2);
    expect(body.traces[0].kind).toBe('tool_call_started');
    expect(body.traces[1].kind).toBe('tool_call_finished');
    expect(mockReadTracesByTaskId).toHaveBeenCalledWith('task-1');
  });

  it('returns paired timeline entries with duration and result', async () => {
    mockReadTracesByTaskId.mockResolvedValue([STARTED_TRACE, FINISHED_TRACE]);

    const routeModule = await import('../app/api/tasks/[taskId]/evidence/route');

    const response = await routeModule.GET(
      new Request('http://localhost/api/tasks/task-1/evidence'),
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    const body = await response.json();
    expect(body.timeline).toHaveLength(1);
    expect(body.timeline[0]).toEqual(
      expect.objectContaining({
        receiptId: 'receipt-001',
        toolName: 'git:status',
        result: 'success',
        durationMs: 1500,
      }),
    );
  });

  it('marks orphaned starts with crashed result', async () => {
    mockReadTracesByTaskId.mockResolvedValue([
      STARTED_TRACE,
      FINISHED_TRACE,
      ORPHANED_STARTED_TRACE,
    ]);

    const routeModule = await import('../app/api/tasks/[taskId]/evidence/route');

    const response = await routeModule.GET(
      new Request('http://localhost/api/tasks/task-1/evidence'),
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    const body = await response.json();
    expect(body.timeline).toHaveLength(2);

    const orphanEntry = body.timeline.find(
      (entry: { receiptId: string }) => entry.receiptId === 'receipt-orphan',
    );
    expect(orphanEntry).toBeDefined();
    expect(orphanEntry.result).toBe('crashed');
    expect(orphanEntry.toolName).toBe('file:write');
  });

  it('includes scope-requested and scope-enforced in timeline entries', async () => {
    mockReadTracesByTaskId.mockResolvedValue([STARTED_TRACE, FINISHED_TRACE]);

    const routeModule = await import('../app/api/tasks/[taskId]/evidence/route');

    const response = await routeModule.GET(
      new Request('http://localhost/api/tasks/task-1/evidence'),
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    const body = await response.json();
    const entry = body.timeline[0];
    expect(entry.scopeRequested).toEqual([{ type: 'path', pattern: '**', access: 'read' }]);
    expect(entry.scopeEnforced).toEqual([{ type: 'path', pattern: 'src/**', access: 'read' }]);
  });

  it('returns empty arrays for non-existent task', async () => {
    mockReadTracesByTaskId.mockResolvedValue([]);

    const routeModule = await import('../app/api/tasks/[taskId]/evidence/route');

    const response = await routeModule.GET(
      new Request('http://localhost/api/tasks/nonexistent/evidence'),
      { params: Promise.resolve({ taskId: 'nonexistent' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.traces).toEqual([]);
    expect(body.timeline).toEqual([]);
  });
});
