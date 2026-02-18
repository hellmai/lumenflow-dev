'use client';

/**
 * Policy decision overlay component (WU-1834).
 * Displays a comprehensive view when a tool execution is denied by governance.
 * Shows policy_id, reason, scope intersection, and visual action diff.
 * This is the "governance you can see" differentiator.
 */

import type { PolicyDenialView } from '../lib/dashboard-types';
import { ScopeIntersectionDiagram } from './scope-intersection-diagram';
import { ActionDiffViewer } from './action-diff-viewer';

const SECTION_TITLE_CLASS = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toISOString().split('T')[1]?.replace('Z', '') ?? iso;
  } catch {
    return iso;
  }
}

interface PolicyDecisionOverlayProps {
  readonly denial: PolicyDenialView;
}

export function PolicyDecisionOverlay({ denial }: PolicyDecisionOverlayProps) {
  return (
    <div
      data-testid="policy-decision-overlay"
      className="rounded-xl border border-red-200 bg-white shadow-lg"
    >
      {/* Header */}
      <div className="rounded-t-xl border-b border-red-200 bg-red-50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              data-testid="denial-badge"
              className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase text-red-700"
            >
              denied
            </span>
            <span className="font-mono text-sm font-semibold text-slate-800">
              {denial.toolName}
            </span>
          </div>
          <span className="font-mono text-xs text-slate-400">
            {formatTimestamp(denial.timestamp)}
          </span>
        </div>

        {/* Policy ID and Reason */}
        <div className="mt-3 space-y-1">
          <div data-testid="denial-policy-id" className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase text-red-600">Policy</span>
            <span className="rounded bg-red-100 px-2 py-0.5 font-mono text-sm font-semibold text-red-800">
              {denial.policyId}
            </span>
          </div>
          <p data-testid="denial-reason" className="text-sm text-red-700">
            {denial.reason}
          </p>
        </div>

        {/* Receipt ID for traceability */}
        <div className="mt-2">
          <span className="font-mono text-xs text-slate-400">receipt: {denial.receiptId}</span>
        </div>
      </div>

      {/* Scope Intersection */}
      <div className="border-b border-slate-200 px-6 py-4">
        <h3 className={SECTION_TITLE_CLASS}>Scope Intersection</h3>
        <div className="mt-3">
          <ScopeIntersectionDiagram intersection={denial.scopeIntersection} />
        </div>
      </div>

      {/* Action Diff */}
      <div className="px-6 py-4">
        <h3 className={SECTION_TITLE_CLASS}>Action Diff</h3>
        <p className="mt-1 text-xs text-slate-400">
          What the agent attempted vs what governance permitted
        </p>
        <div className="mt-3">
          <ActionDiffViewer entries={denial.actionDiff} />
        </div>
      </div>
    </div>
  );
}
