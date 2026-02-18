'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EVENT_KIND_TO_STATE,
  SSE_CONNECTION_STATES,
  TASK_STATES,
  type DashboardEvent,
  type DashboardState,
  type EvidenceLink,
  type PolicyDecisionView,
  type ScopeView,
  type SseConnectionState,
  type TaskStatus,
  type ToolReceiptView,
} from '../lib/dashboard-types';

// --- Constants ---

const API_EVENTS_PREFIX = '/api/events/';
const EVENT_ID_PREFIX = 'sse-';

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

  return decisions
    .filter(
      (decision): decision is Record<string, unknown> =>
        typeof decision === 'object' && decision !== null,
    )
    .map((decision) => ({
      policyId: String(decision.policy_id ?? ''),
      decision: (decision.decision as 'allow' | 'deny') ?? 'deny',
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

    if (event.kind === 'tool_call_started') {
      startedByReceiptId.set(receiptId, event);
    } else if (event.kind === 'tool_call_finished') {
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
}

export function useTaskEvents(options: UseTaskEventsOptions): UseTaskEventsResult {
  const { taskId, enabled = true } = options;

  const [events, setEvents] = useState<DashboardEvent[]>([]);
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
  const evidenceLinks = extractEvidenceLinks(events);

  return {
    state: {
      taskId,
      connectionState,
      currentStatus,
      events,
      toolReceipts,
      evidenceLinks,
    },
  };
}
