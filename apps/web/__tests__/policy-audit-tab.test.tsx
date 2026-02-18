// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PolicyAuditTab } from '../src/components/policy-audit-tab';
import type { PolicyDecisionView } from '../src/lib/dashboard-types';

const ALLOW_DECISION: PolicyDecisionView = {
  policyId: 'workspace-default',
  decision: 'allow',
  reason: 'No restrictions apply.',
};

const DENY_DECISION: PolicyDecisionView = {
  policyId: 'workspace-deny-etc',
  decision: 'deny',
  reason: 'Write access to /etc is forbidden.',
};

describe('PolicyAuditTab', () => {
  it('renders empty state when no policy decisions', () => {
    render(<PolicyAuditTab decisions={[]} />);
    expect(screen.getByTestId('policy-audit-empty')).toBeDefined();
    expect(screen.getByText(/no policy decisions/i)).toBeDefined();
  });

  it('renders policy decision rows with id, decision, and reason', () => {
    render(<PolicyAuditTab decisions={[ALLOW_DECISION, DENY_DECISION]} />);

    const rows = screen.getAllByTestId(/^policy-decision-row-/);
    expect(rows).toHaveLength(2);

    const allowRow = screen.getByTestId('policy-decision-row-workspace-default');
    expect(within(allowRow).getByText('workspace-default')).toBeDefined();
    expect(within(allowRow).getByText('allow')).toBeDefined();
    expect(within(allowRow).getByText('No restrictions apply.')).toBeDefined();

    const denyRow = screen.getByTestId('policy-decision-row-workspace-deny-etc');
    expect(within(denyRow).getByText('deny')).toBeDefined();
  });

  it('applies appropriate color to allow decisions', () => {
    render(<PolicyAuditTab decisions={[ALLOW_DECISION]} />);

    const badge = screen.getByTestId('policy-badge-workspace-default');
    expect(badge.className).toContain('green');
  });

  it('applies appropriate color to deny decisions', () => {
    render(<PolicyAuditTab decisions={[DENY_DECISION]} />);

    const badge = screen.getByTestId('policy-badge-workspace-deny-etc');
    expect(badge.className).toContain('red');
  });
});
