'use client';

export interface ScopeEntry {
  readonly type: string;
  readonly pattern?: string;
  readonly access?: string;
  readonly posture?: string;
}

export interface PolicyDecisionEntry {
  readonly policyId: string;
  readonly decision: string;
  readonly reason?: string;
}

export interface TimelineEntry {
  readonly receiptId: string;
  readonly toolName: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly result: 'success' | 'failure' | 'denied' | 'crashed';
  readonly scopeRequested: readonly ScopeEntry[];
  readonly scopeEnforced: readonly ScopeEntry[];
  readonly policyDecisions: readonly PolicyDecisionEntry[];
}

const RESULT_BADGE_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700 border-green-200',
  failure: 'bg-amber-100 text-amber-700 border-amber-200',
  denied: 'bg-red-100 text-red-700 border-red-200',
  crashed: 'bg-red-200 text-red-800 border-red-300',
};

const DEFAULT_BADGE_COLOR = 'bg-slate-100 text-slate-600 border-slate-200';

function formatScopeEntries(scopes: readonly ScopeEntry[]): string {
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

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return 'N/A';
  }
  return `${durationMs}ms`;
}

interface EvidenceViewerProps {
  readonly timeline: readonly TimelineEntry[];
  readonly taskId?: string;
}

function buildExportUrl(taskId: string, format: 'csv' | 'json'): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/evidence/export?format=${format}`;
}

export function EvidenceViewer({ timeline, taskId }: EvidenceViewerProps) {
  if (timeline.length === 0) {
    return (
      <div
        data-testid="evidence-viewer-empty"
        className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400"
      >
        No tool traces recorded yet.
      </div>
    );
  }

  return (
    <div data-testid="evidence-viewer" className="space-y-2">
      {/* Export buttons */}
      {taskId && (
        <div data-testid="export-controls" className="flex justify-end gap-2">
          <a
            data-testid="export-csv-button"
            href={buildExportUrl(taskId, 'csv')}
            download
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Export CSV
          </a>
          <a
            data-testid="export-json-button"
            href={buildExportUrl(taskId, 'json')}
            download
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Export JSON
          </a>
        </div>
      )}

      {/* Header row */}
      <div className="grid grid-cols-6 gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div>Tool</div>
        <div>Result</div>
        <div>Duration</div>
        <div>Started</div>
        <div>Scope Requested</div>
        <div>Scope Enforced</div>
      </div>

      {/* Timeline rows */}
      {timeline.map((entry) => (
        <div
          key={entry.receiptId}
          data-testid={`timeline-row-${entry.receiptId}`}
          className="grid grid-cols-6 gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {/* Tool name */}
          <div className="font-mono font-medium text-slate-800">{entry.toolName}</div>

          {/* Result badge */}
          <div>
            <span
              data-testid={`result-badge-${entry.receiptId}`}
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${RESULT_BADGE_COLORS[entry.result] ?? DEFAULT_BADGE_COLOR}`}
            >
              {entry.result}
            </span>
          </div>

          {/* Duration */}
          <div className="font-mono text-slate-600">{formatDuration(entry.durationMs)}</div>

          {/* Started at */}
          <div className="font-mono text-xs text-slate-400">{entry.startedAt}</div>

          {/* Scope requested */}
          <div
            data-testid={`scope-requested-${entry.receiptId}`}
            className="font-mono text-xs text-slate-500"
          >
            {formatScopeEntries(entry.scopeRequested)}
          </div>

          {/* Scope enforced */}
          <div
            data-testid={`scope-enforced-${entry.receiptId}`}
            className="font-mono text-xs text-slate-500"
          >
            {formatScopeEntries(entry.scopeEnforced)}
          </div>
        </div>
      ))}
    </div>
  );
}
