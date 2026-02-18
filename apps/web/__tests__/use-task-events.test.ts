import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSSELine,
  buildEventsUrl,
  deriveStateFromEvents,
  extractToolReceipts,
  extractEvidenceLinks,
  applyApprovalDecision,
  extractApprovalRequests,
} from '../src/hooks/use-task-events';
import type { DashboardEvent } from '../src/lib/dashboard-types';

/* ------------------------------------------------------------------
 * AC1: SSE client connects and displays live events (pure functions)
 * These tests cover the parsing and state-derivation logic without
 * requiring a DOM or EventSource mock.
 * ------------------------------------------------------------------ */

const TASK_ID = 'task-xyz-789';

describe('buildEventsUrl', () => {
  it('constructs the SSE endpoint URL for a given task ID', () => {
    const url = buildEventsUrl(TASK_ID);
    expect(url).toBe(`/api/events/${TASK_ID}`);
  });

  it('encodes task IDs containing special characters', () => {
    const url = buildEventsUrl('task/with spaces');
    expect(url).toBe('/api/events/task%2Fwith%20spaces');
  });
});

describe('parseSSELine', () => {
  it('parses a valid SSE data line into a DashboardEvent', () => {
    const sseData = JSON.stringify({
      kind: 'task_created',
      timestamp: '2026-02-18T10:00:00.000Z',
      task_id: TASK_ID,
      spec_hash: 'abc',
    });

    const event = parseSSELine(sseData, TASK_ID);
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('task_created');
    expect(event!.taskId).toBe(TASK_ID);
    expect(event!.timestamp).toBe('2026-02-18T10:00:00.000Z');
  });

  it('returns null for malformed JSON', () => {
    const event = parseSSELine('not valid json', TASK_ID);
    expect(event).toBeNull();
  });

  it('returns null for data missing kind field', () => {
    const sseData = JSON.stringify({ timestamp: '2026-02-18T10:00:00.000Z' });
    const event = parseSSELine(sseData, TASK_ID);
    expect(event).toBeNull();
  });
});

describe('deriveStateFromEvents', () => {
  it('returns ready for an empty event list', () => {
    expect(deriveStateFromEvents([])).toBe('ready');
  });

  it('derives active state after task_claimed event', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'task_created',
        timestamp: '2026-02-18T10:00:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
      {
        id: 'e2',
        kind: 'task_claimed',
        timestamp: '2026-02-18T10:01:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
    ];
    expect(deriveStateFromEvents(events)).toBe('active');
  });

  it('derives done state after task_completed event', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'task_claimed',
        timestamp: '2026-02-18T10:00:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
      {
        id: 'e2',
        kind: 'task_completed',
        timestamp: '2026-02-18T10:05:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
    ];
    expect(deriveStateFromEvents(events)).toBe('done');
  });

  it('handles blocked and unblocked transitions', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'task_claimed',
        timestamp: '2026-02-18T10:00:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
      {
        id: 'e2',
        kind: 'task_blocked',
        timestamp: '2026-02-18T10:01:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
    ];
    expect(deriveStateFromEvents(events)).toBe('blocked');

    const withUnblock: DashboardEvent[] = [
      ...events,
      {
        id: 'e3',
        kind: 'task_unblocked',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
    ];
    expect(deriveStateFromEvents(withUnblock)).toBe('active');
  });
});

describe('extractToolReceipts', () => {
  it('pairs tool_call_started and tool_call_finished events into receipts', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-1',
          tool_name: 'git.commit',
          scope_requested: [{ type: 'path', pattern: 'src/**', access: 'write' }],
          scope_allowed: [{ type: 'path', pattern: 'src/**', access: 'write' }],
        },
      },
      {
        id: 'e2',
        kind: 'tool_call_finished',
        timestamp: '2026-02-18T10:02:05.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-1',
          result: 'success',
          duration_ms: 5000,
          policy_decisions: [{ policy_id: 'ws-default', decision: 'allow', reason: 'Allowed' }],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptId).toBe('rcpt-1');
    expect(receipts[0].toolName).toBe('git.commit');
    expect(receipts[0].durationMs).toBe(5000);
    expect(receipts[0].result).toBe('success');
    expect(receipts[0].policyDecisions).toHaveLength(1);
    expect(receipts[0].scopeRequested).toHaveLength(1);
  });

  it('returns incomplete receipts for started-only events', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-2',
          tool_name: 'file.read',
          scope_requested: [],
          scope_allowed: [],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].toolName).toBe('file.read');
    expect(receipts[0].finishedAt).toBeUndefined();
    expect(receipts[0].result).toBeUndefined();
  });
});

describe('extractApprovalRequests', () => {
  it('extracts pending approvals from tool receipts with approval_required policy decisions', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-approval-1',
          tool_name: 'git.push',
          scope_requested: [{ type: 'path', pattern: 'apps/web/**', access: 'write' }],
          scope_allowed: [{ type: 'path', pattern: 'apps/web/**', access: 'write' }],
        },
      },
      {
        id: 'e2',
        kind: 'tool_call_finished',
        timestamp: '2026-02-18T10:02:05.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-approval-1',
          result: 'denied',
          duration_ms: 5000,
          policy_decisions: [
            {
              policy_id: 'policy.approval.required',
              decision: 'approval_required',
              reason: 'manual gate',
            },
          ],
        },
      },
    ];

    const approvals = extractApprovalRequests(extractToolReceipts(events));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.receiptId).toBe('rcpt-approval-1');
    expect(approvals[0]?.status).toBe('pending');
  });
});

describe('applyApprovalDecision', () => {
  it('adds a synthetic task_resumed event when an approval is granted', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'task_waiting',
        timestamp: '2026-02-18T10:00:00.000Z',
        taskId: TASK_ID,
        data: { reason: 'approval required' },
      },
    ];

    const nextEvents = applyApprovalDecision({
      events,
      taskId: TASK_ID,
      receiptId: 'rcpt-approval-1',
      decision: 'approve',
    });

    const resumedEvent = nextEvents.find((event) => event.kind === 'task_resumed');
    expect(resumedEvent).toBeDefined();
    expect(deriveStateFromEvents(nextEvents)).toBe('active');
  });
});

describe('extractEvidenceLinks', () => {
  it('creates evidence links from completed events and receipts', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'task_completed',
        timestamp: '2026-02-18T10:05:00.000Z',
        taskId: TASK_ID,
        data: { evidence_refs: ['ref-1'] },
      },
      {
        id: 'e2',
        kind: 'tool_call_finished',
        timestamp: '2026-02-18T10:02:05.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-1',
          result: 'success',
          duration_ms: 5000,
          policy_decisions: [],
        },
      },
    ];

    const links = extractEvidenceLinks(events);
    expect(links.length).toBeGreaterThanOrEqual(2);

    const receiptLink = links.find((l) => l.type === 'receipt');
    const eventLink = links.find((l) => l.type === 'event');
    expect(receiptLink).toBeDefined();
    expect(eventLink).toBeDefined();
  });

  it('returns empty array when no evidence-bearing events exist', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'task_created',
        timestamp: '2026-02-18T10:00:00.000Z',
        taskId: TASK_ID,
        data: {},
      },
    ];

    const links = extractEvidenceLinks(events);
    expect(links).toHaveLength(0);
  });
});
