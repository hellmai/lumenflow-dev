'use client';

import type { ToolReceiptView } from '../lib/dashboard-types';

const RESULT_COLORS = new Map<string, string>([
  ['success', 'bg-green-100 text-green-700'],
  ['failure', 'bg-red-100 text-red-700'],
  ['denied', 'bg-amber-100 text-amber-700'],
  ['crashed', 'bg-red-200 text-red-800'],
]);

const DEFAULT_RESULT_COLOR = 'bg-slate-100 text-slate-600';
const IN_PROGRESS_LABEL = 'in progress';

function getResultColor(result: string | undefined): string {
  if (!result) {
    return DEFAULT_RESULT_COLOR;
  }
  return RESULT_COLORS.get(result) ?? DEFAULT_RESULT_COLOR;
}

interface ToolReceiptProps {
  readonly receipt: ToolReceiptView;
}

export function ToolReceipt({ receipt }: ToolReceiptProps) {
  return (
    <div
      data-testid={`tool-receipt-${receipt.receiptId}`}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-800">{receipt.toolName}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${getResultColor(receipt.result)}`}
          >
            {receipt.result ?? IN_PROGRESS_LABEL}
          </span>
        </div>
        {receipt.durationMs !== undefined && (
          <span className="text-xs text-slate-400 font-mono">{receipt.durationMs}ms</span>
        )}
      </div>

      {/* Scopes */}
      {receipt.scopeRequested.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">Scopes</h4>
          <div className="mt-1 flex flex-wrap gap-1">
            {receipt.scopeRequested.map((scope) => (
              <span
                key={`scope-${receipt.receiptId}-${scope.type}-${scope.pattern ?? ''}-${scope.access ?? ''}`}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                <span className="font-medium">{scope.type}</span>
                {scope.pattern && <span className="font-mono">{scope.pattern}</span>}
                {scope.access && (
                  <span className="rounded bg-slate-200 px-1 text-[10px] font-medium uppercase">
                    {scope.access}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Policy Decisions */}
      {receipt.policyDecisions.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">Policy</h4>
          <div className="mt-1 space-y-1">
            {receipt.policyDecisions.map((decision) => (
              <div
                key={`policy-${receipt.receiptId}-${decision.policyId}-${decision.decision}`}
                className="flex items-center gap-2 text-xs"
              >
                <span
                  className={`rounded-full px-1.5 py-0.5 font-medium ${
                    decision.decision === 'allow'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {decision.decision}
                </span>
                <span className="font-mono text-slate-500">{decision.policyId}</span>
                {decision.reason && <span className="text-slate-400">{decision.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
