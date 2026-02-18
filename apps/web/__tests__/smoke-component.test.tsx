// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return <span data-testid="status-badge">{status}</span>;
}

describe('React component smoke test (WU-1857)', () => {
  it('renders a component in jsdom and queries via testing-library', () => {
    render(<StatusBadge status="in_progress" />);

    const badge = screen.getByTestId('status-badge');
    expect(badge.textContent).toBe('in_progress');
  });
});
