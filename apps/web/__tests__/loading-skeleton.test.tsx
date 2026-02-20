// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSkeleton } from '../src/components/loading-skeleton';

describe('LoadingSkeleton', () => {
  it('renders a loading indicator with accessible role', () => {
    const { container } = render(<LoadingSkeleton />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
  });

  it('includes screen-reader text', () => {
    render(<LoadingSkeleton />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it('renders skeleton placeholder lines', () => {
    const { container } = render(<LoadingSkeleton />);
    const skeletons = container.querySelectorAll('[data-testid="skeleton-line"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts an optional label prop for context', () => {
    render(<LoadingSkeleton label="Loading packs" />);
    expect(screen.getByText(/loading packs/i)).toBeDefined();
  });
});
