import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSSELine,
  buildEventsUrl,
  computeBackoffMs,
  deriveStateFromEvents,
  extractToolReceipts,
  extractEvidenceLinks,
  applyApprovalDecision,
  extractApprovalRequests,
  extractPolicyDenials,
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

  it('parses a StreamEvent envelope with source: kernel', () => {
    const sseData = JSON.stringify({
      source: 'kernel',
      event: {
        kind: 'task_claimed',
        timestamp: '2026-02-18T10:01:00.000Z',
        task_id: TASK_ID,
        by: 'tom',
        session_id: 'session-1',
      },
    });

    const event = parseSSELine(sseData, TASK_ID);
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('task_claimed');
    expect(event!.taskId).toBe(TASK_ID);
    expect(event!.timestamp).toBe('2026-02-18T10:01:00.000Z');
    expect(event!.data).toEqual({ by: 'tom', session_id: 'session-1' });
  });

  it('parses a StreamEvent envelope with source: evidence', () => {
    const sseData = JSON.stringify({
      source: 'evidence',
      trace: {
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        task_id: TASK_ID,
        receipt_id: 'rcpt-1',
        tool_name: 'git.commit',
      },
    });

    const event = parseSSELine(sseData, TASK_ID);
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('tool_call_started');
    expect(event!.taskId).toBe(TASK_ID);
    expect(event!.data).toEqual({ receipt_id: 'rcpt-1', tool_name: 'git.commit' });
  });

  it('falls back to taskId parameter when envelope inner has no task_id', () => {
    const sseData = JSON.stringify({
      source: 'kernel',
      event: {
        kind: 'task_created',
        timestamp: '2026-02-18T10:00:00.000Z',
        spec_hash: 'abc',
      },
    });

    const event = parseSSELine(sseData, TASK_ID);
    expect(event).not.toBeNull();
    expect(event!.taskId).toBe(TASK_ID);
  });

  it('returns null for envelope with missing inner kind', () => {
    const sseData = JSON.stringify({
      source: 'kernel',
      event: {
        timestamp: '2026-02-18T10:00:00.000Z',
      },
    });

    const event = parseSSELine(sseData, TASK_ID);
    expect(event).toBeNull();
  });

  it('returns null for envelope with unknown source and no inner', () => {
    const sseData = JSON.stringify({
      source: 'unknown',
    });

    const event = parseSSELine(sseData, TASK_ID);
    expect(event).toBeNull();
  });
});

/* ------------------------------------------------------------------
 * AC5: Reconnection with exponential backoff (pure function)
 * ------------------------------------------------------------------ */

describe('computeBackoffMs', () => {
  it('returns a value in [base, base * 1.5] for attempt 0', () => {
    const BASE_MS = 1000;
    const JITTER_FACTOR = 0.5;
    for (let i = 0; i < 20; i++) {
      const ms = computeBackoffMs(0);
      expect(ms).toBeGreaterThanOrEqual(BASE_MS);
      expect(ms).toBeLessThanOrEqual(BASE_MS + BASE_MS * JITTER_FACTOR);
    }
  });

  it('doubles the base for each attempt (exponential growth)', () => {
    // Attempt 3 => base * 2^3 = 8000, range [8000, 12000]
    for (let i = 0; i < 20; i++) {
      const ms = computeBackoffMs(3);
      expect(ms).toBeGreaterThanOrEqual(8000);
      expect(ms).toBeLessThanOrEqual(12000);
    }
  });

  it('caps at BACKOFF_MAX_MS for high attempt numbers', () => {
    const MAX_MS = 30_000;
    const JITTER_FACTOR = 0.5;
    for (let i = 0; i < 20; i++) {
      const ms = computeBackoffMs(100);
      expect(ms).toBeGreaterThanOrEqual(MAX_MS);
      expect(ms).toBeLessThanOrEqual(MAX_MS + MAX_MS * JITTER_FACTOR);
    }
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

/* ------------------------------------------------------------------
 * WU-1924: AC1 - extractToolReceipts includes scope_enforced
 * ------------------------------------------------------------------ */

describe('extractToolReceipts scope_enforced (WU-1924 AC1)', () => {
  it('includes scopeEnforced from finished event data', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-enforced-1',
          tool_name: 'fs.write',
          scope_requested: [{ type: 'path', pattern: '.env', access: 'write' }],
          scope_allowed: [{ type: 'path', pattern: 'src/**', access: 'write' }],
        },
      },
      {
        id: 'e2',
        kind: 'tool_call_finished',
        timestamp: '2026-02-18T10:02:05.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-enforced-1',
          result: 'denied',
          duration_ms: 100,
          policy_decisions: [
            { policy_id: 'workspace-no-secrets', decision: 'deny', reason: 'Blocked' },
          ],
          scope_enforced: [
            { type: 'path', pattern: '.env', access: 'deny' },
            { type: 'path', pattern: '.aws/**', access: 'deny' },
          ],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].scopeEnforced).toBeDefined();
    expect(receipts[0].scopeEnforced).toHaveLength(2);
    expect(receipts[0].scopeEnforced[0].type).toBe('path');
    expect(receipts[0].scopeEnforced[0].pattern).toBe('.env');
    expect(receipts[0].scopeEnforced[0].access).toBe('deny');
  });

  it('returns empty scopeEnforced when finished event has no scope_enforced', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-no-enforced',
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
          receipt_id: 'rcpt-no-enforced',
          result: 'success',
          duration_ms: 5000,
          policy_decisions: [{ policy_id: 'ws-default', decision: 'allow', reason: 'Allowed' }],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].scopeEnforced).toBeDefined();
    expect(receipts[0].scopeEnforced).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
 * WU-1924: AC2 - PolicyDenialView built from denied tool receipts
 * ------------------------------------------------------------------ */

describe('extractPolicyDenials (WU-1924 AC2)', () => {
  it('builds PolicyDenialView from denied tool receipts', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-denied-1',
          tool_name: 'fs.write',
          scope_requested: [{ type: 'path', pattern: '.env', access: 'write' }],
          scope_allowed: [{ type: 'path', pattern: 'src/**', access: 'write' }],
        },
      },
      {
        id: 'e2',
        kind: 'tool_call_finished',
        timestamp: '2026-02-18T10:02:01.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-denied-1',
          result: 'denied',
          duration_ms: 100,
          policy_decisions: [
            { policy_id: 'workspace-no-secrets', decision: 'deny', reason: 'Write to .env blocked' },
          ],
          scope_enforced: [{ type: 'path', pattern: '.env', access: 'deny' }],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    const denials = extractPolicyDenials(receipts);

    expect(denials).toHaveLength(1);
    expect(denials[0].receiptId).toBe('rcpt-denied-1');
    expect(denials[0].toolName).toBe('fs.write');
    expect(denials[0].policyId).toBe('workspace-no-secrets');
    expect(denials[0].reason).toBe('Write to .env blocked');
    expect(denials[0].timestamp).toBe('2026-02-18T10:02:00.000Z');
  });

  it('returns empty array when no denied receipts exist', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T10:02:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-ok-1',
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
          receipt_id: 'rcpt-ok-1',
          result: 'success',
          duration_ms: 5000,
          policy_decisions: [{ policy_id: 'ws-default', decision: 'allow', reason: 'Allowed' }],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    const denials = extractPolicyDenials(receipts);
    expect(denials).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
 * WU-1924: AC3 - ScopeIntersectionView constructed from requested/allowed/enforced
 * ------------------------------------------------------------------ */

describe('extractPolicyDenials scopeIntersection (WU-1924 AC3)', () => {
  it('constructs ScopeIntersectionView from receipt scope fields', () => {
    const events: DashboardEvent[] = [
      {
        id: 'e1',
        kind: 'tool_call_started',
        timestamp: '2026-02-18T14:30:00.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-scope-test',
          tool_name: 'fs.write',
          scope_requested: [
            { type: 'path', pattern: '.env', access: 'write' },
            { type: 'path', pattern: 'src/**', access: 'write' },
          ],
          scope_allowed: [{ type: 'path', pattern: 'src/**', access: 'write' }],
        },
      },
      {
        id: 'e2',
        kind: 'tool_call_finished',
        timestamp: '2026-02-18T14:30:01.000Z',
        taskId: TASK_ID,
        data: {
          receipt_id: 'rcpt-scope-test',
          result: 'denied',
          duration_ms: 50,
          policy_decisions: [
            { policy_id: 'workspace-no-secrets', decision: 'deny', reason: 'Blocked by policy' },
          ],
          scope_enforced: [
            { type: 'path', pattern: '.env', access: 'deny' },
            { type: 'path', pattern: '.aws/**', access: 'deny' },
          ],
        },
      },
    ];

    const receipts = extractToolReceipts(events);
    const denials = extractPolicyDenials(receipts);

    expect(denials).toHaveLength(1);

    const intersection = denials[0].scopeIntersection;
    expect(intersection.requested).toHaveLength(2);
    expect(intersection.allowed).toHaveLength(1);
    expect(intersection.enforced).toHaveLength(2);

    expect(intersection.requested[0].pattern).toBe('.env');
    expect(intersection.allowed[0].pattern).toBe('src/**');
    expect(intersection.enforced[0].pattern).toBe('.env');
    expect(intersection.enforced[1].pattern).toBe('.aws/**');
  });
});
