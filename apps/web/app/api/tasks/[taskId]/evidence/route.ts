import { getKernelRuntimeForWeb } from '../../../../../src/server/http-surface-runtime';

const HTTP_STATUS = {
  OK: 200,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';

const TOOL_TRACE_KIND = {
  STARTED: 'tool_call_started',
  FINISHED: 'tool_call_finished',
} as const;

interface ToolTraceStarted {
  readonly kind: typeof TOOL_TRACE_KIND.STARTED;
  readonly receipt_id: string;
  readonly tool_name: string;
  readonly timestamp: string;
  readonly scope_requested: readonly Record<string, unknown>[];
  readonly scope_enforced: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

interface ToolTraceFinished {
  readonly kind: typeof TOOL_TRACE_KIND.FINISHED;
  readonly receipt_id: string;
  readonly timestamp: string;
  readonly result: string;
  readonly duration_ms: number;
  readonly policy_decisions: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

type ToolTrace = ToolTraceStarted | ToolTraceFinished;

export interface TimelineResponseEntry {
  readonly receiptId: string;
  readonly toolName: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly result: string;
  readonly scopeRequested: readonly Record<string, unknown>[];
  readonly scopeEnforced: readonly Record<string, unknown>[];
  readonly policyDecisions: readonly Record<string, unknown>[];
}

function isStartedTrace(trace: ToolTrace): trace is ToolTraceStarted {
  return trace.kind === TOOL_TRACE_KIND.STARTED;
}

function isFinishedTrace(trace: ToolTrace): trace is ToolTraceFinished {
  return trace.kind === TOOL_TRACE_KIND.FINISHED;
}

function buildTimeline(traces: readonly ToolTrace[]): TimelineResponseEntry[] {
  const startedByReceiptId = new Map<string, ToolTraceStarted>();
  const finishedByReceiptId = new Map<string, ToolTraceFinished>();

  for (const trace of traces) {
    if (isStartedTrace(trace)) {
      startedByReceiptId.set(trace.receipt_id, trace);
    } else if (isFinishedTrace(trace)) {
      finishedByReceiptId.set(trace.receipt_id, trace);
    }
  }

  const timeline: TimelineResponseEntry[] = [];

  for (const [receiptId, started] of startedByReceiptId) {
    const finished = finishedByReceiptId.get(receiptId);

    if (finished) {
      timeline.push({
        receiptId,
        toolName: started.tool_name,
        startedAt: started.timestamp,
        finishedAt: finished.timestamp,
        durationMs: finished.duration_ms,
        result: finished.result,
        scopeRequested: started.scope_requested,
        scopeEnforced: started.scope_enforced,
        policyDecisions: finished.policy_decisions,
      });
    } else {
      // Orphaned start: no matching finished trace
      timeline.push({
        receiptId,
        toolName: started.tool_name,
        startedAt: started.timestamp,
        result: 'crashed',
        scopeRequested: started.scope_requested,
        scopeEnforced: started.scope_enforced,
        policyDecisions: [],
      });
    }
  }

  return timeline;
}

interface EvidenceRouteContext {
  readonly params: Promise<{ taskId: string }>;
}

interface RuntimeWithEvidenceStore {
  evidenceStore?: {
    readTracesByTaskId(taskId: string): Promise<ToolTrace[]>;
  };
}

export async function GET(_request: Request, context: EvidenceRouteContext): Promise<Response> {
  try {
    const { taskId } = await context.params;
    const runtime = (await getKernelRuntimeForWeb()) as unknown as RuntimeWithEvidenceStore;

    if (!runtime.evidenceStore) {
      return new Response(JSON.stringify({ traces: [], timeline: [] }), {
        status: HTTP_STATUS.OK,
        headers: { 'content-type': CONTENT_TYPE_JSON },
      });
    }

    const traces = await runtime.evidenceStore.readTracesByTaskId(taskId);
    const timeline = buildTimeline(traces as ToolTrace[]);

    return new Response(JSON.stringify({ traces, timeline }), {
      status: HTTP_STATUS.OK,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  } catch {
    return new Response(JSON.stringify({ error: { message: 'Failed to read evidence traces.' } }), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  }
}
