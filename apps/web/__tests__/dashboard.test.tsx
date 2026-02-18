// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import type {
  ApprovalRequestView,
  DashboardEvent,
  ToolReceiptView,
  EvidenceLink,
} from '../src/lib/dashboard-types';

/* ------------------------------------------------------------------
 * AC1: SSE client connects and displays live events
 * AC2: Task state machine rendered with visual transitions
 * AC3: Tool execution receipts show scope and policy metadata
 * AC4: Evidence chain links visible
 * AC5: Event log scrolls with timestamps
 * ------------------------------------------------------------------ */

// --- Fixtures ---

const TASK_ID = 'task-abc-123';

const FIXTURE_EVENTS: DashboardEvent[] = [
  {
    id: 'evt-1',
    kind: 'task_created',
    timestamp: '2026-02-18T10:00:00.000Z',
    taskId: TASK_ID,
    data: { spec_hash: 'abc123' },
  },
  {
    id: 'evt-2',
    kind: 'task_claimed',
    timestamp: '2026-02-18T10:01:00.000Z',
    taskId: TASK_ID,
    data: { by: 'agent-1', session_id: 'sess-1' },
  },
  {
    id: 'evt-3',
    kind: 'task_completed',
    timestamp: '2026-02-18T10:05:00.000Z',
    taskId: TASK_ID,
    data: { evidence_refs: ['ref-1'] },
  },
];

const FIXTURE_RECEIPT: ToolReceiptView = {
  receiptId: 'rcpt-1',
  toolName: 'git.commit',
  startedAt: '2026-02-18T10:02:00.000Z',
  finishedAt: '2026-02-18T10:02:05.000Z',
  durationMs: 5000,
  result: 'success',
  scopeRequested: [{ type: 'path', pattern: 'src/**', access: 'write' }],
  scopeAllowed: [{ type: 'path', pattern: 'src/**', access: 'write' }],
  policyDecisions: [
    { policyId: 'workspace-default', decision: 'allow', reason: 'Permitted by workspace policy' },
  ],
};

const FIXTURE_EVIDENCE: EvidenceLink[] = [
  {
    id: 'ev-1',
    type: 'receipt',
    label: 'git.commit receipt',
    timestamp: '2026-02-18T10:02:05.000Z',
    ref: 'rcpt-1',
  },
  {
    id: 'ev-2',
    type: 'event',
    label: 'task_completed',
    timestamp: '2026-02-18T10:05:00.000Z',
    ref: 'evt-3',
  },
];

const FIXTURE_APPROVAL_REQUEST: ApprovalRequestView = {
  receiptId: 'rcpt-approval-1',
  toolName: 'git.push',
  policyId: 'policy.approval.required',
  reason: 'Push to protected branch requires human approval',
  scopeRequested: [{ type: 'path', pattern: 'apps/web/**', access: 'write' }],
  scopeAllowed: [{ type: 'path', pattern: 'apps/web/**', access: 'write' }],
  status: 'pending',
};

// --- Tests ---

describe('TaskStateMachine component', () => {
  it('renders all lifecycle states with the current state highlighted', async () => {
    const { TaskStateMachine } = await import('../src/components/task-state-machine');

    render(<TaskStateMachine currentStatus="active" />);

    const readyNode = screen.getByTestId('state-ready');
    const activeNode = screen.getByTestId('state-active');
    const doneNode = screen.getByTestId('state-done');

    expect(readyNode).toBeDefined();
    expect(activeNode).toBeDefined();
    expect(doneNode).toBeDefined();

    // Current state should have the active indicator
    expect(activeNode.getAttribute('data-current')).toBe('true');
    expect(readyNode.getAttribute('data-current')).toBe('false');
  });

  it('marks completed states as visited', async () => {
    const { TaskStateMachine } = await import('../src/components/task-state-machine');

    render(<TaskStateMachine currentStatus="done" />);

    const readyNode = screen.getByTestId('state-ready');
    const activeNode = screen.getByTestId('state-active');
    const doneNode = screen.getByTestId('state-done');

    // ready and active are visited; done is current
    expect(readyNode.getAttribute('data-visited')).toBe('true');
    expect(activeNode.getAttribute('data-visited')).toBe('true');
    expect(doneNode.getAttribute('data-current')).toBe('true');
  });
});

describe('EventLog component', () => {
  it('renders events with timestamps and kind labels', async () => {
    const { EventLog } = await import('../src/components/event-log');

    render(<EventLog events={FIXTURE_EVENTS} />);

    const logContainer = screen.getByTestId('event-log');
    expect(logContainer).toBeDefined();

    // Each event should be rendered
    const eventItems = screen.getAllByTestId(/^event-item-/);
    expect(eventItems.length).toBe(FIXTURE_EVENTS.length);

    // Timestamps should be displayed
    expect(screen.getByText(/10:00:00/)).toBeDefined();
    expect(screen.getByText(/10:01:00/)).toBeDefined();

    // Event kinds should be displayed
    expect(screen.getByText(/task_created/)).toBeDefined();
    expect(screen.getByText(/task_claimed/)).toBeDefined();
  });

  it('renders empty state when no events exist', async () => {
    const { EventLog } = await import('../src/components/event-log');

    render(<EventLog events={[]} />);

    expect(screen.getByTestId('event-log-empty')).toBeDefined();
  });
});

describe('ToolReceipt component', () => {
  it('displays tool name, scopes, policy decisions, duration, and result', async () => {
    const { ToolReceipt } = await import('../src/components/tool-receipt');

    render(<ToolReceipt receipt={FIXTURE_RECEIPT} />);

    // Tool name
    expect(screen.getByText('git.commit')).toBeDefined();

    // Duration
    expect(screen.getByText(/5000ms/)).toBeDefined();

    // Result
    expect(screen.getByText(/success/i)).toBeDefined();

    // Scope metadata
    expect(screen.getByText(/src\/\*\*/)).toBeDefined();
    expect(screen.getByText(/write/)).toBeDefined();

    // Policy decision
    expect(screen.getByText(/workspace-default/)).toBeDefined();
    expect(screen.getByText(/allow/)).toBeDefined();
  });
});

describe('EvidenceChain component', () => {
  it('renders evidence links with labels and timestamps', async () => {
    const { EvidenceChain } = await import('../src/components/evidence-chain');

    render(<EvidenceChain links={FIXTURE_EVIDENCE} />);

    const chainContainer = screen.getByTestId('evidence-chain');
    expect(chainContainer).toBeDefined();

    // Evidence links should be visible
    expect(screen.getByText(/git.commit receipt/)).toBeDefined();
    expect(screen.getByText(/task_completed/)).toBeDefined();

    // Links should show type indicators
    const receiptLink = screen.getByTestId('evidence-link-ev-1');
    const eventLink = screen.getByTestId('evidence-link-ev-2');
    expect(receiptLink.getAttribute('data-type')).toBe('receipt');
    expect(eventLink.getAttribute('data-type')).toBe('event');
  });

  it('renders empty state when no evidence exists', async () => {
    const { EvidenceChain } = await import('../src/components/evidence-chain');

    render(<EvidenceChain links={[]} />);

    expect(screen.getByTestId('evidence-chain-empty')).toBeDefined();
  });
});

describe('TaskDashboard component', () => {
  it('composes state machine, event log, tool receipts, and evidence chain', async () => {
    const { TaskDashboard } = await import('../src/components/task-dashboard');
    const noop = vi.fn();

    render(
      <TaskDashboard
        taskId={TASK_ID}
        connectionState="connected"
        currentStatus="active"
        events={FIXTURE_EVENTS}
        toolReceipts={[FIXTURE_RECEIPT]}
        evidenceLinks={FIXTURE_EVIDENCE}
        approvalRequests={[]}
        onApprove={noop}
        onDeny={noop}
      />,
    );

    // All sections should be present
    expect(screen.getByTestId('dashboard-header')).toBeDefined();
    expect(screen.getByTestId('state-active')).toBeDefined();
    expect(screen.getByTestId('event-log')).toBeDefined();
    expect(screen.getByTestId('evidence-chain')).toBeDefined();

    // Connection indicator
    expect(screen.getByTestId('connection-status')).toBeDefined();
    expect(screen.getByText(/connected/i)).toBeDefined();
  });

  it('shows connecting state indicator', async () => {
    const { TaskDashboard } = await import('../src/components/task-dashboard');
    const noop = vi.fn();

    render(
      <TaskDashboard
        taskId={TASK_ID}
        connectionState="connecting"
        currentStatus="ready"
        events={[]}
        toolReceipts={[]}
        evidenceLinks={[]}
        approvalRequests={[]}
        onApprove={noop}
        onDeny={noop}
      />,
    );

    const connectionBadge = screen.getByTestId('connection-status');
    expect(connectionBadge.textContent).toContain('connecting');
  });

  it('renders pending approval card for approval_required decisions', async () => {
    const { TaskDashboard } = await import('../src/components/task-dashboard');
    const noop = vi.fn();

    render(
      <TaskDashboard
        taskId={TASK_ID}
        connectionState="connected"
        currentStatus="waiting"
        events={FIXTURE_EVENTS}
        toolReceipts={[FIXTURE_RECEIPT]}
        evidenceLinks={FIXTURE_EVIDENCE}
        approvalRequests={[FIXTURE_APPROVAL_REQUEST]}
        onApprove={noop}
        onDeny={noop}
      />,
    );

    expect(screen.getByText(/pending approvals/i)).toBeDefined();
    expect(screen.getByText(/git\.push/)).toBeDefined();
    expect(screen.getByText(/policy\.approval\.required/)).toBeDefined();
    expect(screen.getByRole('button', { name: /approve/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /deny/i })).toBeDefined();
  });

  it('invokes approval handlers when Approve or Deny are clicked', async () => {
    const { TaskDashboard } = await import('../src/components/task-dashboard');
    const approve = vi.fn();
    const deny = vi.fn();

    render(
      <TaskDashboard
        taskId={TASK_ID}
        connectionState="connected"
        currentStatus="waiting"
        events={FIXTURE_EVENTS}
        toolReceipts={[FIXTURE_RECEIPT]}
        evidenceLinks={FIXTURE_EVIDENCE}
        approvalRequests={[FIXTURE_APPROVAL_REQUEST]}
        onApprove={approve}
        onDeny={deny}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));

    expect(approve).toHaveBeenCalledWith(FIXTURE_APPROVAL_REQUEST.receiptId);
    expect(deny).toHaveBeenCalledWith(FIXTURE_APPROVAL_REQUEST.receiptId);
  });
});
