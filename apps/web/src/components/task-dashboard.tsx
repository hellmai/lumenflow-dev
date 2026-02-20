'use client';

import type {
  ApprovalRequestView,
  DashboardEvent,
  EvidenceLink,
  PolicyDecisionView,
  PolicyDenialView,
  SseConnectionState,
  TaskStatus,
  ToolReceiptView,
} from '../lib/dashboard-types';
import { APPROVAL_STATUSES } from '../lib/dashboard-types';
import { TaskStateMachine } from './task-state-machine';
import { EventLog } from './event-log';
import { ToolReceipt } from './tool-receipt';
import { EvidenceChain } from './evidence-chain';
import { ApprovalCard } from './approval-card';
import { PolicyAuditTab } from './policy-audit-tab';
import { PolicyDecisionOverlay } from './policy-decision-overlay';

const CONNECTION_BADGE_COLORS = new Map<SseConnectionState, string>([
  ['connecting', 'bg-amber-100 text-amber-700'],
  ['connected', 'bg-green-100 text-green-700'],
  ['disconnected', 'bg-slate-100 text-slate-500'],
  ['error', 'bg-red-100 text-red-700'],
]);

const SECTION_TITLE_CLASS = 'text-sm font-semibold uppercase tracking-wide text-slate-500';

interface TaskDashboardProps {
  readonly taskId: string;
  readonly connectionState: SseConnectionState;
  readonly currentStatus: TaskStatus;
  readonly events: readonly DashboardEvent[];
  readonly toolReceipts: readonly ToolReceiptView[];
  readonly approvalRequests: readonly ApprovalRequestView[];
  readonly onApprove: (receiptId: string) => void;
  readonly onDeny: (receiptId: string) => void;
  readonly evidenceLinks: readonly EvidenceLink[];
  readonly policyDecisions?: readonly PolicyDecisionView[];
  readonly policyDenials?: readonly PolicyDenialView[];
}

export function TaskDashboard({
  taskId,
  connectionState,
  currentStatus,
  events,
  toolReceipts,
  approvalRequests,
  onApprove,
  onDeny,
  evidenceLinks,
  policyDecisions,
  policyDenials,
}: TaskDashboardProps) {
  const pendingApprovals = approvalRequests.filter(
    (request) => request.status === APPROVAL_STATUSES.PENDING,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div data-testid="dashboard-header" className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Task Dashboard</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{taskId}</p>
        </div>
        <div
          data-testid="connection-status"
          className={`rounded-full px-3 py-1 text-xs font-medium ${CONNECTION_BADGE_COLORS.get(connectionState) ?? ''}`}
        >
          {connectionState}
        </div>
      </div>

      {/* State Machine */}
      <section>
        <h2 className={SECTION_TITLE_CLASS}>Task Lifecycle</h2>
        <div className="mt-3">
          <TaskStateMachine currentStatus={currentStatus} />
        </div>
      </section>

      {/* Human-in-the-loop Approvals */}
      {pendingApprovals.length > 0 && (
        <section>
          <h2 className={SECTION_TITLE_CLASS}>
            Pending Approvals{' '}
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
              {pendingApprovals.length}
            </span>
          </h2>
          <div className="mt-3 space-y-3">
            {pendingApprovals.map((request) => (
              <ApprovalCard
                key={request.receiptId}
                request={request}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            ))}
          </div>
        </section>
      )}

      {/* Policy Decision Overlays (WU-1924) */}
      {policyDenials && policyDenials.length > 0 && (
        <section>
          <h2 className={SECTION_TITLE_CLASS}>
            Policy Denials{' '}
            <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-500">
              {policyDenials.length}
            </span>
          </h2>
          <div className="mt-3 space-y-4">
            {policyDenials.map((denial) => (
              <PolicyDecisionOverlay key={denial.receiptId} denial={denial} />
            ))}
          </div>
        </section>
      )}

      {/* Event Log */}
      <section>
        <h2 className={SECTION_TITLE_CLASS}>
          Event Log{' '}
          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
            {events.length}
          </span>
        </h2>
        <div className="mt-3">
          <EventLog events={events} />
        </div>
      </section>

      {/* Tool Receipts */}
      {toolReceipts.length > 0 && (
        <section>
          <h2 className={SECTION_TITLE_CLASS}>
            Tool Receipts{' '}
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
              {toolReceipts.length}
            </span>
          </h2>
          <div className="mt-3 space-y-3">
            {toolReceipts.map((receipt) => (
              <ToolReceipt key={receipt.receiptId} receipt={receipt} />
            ))}
          </div>
        </section>
      )}

      {/* Policy Audit */}
      <section>
        <h2 className={SECTION_TITLE_CLASS}>
          Policy Audit{' '}
          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
            {policyDecisions?.length ?? 0}
          </span>
        </h2>
        <div className="mt-3">
          <PolicyAuditTab decisions={policyDecisions ?? []} />
        </div>
      </section>

      {/* Evidence Chain */}
      <section>
        <h2 className={SECTION_TITLE_CLASS}>Evidence Chain</h2>
        <div className="mt-3">
          <EvidenceChain links={evidenceLinks} />
        </div>
      </section>
    </div>
  );
}
