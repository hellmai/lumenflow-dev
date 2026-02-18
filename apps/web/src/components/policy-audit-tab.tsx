'use client';

import type { PolicyDecisionView } from '../lib/dashboard-types';

const DECISION_BADGE_COLORS: Record<string, string> = {
  allow: 'bg-green-100 text-green-700 border-green-200',
  deny: 'bg-red-100 text-red-700 border-red-200',
  approval_required: 'bg-amber-100 text-amber-700 border-amber-200',
};

const DEFAULT_BADGE_COLOR = 'bg-slate-100 text-slate-600 border-slate-200';

interface PolicyAuditTabProps {
  readonly decisions: readonly PolicyDecisionView[];
}

export function PolicyAuditTab({ decisions }: PolicyAuditTabProps) {
  if (decisions.length === 0) {
    return (
      <div
        data-testid="policy-audit-empty"
        className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400"
      >
        No policy decisions recorded.
      </div>
    );
  }

  return (
    <div data-testid="policy-audit" className="space-y-2">
      {/* Header row */}
      <div className="grid grid-cols-3 gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div>Policy ID</div>
        <div>Decision</div>
        <div>Reason</div>
      </div>

      {/* Decision rows */}
      {decisions.map((decision) => (
        <div
          key={`${decision.policyId}-${decision.decision}`}
          data-testid={`policy-decision-row-${decision.policyId}`}
          className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {/* Policy ID */}
          <div className="font-mono font-medium text-slate-800">{decision.policyId}</div>

          {/* Decision badge */}
          <div>
            <span
              data-testid={`policy-badge-${decision.policyId}`}
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${DECISION_BADGE_COLORS[decision.decision] ?? DEFAULT_BADGE_COLOR}`}
            >
              {decision.decision}
            </span>
          </div>

          {/* Reason */}
          <div className="text-slate-600">{decision.reason ?? 'No reason provided.'}</div>
        </div>
      ))}
    </div>
  );
}
