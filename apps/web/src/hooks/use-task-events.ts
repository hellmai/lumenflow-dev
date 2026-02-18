'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPROVAL_STATUSES,
  EVENT_KIND_TO_STATE,
  POLICY_DECISIONS,
  SSE_CONNECTION_STATES,
  TASK_STATES,
  type ApprovalRequestView,
  type DashboardEvent,
  type DashboardState,
  type EvidenceLink,
  type PolicyDecisionType,
  type PolicyDecisionView,
  type ScopeView,
  type SseConnectionState,
  type TaskStatus,
  type ToolReceiptView,
} from '../lib/dashboard-types';

// --- Constants ---

const API_EVENTS_PREFIX = '/api/events/';
const EVENT_ID_PREFIX = 'sse-';
const APPROVAL_EVENT_ID_PREFIX = 'approval-';

const EVENT_KIND = {
  TOOL_CALL_STARTED: 'tool_call_started',
  TOOL_CALL_FINISHED: 'tool_call_finished',
  TASK_RESUMED: 'task_resumed',
  TASK_WAITING: 'task_waiting',
  AG_UI_APPROVAL_RESULT: 'ag_ui_approval_result',
} as const;

const APPROVAL_ACTION = {
  APPROVE: 'approve',
  DENY: 'deny',
} as const;

type ApprovalAction = (typeof APPROVAL_ACTION)[keyof typeof APPROVAL_ACTION];

// --- Pure helper functions (exported for testing) ---

export function buildEventsUrl(taskId: string): string {
  return `${API_EVENTS_PREFIX}${encodeURIComponent(taskId)}`;
}

export function parseSSELine(data: string, taskId: string): DashboardEvent | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;

    if (typeof parsed.kind !== 'string' || typeof parsed.timestamp !== 'string') {
      return null;
    }

    const { kind, timestamp, task_id, ...rest } = parsed;

    return {
      id: `${EVENT_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: kind as string,
      timestamp: timestamp as string,
      taskId: (task_id as string) ?? taskId,
      data: rest as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function deriveStateFromEvents(events: readonly DashboardEvent[]): TaskStatus {
  let currentState: TaskStatus = TASK_STATES.READY;

  for (const event of events) {
    const nextState = EVENT_KIND_TO_STATE.get(event.kind);
    if (nextState !== undefined) {
      currentState = nextState;
    }
  }

  return currentState;
}

function toScopeViews(scopes: unknown): readonly ScopeView[] {
  if (!Array.isArray(scopes)) {
    return [];
  }

  return scopes
    .filter(
      (scope): scope is Record<string, unknown> => typeof scope === 'object' && scope !== null,
    )
    .map((scope) => ({
      type: String(scope.type ?? ''),
      pattern: scope.pattern != null ? String(scope.pattern) : undefined,
      access: scope.access != null ? String(scope.access) : undefined,
      posture: scope.posture != null ? String(scope.posture) : undefined,
    }));
}

function toPolicyDecisionViews(decisions: unknown): readonly PolicyDecisionView[] {
  if (!Array.isArray(decisions)) {
    return [];
  }

  const toPolicyDecisionType = (value: unknown): PolicyDecisionType => {
    if (value === POLICY_DECISIONS.ALLOW) {
      return POLICY_DECISIONS.ALLOW;
    }
    if (value === POLICY_DECISIONS.APPROVAL_REQUIRED) {
      return POLICY_DECISIONS.APPROVAL_REQUIRED;
    }
    return POLICY_DECISIONS.DENY;
  };

  return decisions
    .filter(
      (decision): decision is Record<string, unknown> =>
        typeof decision === 'object' && decision !== null,
    )
    .map((decision) => ({
      policyId: String(decision.policy_id ?? ''),
      decision: toPolicyDecisionType(decision.decision),
      reason: decision.reason != null ? String(decision.reason) : undefined,
    }));
}

export function extractToolReceipts(events: readonly DashboardEvent[]): ToolReceiptView[] {
  const startedByReceiptId = new Map<string, DashboardEvent>();
  const finishedByReceiptId = new Map<string, DashboardEvent>();

  for (const event of events) {
    const receiptId = event.data.receipt_id;
    if (typeof receiptId !== 'string') {
      continue;
    }

    if (event.kind === EVENT_KIND.TOOL_CALL_STARTED) {
      startedByReceiptId.set(receiptId, event);
    } else if (event.kind === EVENT_KIND.TOOL_CALL_FINISHED) {
      finishedByReceiptId.set(receiptId, event);
    }
  }

  const receipts: ToolReceiptView[] = [];

  for (const [receiptId, started] of startedByReceiptId) {
    const finished = finishedByReceiptId.get(receiptId);

    receipts.push({
      receiptId,
      toolName: String(started.data.tool_name ?? ''),
      startedAt: started.timestamp,
      finishedAt: finished?.timestamp,
      durationMs: finished?.data.duration_ms as number | undefined,
      result: finished?.data.result as ToolReceiptView['result'],
      scopeRequested: toScopeViews(started.data.scope_requested),
      scopeAllowed: toScopeViews(started.data.scope_allowed),
      policyDecisions: finished ? toPolicyDecisionViews(finished.data.policy_decisions) : [],
    });
  }

  return receipts;
}

export function extractApprovalRequests(
  receipts: readonly ToolReceiptView[],
): readonly ApprovalRequestView[] {
  return receipts.reduce<ApprovalRequestView[]>((approvals, receipt) => {
    const approvalDecision = receipt.policyDecisions.find(
      (decision) => decision.decision === POLICY_DECISIONS.APPROVAL_REQUIRED,
    );

    if (!approvalDecision) {
      return approvals;
    }

    approvals.push({
      receiptId: receipt.receiptId,
      toolName: receipt.toolName,
      policyId: approvalDecision.policyId,
      reason: approvalDecision.reason,
      scopeRequested: receipt.scopeRequested,
      scopeAllowed: receipt.scopeAllowed,
      status: APPROVAL_STATUSES.PENDING,
    });

    return approvals;
  }, []);
}

interface ApprovalDecisionInput {
  events: readonly DashboardEvent[];
  taskId: string;
  receiptId: string;
  decision: ApprovalAction;
}

function createApprovalEvent(
  taskId: string,
  kind: string,
  data: Record<string, unknown>,
  timestamp: string,
): DashboardEvent {
  return {
    id: `${APPROVAL_EVENT_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    timestamp,
    taskId,
    data,
  };
}

export function applyApprovalDecision(input: ApprovalDecisionInput): DashboardEvent[] {
  const timestamp = new Date().toISOString();
  const nextEvents: DashboardEvent[] = [...input.events];

  nextEvents.push(
    createApprovalEvent(
      input.taskId,
      EVENT_KIND.AG_UI_APPROVAL_RESULT,
      {
        receipt_id: input.receiptId,
        decision: input.decision,
      },
      timestamp,
    ),
  );

  if (input.decision === APPROVAL_ACTION.APPROVE) {
    nextEvents.push(
      createApprovalEvent(
        input.taskId,
        EVENT_KIND.TASK_RESUMED,
        {
          reason: POLICY_DECISIONS.APPROVAL_REQUIRED,
          receipt_id: input.receiptId,
        },
        timestamp,
      ),
    );
  } else {
    nextEvents.push(
      createApprovalEvent(
        input.taskId,
        EVENT_KIND.TASK_WAITING,
        {
          reason: POLICY_DECISIONS.APPROVAL_REQUIRED,
          receipt_id: input.receiptId,
        },
        timestamp,
      ),
    );
  }

  return nextEvents;
}

const EVIDENCE_BEARING_KINDS = new Set(['task_completed', 'run_succeeded', 'run_failed']);

export function extractEvidenceLinks(events: readonly DashboardEvent[]): EvidenceLink[] {
  const links: EvidenceLink[] = [];

  for (const event of events) {
    if (event.kind === 'tool_call_finished') {
      const receiptId = event.data.receipt_id;
      if (typeof receiptId === 'string') {
        links.push({
          id: `evidence-receipt-${receiptId}`,
          type: 'receipt',
          label: `${event.data.result ?? 'tool'} receipt`,
          timestamp: event.timestamp,
          ref: receiptId,
        });
      }
    }

    if (EVIDENCE_BEARING_KINDS.has(event.kind)) {
      links.push({
        id: `evidence-event-${event.id}`,
        type: 'event',
        label: event.kind,
        timestamp: event.timestamp,
        ref: event.id,
      });
    }
  }

  return links;
}

// --- React Hook ---

export interface UseTaskEventsOptions {
  readonly taskId: string;
  readonly enabled?: boolean;
}

export interface UseTaskEventsResult {
  readonly state: DashboardState;
  readonly approvePendingApproval: (receiptId: string) => void;
  readonly denyPendingApproval: (receiptId: string) => void;
}

export function useTaskEvents(options: UseTaskEventsOptions): UseTaskEventsResult {
  const { taskId, enabled = true } = options;

  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [approvalStatusByReceiptId, setApprovalStatusByReceiptId] = useState<
    Record<string, { status: ApprovalRequestView['status']; decidedAt: string }>
  >({});
  const [connectionState, setConnectionState] = useState<SseConnectionState>(
    SSE_CONNECTION_STATES.CONNECTING,
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const connectionStateRef = useRef(setConnectionState);
  connectionStateRef.current = setConnectionState;

  const handleMessage = useCallback(
    (messageEvent: MessageEvent) => {
      const parsed = parseSSELine(messageEvent.data as string, taskId);
      if (parsed) {
        setEvents((prev) => [...prev, parsed]);
      }
    },
    [taskId],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const updateConnection = connectionStateRef.current;
    const url = buildEventsUrl(taskId);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      updateConnection(SSE_CONNECTION_STATES.CONNECTED);
    };

    eventSource.onmessage = handleMessage;

    eventSource.onerror = () => {
      updateConnection(SSE_CONNECTION_STATES.ERROR);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [taskId, enabled, handleMessage]);

  const currentStatus = deriveStateFromEvents(events);
  const toolReceipts = extractToolReceipts(events);
  const approvalRequests = extractApprovalRequests(toolReceipts).map((request) => {
    const override = approvalStatusByReceiptId[request.receiptId];
    if (!override) {
      return request;
    }

    return {
      ...request,
      status: override.status,
      decidedAt: override.decidedAt,
    };
  });
  const evidenceLinks = extractEvidenceLinks(events);

  const applyDecision = useCallback(
    (receiptId: string, decision: ApprovalAction): void => {
      const decidedAt = new Date().toISOString();
      setApprovalStatusByReceiptId((prev) => ({
        ...prev,
        [receiptId]: {
          status:
            decision === APPROVAL_ACTION.APPROVE
              ? APPROVAL_STATUSES.APPROVED
              : APPROVAL_STATUSES.DENIED,
          decidedAt,
        },
      }));

      setEvents((prev) =>
        applyApprovalDecision({
          events: prev,
          taskId,
          receiptId,
          decision,
        }),
      );
    },
    [taskId],
  );

  return {
    state: {
      taskId,
      connectionState,
      currentStatus,
      events,
      toolReceipts,
      approvalRequests,
      evidenceLinks,
    },
    approvePendingApproval: (receiptId) => applyDecision(receiptId, APPROVAL_ACTION.APPROVE),
    denyPendingApproval: (receiptId) => applyDecision(receiptId, APPROVAL_ACTION.DENY),
  };
}
