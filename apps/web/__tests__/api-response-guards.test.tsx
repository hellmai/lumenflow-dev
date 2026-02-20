// @vitest-environment jsdom
/**
 * Tests for defensive API response parsing in live client components.
 *
 * WU-1940: The /api/events/all endpoint returns { events: [], nextCursor }
 * but WorkspaceOverviewLive expected a bare array. This caused
 * "events.filter is not a function" at runtime. Similar patterns were
 * found in pack-catalog-live and marketplace-browse-live.
 *
 * These tests verify that client-side fetch handlers gracefully handle
 * both bare arrays and wrapped { field: [...] } response shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

function mockFetchResponse(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
    }),
  );
}

/* ------------------------------------------------------------------
 * WorkspaceOverviewLive: /api/events/all
 * ------------------------------------------------------------------ */

describe('WorkspaceOverviewLive API response handling', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles wrapped { events: [...] } response without crashing', async () => {
    mockFetchResponse({ events: [], nextCursor: null });

    const { WorkspaceOverviewLive } = await import('../src/components/workspace-overview-live');

    render(<WorkspaceOverviewLive />);

    // Should not show error — empty events means empty workspace
    await waitFor(() => {
      expect(screen.queryByText(/failed to load/i)).toBeNull();
    });
  });

  it('handles bare array response without crashing', async () => {
    mockFetchResponse([]);

    const { WorkspaceOverviewLive } = await import('../src/components/workspace-overview-live');

    render(<WorkspaceOverviewLive />);

    await waitFor(() => {
      expect(screen.queryByText(/failed to load/i)).toBeNull();
    });
  });

  it('handles unexpected object shape without crashing', async () => {
    mockFetchResponse({ data: 'unexpected' });

    const { WorkspaceOverviewLive } = await import('../src/components/workspace-overview-live');

    render(<WorkspaceOverviewLive />);

    // Should gracefully render (empty workspace), not throw
    await waitFor(() => {
      expect(screen.queryByText(/is not a function/i)).toBeNull();
    });
  });
});

/* ------------------------------------------------------------------
 * PackCatalogLive: /api/packs
 * ------------------------------------------------------------------ */

describe('PackCatalogLive API response handling', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles wrapped { packs: [...] } response without crashing', async () => {
    mockFetchResponse({ packs: [], total: 0 });

    const { PackCatalogLive } = await import('../src/components/pack-catalog-live');

    render(<PackCatalogLive />);

    await waitFor(() => {
      expect(screen.queryByText(/failed to load/i)).toBeNull();
    });
  });

  it('handles bare array response without crashing', async () => {
    mockFetchResponse([]);

    const { PackCatalogLive } = await import('../src/components/pack-catalog-live');

    render(<PackCatalogLive />);

    await waitFor(() => {
      expect(screen.queryByText(/failed to load/i)).toBeNull();
    });
  });

  it('handles unexpected object shape without crashing', async () => {
    mockFetchResponse({ data: 'unexpected' });

    const { PackCatalogLive } = await import('../src/components/pack-catalog-live');

    render(<PackCatalogLive />);

    await waitFor(() => {
      expect(screen.queryByText(/is not a function/i)).toBeNull();
    });
  });
});

/* ------------------------------------------------------------------
 * MarketplaceBrowseLive: /api/registry/packs
 * ------------------------------------------------------------------ */

describe('MarketplaceBrowseLive API response handling', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles { packs: [...] } response correctly', async () => {
    mockFetchResponse({ packs: [], total: 0 });

    const { MarketplaceBrowseLive } = await import('../src/components/marketplace-browse-live');

    render(<MarketplaceBrowseLive />);

    await waitFor(() => {
      expect(screen.queryByText(/failed to load/i)).toBeNull();
    });
  });

  it('handles missing packs field without crashing', async () => {
    mockFetchResponse({ total: 0 });

    const { MarketplaceBrowseLive } = await import('../src/components/marketplace-browse-live');

    render(<MarketplaceBrowseLive />);

    await waitFor(() => {
      expect(screen.queryByText(/is not a function/i)).toBeNull();
    });
  });

  it('handles null response body without crashing', async () => {
    mockFetchResponse(null);

    const { MarketplaceBrowseLive } = await import('../src/components/marketplace-browse-live');

    render(<MarketplaceBrowseLive />);

    // Should show error state, not throw
    await waitFor(() => {
      expect(screen.queryByText(/is not a function/i)).toBeNull();
    });
  });
});
