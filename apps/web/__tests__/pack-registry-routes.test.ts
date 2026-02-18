import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PackRegistryStore,
  PackBlobStore,
  AuthProvider,
  PackRegistryEntry,
  PackVersion,
} from '../src/lib/pack-registry-types';

/* ------------------------------------------------------------------
 * Route-level tests for the pack registry API.
 *
 * These test the route adapter functions that wrap handlers into
 * Next.js-compatible GET/POST exports.
 * ------------------------------------------------------------------ */

// --- Fixtures ---

const FIXTURE_VERSION: PackVersion = {
  version: '1.0.0',
  integrity: 'sha256:abc123',
  publishedAt: '2026-02-18T00:00:00Z',
  publishedBy: 'testuser',
  blobUrl: 'https://blob.vercel-storage.com/packs/software-delivery/1.0.0.tgz',
};

const FIXTURE_PACK: PackRegistryEntry = {
  id: 'software-delivery',
  description: 'Git tools, worktree isolation, quality gates',
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

function createMockBlobStore(overrides: Partial<PackBlobStore> = {}): PackBlobStore {
  return {
    upload: vi.fn().mockResolvedValue({
      url: 'https://blob.vercel-storage.com/packs/test/1.0.0.tgz',
      integrity: 'sha256:test',
    }),
    ...overrides,
  };
}

function createMockAuthProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    authenticate: vi.fn().mockResolvedValue({ username: 'testuser' }),
    ...overrides,
  };
}

describe('Pack Registry Route Adapters', () => {
  let registryStore: PackRegistryStore;
  let blobStore: PackBlobStore;
  let authProvider: AuthProvider;

  beforeEach(() => {
    registryStore = createMockRegistryStore();
    blobStore = createMockBlobStore();
    authProvider = createMockAuthProvider();
  });

  describe('createListPacksRoute', () => {
    it('returns 200 with pack list as JSON', async () => {
      const { createListPacksRoute } = await import('../src/server/pack-registry-route-adapters');

      const handler = createListPacksRoute({ registryStore });
      const request = new Request('http://localhost/api/registry/packs');
      const response = await handler(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.packs).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it('passes search query from URL parameter', async () => {
      const { createListPacksRoute } = await import('../src/server/pack-registry-route-adapters');

      const handler = createListPacksRoute({ registryStore });
      const request = new Request('http://localhost/api/registry/packs?q=delivery');
      await handler(request);

      expect(registryStore.listPacks).toHaveBeenCalledWith('delivery');
    });

    it('returns 500 on internal error', async () => {
      const failingStore = createMockRegistryStore({
        listPacks: vi.fn().mockRejectedValue(new Error('DB down')),
      });

      const { createListPacksRoute } = await import('../src/server/pack-registry-route-adapters');

      const handler = createListPacksRoute({ registryStore: failingStore });
      const request = new Request('http://localhost/api/registry/packs');
      const response = await handler(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('createGetPackRoute', () => {
    it('returns 200 with pack metadata', async () => {
      const { createGetPackRoute } = await import('../src/server/pack-registry-route-adapters');

      const handler = createGetPackRoute({ registryStore });
      const response = await handler('software-delivery');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.pack.id).toBe('software-delivery');
    });

    it('returns 404 when pack not found', async () => {
      const notFoundStore = createMockRegistryStore({
        getPackById: vi.fn().mockResolvedValue(null),
      });

      const { createGetPackRoute } = await import('../src/server/pack-registry-route-adapters');

      const handler = createGetPackRoute({ registryStore: notFoundStore });
      const response = await handler('nonexistent');

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('createPublishVersionRoute', () => {
    it('returns 201 on successful publish', async () => {
      const { createPublishVersionRoute } =
        await import('../src/server/pack-registry-route-adapters');

      const handler = createPublishVersionRoute({
        registryStore,
        blobStore,
        authProvider,
      });

      const formData = new FormData();
      formData.append('description', 'Test pack');
      formData.append('tarball', new Blob([new Uint8Array([1, 2, 3])]), 'pack.tgz');

      const request = new Request('http://localhost/api/registry/packs/test/versions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ghp_validtoken' },
        body: formData,
      });

      const response = await handler(request, 'test', '1.0.0');

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      const { createPublishVersionRoute } =
        await import('../src/server/pack-registry-route-adapters');

      const handler = createPublishVersionRoute({
        registryStore,
        blobStore,
        authProvider,
      });

      const formData = new FormData();
      formData.append('description', 'Test');
      formData.append('tarball', new Blob([new Uint8Array([1])]), 'pack.tgz');

      const request = new Request('http://localhost/api/registry/packs/test/versions', {
        method: 'POST',
        body: formData,
      });

      const response = await handler(request, 'test', '1.0.0');

      expect(response.status).toBe(401);
    });

    it('returns 400 when tarball is missing', async () => {
      const { createPublishVersionRoute } =
        await import('../src/server/pack-registry-route-adapters');

      const handler = createPublishVersionRoute({
        registryStore,
        blobStore,
        authProvider,
      });

      const formData = new FormData();
      formData.append('description', 'Test');

      const request = new Request('http://localhost/api/registry/packs/test/versions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ghp_validtoken' },
        body: formData,
      });

      const response = await handler(request, 'test', '1.0.0');

      expect(response.status).toBe(400);
    });
  });
});
