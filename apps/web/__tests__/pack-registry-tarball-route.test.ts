import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PackRegistryStore,
  PackRegistryEntry,
  PackVersion,
  PackBlobStore,
} from '../src/lib/pack-registry-types';

/* ------------------------------------------------------------------
 * Tests for the tarball download route adapter.
 *
 * Verifies that:
 * - Returns 200 with tarball redirect for existing pack version
 * - Returns 404 for non-existent pack
 * - Returns 404 for non-existent version
 * ------------------------------------------------------------------ */

// --- Fixtures ---

const FIXTURE_VERSION: PackVersion = {
  version: '1.0.0',
  integrity: 'sha256:abc123',
  publishedAt: '2026-02-18T00:00:00Z',
  publishedBy: 'testuser',
  blobUrl: 'https://blob.vercel-storage.com/packs/test-pack/1.0.0.tgz',
};

const FIXTURE_PACK: PackRegistryEntry = {
  id: 'test-pack',
  description: 'A test pack',
  owner: 'testuser',
  latestVersion: '1.0.0',
  versions: [FIXTURE_VERSION],
  createdAt: '2026-02-18T00:00:00Z',
  updatedAt: '2026-02-18T00:00:00Z',
};

// --- Mock factories ---

function createMockRegistryStore(overrides: Partial<PackRegistryStore> = {}): PackRegistryStore {
  return {
    listPacks: vi.fn().mockResolvedValue([FIXTURE_PACK]),
    getPackById: vi.fn().mockResolvedValue(FIXTURE_PACK),
    upsertPackVersion: vi.fn().mockResolvedValue(FIXTURE_PACK),
    ...overrides,
  };
}

describe('createGetTarballRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns redirect to blobUrl for existing pack version', async () => {
    const registryStore = createMockRegistryStore();

    const { createGetTarballRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createGetTarballRoute({ registryStore });
    const response = await handler('test-pack', '1.0.0');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(FIXTURE_VERSION.blobUrl);
  });

  it('returns 404 when pack does not exist', async () => {
    const registryStore = createMockRegistryStore({
      getPackById: vi.fn().mockResolvedValue(null),
    });

    const { createGetTarballRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createGetTarballRoute({ registryStore });
    const response = await handler('nonexistent', '1.0.0');

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns 404 when version does not exist', async () => {
    const registryStore = createMockRegistryStore();

    const { createGetTarballRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createGetTarballRoute({ registryStore });
    const response = await handler('test-pack', '99.0.0');

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('99.0.0');
  });

  it('returns 500 on internal error', async () => {
    const registryStore = createMockRegistryStore({
      getPackById: vi.fn().mockRejectedValue(new Error('Store failure')),
    });

    const { createGetTarballRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createGetTarballRoute({ registryStore });
    const response = await handler('test-pack', '1.0.0');

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
