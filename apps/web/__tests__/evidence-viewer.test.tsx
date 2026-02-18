// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EvidenceViewer } from '../src/components/evidence-viewer';
import type { TimelineEntry } from '../src/components/evidence-viewer';

const SUCCESS_ENTRY: TimelineEntry = {
  receiptId: 'receipt-001',
  toolName: 'git:status',
  startedAt: '2026-02-18T10:00:00.000Z',
  finishedAt: '2026-02-18T10:00:01.500Z',
  durationMs: 1500,
  result: 'success',
  scopeRequested: [{ type: 'path', pattern: '**', access: 'read' }],
  scopeEnforced: [{ type: 'path', pattern: 'src/**', access: 'read' }],
  policyDecisions: [{ policyId: 'default', decision: 'allow', reason: 'No restrictions.' }],
};

const DENIED_ENTRY: TimelineEntry = {
  receiptId: 'receipt-002',
  toolName: 'file:write',
  startedAt: '2026-02-18T10:01:00.000Z',
  finishedAt: '2026-02-18T10:01:00.200Z',
  durationMs: 200,
  result: 'denied',
  scopeRequested: [{ type: 'path', pattern: '/etc/**', access: 'write' }],
  scopeEnforced: [],
  policyDecisions: [
    {
      policyId: 'workspace-deny',
      decision: 'deny',
      reason: 'Write to /etc is forbidden.',
    },
  ],
};

const CRASHED_ENTRY: TimelineEntry = {
  receiptId: 'receipt-orphan',
  toolName: 'file:write',
  startedAt: '2026-02-18T10:02:00.000Z',
  result: 'crashed',
  scopeRequested: [{ type: 'path', pattern: 'src/**', access: 'write' }],
  scopeEnforced: [{ type: 'path', pattern: 'src/**', access: 'write' }],
  policyDecisions: [],
};

describe('EvidenceViewer', () => {
  it('renders empty state when no timeline entries', () => {
    render(<EvidenceViewer timeline={[]} />);
    expect(screen.getByTestId('evidence-viewer-empty')).toBeDefined();
    expect(screen.getByText(/no tool traces/i)).toBeDefined();
  });

  it('renders timeline rows with tool name and duration', () => {
    render(<EvidenceViewer timeline={[SUCCESS_ENTRY]} />);

    const row = screen.getByTestId('timeline-row-receipt-001');
    expect(row).toBeDefined();
    expect(within(row).getByText('git:status')).toBeDefined();
    expect(within(row).getByText('1500ms')).toBeDefined();
  });

  it('renders success badge for successful tool calls', () => {
    render(<EvidenceViewer timeline={[SUCCESS_ENTRY]} />);

    const badge = screen.getByTestId('result-badge-receipt-001');
    expect(badge.textContent).toBe('success');
  });

  it('renders denied badge for denied tool calls', () => {
    render(<EvidenceViewer timeline={[DENIED_ENTRY]} />);

    const badge = screen.getByTestId('result-badge-receipt-002');
    expect(badge.textContent).toBe('denied');
  });

  it('renders crashed badge for orphaned starts', () => {
    render(<EvidenceViewer timeline={[CRASHED_ENTRY]} />);

    const badge = screen.getByTestId('result-badge-receipt-orphan');
    expect(badge.textContent).toBe('crashed');
  });

  it('displays scope-requested and scope-enforced columns', () => {
    render(<EvidenceViewer timeline={[SUCCESS_ENTRY]} />);

    const row = screen.getByTestId('timeline-row-receipt-001');
    const scopeRequested = within(row).getByTestId('scope-requested-receipt-001');
    const scopeEnforced = within(row).getByTestId('scope-enforced-receipt-001');

    expect(scopeRequested.textContent).toContain('**');
    expect(scopeEnforced.textContent).toContain('src/**');
  });

  it('renders multiple timeline entries in order', () => {
    render(<EvidenceViewer timeline={[SUCCESS_ENTRY, DENIED_ENTRY, CRASHED_ENTRY]} />);

    const rows = screen.getAllByTestId(/^timeline-row-/);
    expect(rows).toHaveLength(3);
  });

  it('shows duration as N/A for orphaned entries without finish time', () => {
    render(<EvidenceViewer timeline={[CRASHED_ENTRY]} />);

    const row = screen.getByTestId('timeline-row-receipt-orphan');
    expect(within(row).getByText('N/A')).toBeDefined();
  });
});
