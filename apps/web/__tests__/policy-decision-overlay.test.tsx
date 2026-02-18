// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/* ------------------------------------------------------------------
 * WU-1834: Policy decision overlay tests
 *
 * AC1: Denied tool executions show policy_id and reason
 * AC2: Scope intersection visualized (requested vs allowed vs enforced)
 * AC3: Visual diff of attempted vs permitted actions
 * ------------------------------------------------------------------ */

// --- Types for test fixtures ---

import type {
  PolicyDenialView,
  ScopeIntersectionView,
  ActionDiffEntry,
} from '../src/lib/dashboard-types';

// --- Fixtures ---

const DENIAL_FIXTURE: PolicyDenialView = {
  receiptId: 'rcpt-denied-1',
  toolName: 'fs.write',
  policyId: 'workspace-no-secrets',
  reason: 'Write to .env blocked by workspace secret-deny policy',
  timestamp: '2026-02-18T14:30:00.000Z',
  scopeIntersection: {
    requested: [
      { type: 'path', pattern: '.env', access: 'write' },
      { type: 'path', pattern: 'src/**', access: 'write' },
    ],
    allowed: [{ type: 'path', pattern: 'src/**', access: 'write' }],
    enforced: [
      { type: 'path', pattern: '.env', access: 'deny' },
      { type: 'path', pattern: '.aws/**', access: 'deny' },
    ],
  },
  actionDiff: [
    {
      field: 'path',
      attempted: '.env',
      permitted: null,
      status: 'denied',
    },
    {
      field: 'path',
      attempted: 'src/index.ts',
      permitted: 'src/index.ts',
      status: 'allowed',
    },
    {
      field: 'access',
      attempted: 'write',
      permitted: 'read',
      status: 'narrowed',
    },
  ],
};

const DENIAL_NO_SCOPE: PolicyDenialView = {
  receiptId: 'rcpt-denied-2',
  toolName: 'git.push',
  policyId: 'lane-lock',
  reason: 'Push to main blocked by lane lock policy',
  timestamp: '2026-02-18T14:31:00.000Z',
  scopeIntersection: {
    requested: [],
    allowed: [],
    enforced: [],
  },
  actionDiff: [],
};

// --- AC1: Denied tool executions show policy_id and reason ---

describe('PolicyDecisionOverlay', () => {
  it('renders policy_id and denial reason prominently', async () => {
    const { PolicyDecisionOverlay } = await import('../src/components/policy-decision-overlay');

    render(<PolicyDecisionOverlay denial={DENIAL_FIXTURE} />);

    const overlay = screen.getByTestId('policy-decision-overlay');
    expect(overlay).toBeDefined();

    // Policy ID should be visible
    expect(screen.getByTestId('denial-policy-id')).toBeDefined();
    expect(screen.getByTestId('denial-policy-id').textContent).toContain('workspace-no-secrets');

    // Reason should be visible
    expect(screen.getByTestId('denial-reason')).toBeDefined();
    expect(screen.getByTestId('denial-reason').textContent).toContain(
      'Write to .env blocked by workspace secret-deny policy',
    );
  });

  it('renders tool name and timestamp', async () => {
    const { PolicyDecisionOverlay } = await import('../src/components/policy-decision-overlay');

    render(<PolicyDecisionOverlay denial={DENIAL_FIXTURE} />);

    expect(screen.getByText('fs.write')).toBeDefined();
    expect(screen.getByText(/14:30:00/)).toBeDefined();
  });

  it('renders denied badge with visual indicator', async () => {
    const { PolicyDecisionOverlay } = await import('../src/components/policy-decision-overlay');

    render(<PolicyDecisionOverlay denial={DENIAL_FIXTURE} />);

    const badge = screen.getByTestId('denial-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain('denied');
  });

  it('renders receipt ID for traceability', async () => {
    const { PolicyDecisionOverlay } = await import('../src/components/policy-decision-overlay');

    render(<PolicyDecisionOverlay denial={DENIAL_FIXTURE} />);

    expect(screen.getByText(/rcpt-denied-1/)).toBeDefined();
  });
});

// --- AC2: Scope intersection visualized ---

describe('ScopeIntersectionDiagram', () => {
  it('renders three columns: requested, allowed, enforced', async () => {
    const { ScopeIntersectionDiagram } =
      await import('../src/components/scope-intersection-diagram');

    render(<ScopeIntersectionDiagram intersection={DENIAL_FIXTURE.scopeIntersection} />);

    const diagram = screen.getByTestId('scope-intersection-diagram');
    expect(diagram).toBeDefined();

    // Three section headers
    expect(screen.getByTestId('scope-column-requested')).toBeDefined();
    expect(screen.getByTestId('scope-column-allowed')).toBeDefined();
    expect(screen.getByTestId('scope-column-enforced')).toBeDefined();
  });

  it('renders requested scopes with type, pattern, and access', async () => {
    const { ScopeIntersectionDiagram } =
      await import('../src/components/scope-intersection-diagram');

    render(<ScopeIntersectionDiagram intersection={DENIAL_FIXTURE.scopeIntersection} />);

    const requestedColumn = screen.getByTestId('scope-column-requested');
    const scopeItems = within(requestedColumn).getAllByTestId(/^scope-item-/);
    expect(scopeItems.length).toBe(2);

    // First requested scope: .env write
    expect(within(requestedColumn).getByText('.env')).toBeDefined();
    expect(within(requestedColumn).getByText('src/**')).toBeDefined();
  });

  it('renders allowed scopes', async () => {
    const { ScopeIntersectionDiagram } =
      await import('../src/components/scope-intersection-diagram');

    render(<ScopeIntersectionDiagram intersection={DENIAL_FIXTURE.scopeIntersection} />);

    const allowedColumn = screen.getByTestId('scope-column-allowed');
    const scopeItems = within(allowedColumn).getAllByTestId(/^scope-item-/);
    expect(scopeItems.length).toBe(1);
    expect(within(allowedColumn).getByText('src/**')).toBeDefined();
  });

  it('renders enforced (deny) scopes with deny styling', async () => {
    const { ScopeIntersectionDiagram } =
      await import('../src/components/scope-intersection-diagram');

    render(<ScopeIntersectionDiagram intersection={DENIAL_FIXTURE.scopeIntersection} />);

    const enforcedColumn = screen.getByTestId('scope-column-enforced');
    const scopeItems = within(enforcedColumn).getAllByTestId(/^scope-item-/);
    expect(scopeItems.length).toBe(2);
    expect(within(enforcedColumn).getByText('.env')).toBeDefined();
    expect(within(enforcedColumn).getByText('.aws/**')).toBeDefined();
  });

  it('renders empty state when no scopes in any column', async () => {
    const { ScopeIntersectionDiagram } =
      await import('../src/components/scope-intersection-diagram');

    render(<ScopeIntersectionDiagram intersection={DENIAL_NO_SCOPE.scopeIntersection} />);

    expect(screen.getByTestId('scope-intersection-empty')).toBeDefined();
  });
});

// --- AC3: Visual diff of attempted vs permitted actions ---

describe('ActionDiffViewer', () => {
  it('renders each diff entry with field name, attempted, and permitted values', async () => {
    const { ActionDiffViewer } = await import('../src/components/action-diff-viewer');

    render(<ActionDiffViewer entries={DENIAL_FIXTURE.actionDiff} />);

    const viewer = screen.getByTestId('action-diff-viewer');
    expect(viewer).toBeDefined();

    const rows = screen.getAllByTestId(/^action-diff-row-/);
    expect(rows.length).toBe(3);
  });

  it('shows denied entries with red styling and null permitted value', async () => {
    const { ActionDiffViewer } = await import('../src/components/action-diff-viewer');

    render(<ActionDiffViewer entries={DENIAL_FIXTURE.actionDiff} />);

    const deniedRow = screen.getByTestId('action-diff-row-0');
    expect(deniedRow.getAttribute('data-status')).toBe('denied');

    // Attempted value shown
    expect(within(deniedRow).getByText('.env')).toBeDefined();
    // Permitted is null, should show a "blocked" indicator
    expect(within(deniedRow).getByTestId('permitted-blocked')).toBeDefined();
  });

  it('shows allowed entries with green styling', async () => {
    const { ActionDiffViewer } = await import('../src/components/action-diff-viewer');

    render(<ActionDiffViewer entries={DENIAL_FIXTURE.actionDiff} />);

    const allowedRow = screen.getByTestId('action-diff-row-1');
    expect(allowedRow.getAttribute('data-status')).toBe('allowed');

    // Both attempted and permitted show 'src/index.ts' for allowed entries
    const attemptedValue = within(allowedRow).getByTestId('attempted-value');
    expect(attemptedValue.textContent).toBe('src/index.ts');
  });

  it('shows narrowed entries with amber styling and both values', async () => {
    const { ActionDiffViewer } = await import('../src/components/action-diff-viewer');

    render(<ActionDiffViewer entries={DENIAL_FIXTURE.actionDiff} />);

    const narrowedRow = screen.getByTestId('action-diff-row-2');
    expect(narrowedRow.getAttribute('data-status')).toBe('narrowed');

    // Both attempted and permitted should be visible
    expect(within(narrowedRow).getByTestId('attempted-value')).toBeDefined();
    expect(within(narrowedRow).getByTestId('permitted-value')).toBeDefined();
  });

  it('renders empty state when no diff entries', async () => {
    const { ActionDiffViewer } = await import('../src/components/action-diff-viewer');

    render(<ActionDiffViewer entries={[]} />);

    expect(screen.getByTestId('action-diff-empty')).toBeDefined();
  });
});

// --- Integration: Full overlay with all three sections ---

describe('PolicyDecisionOverlay integration', () => {
  it('includes scope intersection and action diff sections', async () => {
    const { PolicyDecisionOverlay } = await import('../src/components/policy-decision-overlay');

    render(<PolicyDecisionOverlay denial={DENIAL_FIXTURE} />);

    // All three sections should be present
    expect(screen.getByTestId('policy-decision-overlay')).toBeDefined();
    expect(screen.getByTestId('scope-intersection-diagram')).toBeDefined();
    expect(screen.getByTestId('action-diff-viewer')).toBeDefined();
  });

  it('hides scope intersection when empty', async () => {
    const { PolicyDecisionOverlay } = await import('../src/components/policy-decision-overlay');

    render(<PolicyDecisionOverlay denial={DENIAL_NO_SCOPE} />);

    expect(screen.getByTestId('policy-decision-overlay')).toBeDefined();
    // With no scopes, should show empty state
    expect(screen.getByTestId('scope-intersection-empty')).toBeDefined();
    // With no action diff, should show empty state
    expect(screen.getByTestId('action-diff-empty')).toBeDefined();
  });
});
