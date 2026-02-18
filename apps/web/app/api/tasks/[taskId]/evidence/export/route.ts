import { getKernelRuntimeForWeb } from '../../../../../../src/server/http-surface-runtime';

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';
const CONTENT_TYPE_CSV = 'text/csv; charset=utf-8';

const SUPPORTED_FORMATS = new Set(['json', 'csv']);

const TOOL_TRACE_KIND = {
  STARTED: 'tool_call_started',
  FINISHED: 'tool_call_finished',
} as const;

const CSV_COLUMNS = [
  'receipt_id',
  'tool_name',
  'started_at',
  'finished_at',
  'duration_ms',
  'result',
  'scope_requested_summary',
  'scope_enforced_summary',
] as const;

interface ScopeEntry {
  readonly type: string;
  readonly pattern?: string;
  readonly access?: string;
  readonly posture?: string;
}

interface ToolTraceStarted {
  readonly kind: typeof TOOL_TRACE_KIND.STARTED;
  readonly receipt_id: string;
  readonly tool_name: string;
  readonly timestamp: string;
  readonly scope_requested: readonly ScopeEntry[];
  readonly scope_enforced: readonly ScopeEntry[];
  readonly [key: string]: unknown;
}

interface ToolTraceFinished {
  readonly kind: typeof TOOL_TRACE_KIND.FINISHED;
  readonly receipt_id: string;
  readonly timestamp: string;
  readonly result: string;
  readonly duration_ms: number;
  readonly [key: string]: unknown;
}

type ToolTrace = ToolTraceStarted | ToolTraceFinished;

export interface ExportRecord {
  readonly receipt_id: string;
  readonly tool_name: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number | string;
  readonly result: string;
  readonly scope_requested_summary: string;
  readonly scope_enforced_summary: string;
}

interface ExportRouteContext {
  readonly params: Promise<{ taskId: string }>;
}

interface RuntimeWithEvidenceStore {
  evidenceStore?: {
    readTracesByTaskId(taskId: string): Promise<ToolTrace[]>;
  };
}

function isStartedTrace(trace: ToolTrace): trace is ToolTraceStarted {
  return trace.kind === TOOL_TRACE_KIND.STARTED;
}

function isFinishedTrace(trace: ToolTrace): trace is ToolTraceFinished {
  return trace.kind === TOOL_TRACE_KIND.FINISHED;
}

function summarizeScope(scopes: readonly ScopeEntry[]): string {
  return scopes
    .map((scope) => {
      if (scope.type === 'path') {
        return `${scope.pattern ?? '*'} (${scope.access ?? 'read'})`;
      }
      if (scope.type === 'network') {
        return `network: ${scope.posture ?? 'off'}`;
      }
      return scope.type;
    })
    .join(', ');
}

function buildExportRecords(traces: readonly ToolTrace[]): ExportRecord[] {
  const startedByReceiptId = new Map<string, ToolTraceStarted>();
  const finishedByReceiptId = new Map<string, ToolTraceFinished>();

  for (const trace of traces) {
    if (isStartedTrace(trace)) {
      startedByReceiptId.set(trace.receipt_id, trace);
    } else if (isFinishedTrace(trace)) {
      finishedByReceiptId.set(trace.receipt_id, trace);
    }
  }

  const records: ExportRecord[] = [];

  for (const [receiptId, started] of startedByReceiptId) {
    const finished = finishedByReceiptId.get(receiptId);

    records.push({
      receipt_id: receiptId,
      tool_name: started.tool_name,
      started_at: started.timestamp,
      finished_at: finished?.timestamp ?? '',
      duration_ms: finished?.duration_ms ?? '',
      result: finished?.result ?? 'crashed',
      scope_requested_summary: summarizeScope(started.scope_requested),
      scope_enforced_summary: summarizeScope(started.scope_enforced),
    });
  }

  return records;
}

function escapeCsvValue(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function recordsToCsv(records: readonly ExportRecord[]): string {
  const header = CSV_COLUMNS.join(',');

  const rows = records.map((record) =>
    CSV_COLUMNS.map((col) => escapeCsvValue(record[col])).join(','),
  );

  return [header, ...rows].join('\n');
}

export async function GET(request: Request, context: ExportRouteContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get('format');

    if (!format || !SUPPORTED_FORMATS.has(format)) {
      return new Response(
        JSON.stringify({
          error: { message: 'Missing or unsupported format. Use format=json or format=csv.' },
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'content-type': CONTENT_TYPE_JSON },
        },
      );
    }

    const { taskId } = await context.params;
    const runtime = (await getKernelRuntimeForWeb()) as unknown as RuntimeWithEvidenceStore;

    let records: ExportRecord[] = [];

    if (runtime.evidenceStore) {
      const traces = await runtime.evidenceStore.readTracesByTaskId(taskId);
      records = buildExportRecords(traces as ToolTrace[]);
    }

    if (format === 'csv') {
      const csv = recordsToCsv(records);
      return new Response(csv, {
        status: HTTP_STATUS.OK,
        headers: {
          'content-type': CONTENT_TYPE_CSV,
          'content-disposition': `attachment; filename="evidence-${taskId}.csv"`,
        },
      });
    }

    // format === 'json'
    return new Response(JSON.stringify(records), {
      status: HTTP_STATUS.OK,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: { message: 'Failed to export evidence traces.' } }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: { 'content-type': CONTENT_TYPE_JSON },
      },
    );
  }
}
