// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteErrorBoundary } from '../src/components/route-error-boundary';

function ThrowingChild({ shouldThrow }: Readonly<{ shouldThrow: boolean }>) {
  if (shouldThrow) {
    throw new Error('Test error from child component');
  }
  return <div>Child content</div>;
}

describe('RouteErrorBoundary', () => {
  // Suppress console.error from React error boundary logs during tests
  const originalError = console.error; // eslint-disable-line no-console
  beforeEach(() => {
    console.error = vi.fn(); // eslint-disable-line no-console
  });
  afterEach(() => {
    console.error = originalError; // eslint-disable-line no-console
  });

  it('renders children when no error is thrown', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeDefined();
  });

  it('renders error fallback when a child throws', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it('displays the error message in the fallback', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/test error from child component/i)).toBeDefined();
  });

  it('provides a retry/reset button', () => {
    render(
      <RouteErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </RouteErrorBoundary>,
    );
    const retryButton = screen.getByRole('button', { name: /try again/i });
    expect(retryButton).toBeDefined();
  });

  it('uses the segment prop in the error heading when provided', () => {
    render(
      <RouteErrorBoundary segment="dashboard">
        <ThrowingChild shouldThrow={true} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/dashboard/i)).toBeDefined();
  });
});
