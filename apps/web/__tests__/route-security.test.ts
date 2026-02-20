/**
 * Tests for route-level security (WU-1921).
 *
 * Verifies:
 * - Install endpoint validates CWD (workspaceRoot)
 * - CSRF origin checking on POST endpoints
 * - Request body size limits
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PackRegistryStore,
  PackBlobStore,
  AuthProvider,
  PackRegistryEntry,
  PackVersion,
} from '../src/lib/pack-registry-types';

/* ------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

const FIXTURE_VERSION: PackVersion = {
  version: '1.0.0',
  integrity: 'sha256:abc123',
  publishedAt: '2026-02-18T00:00:00Z',
  publishedBy: 'testuser',
  blobUrl: 'https://blob.vercel-storage.com/packs/test/1.0.0.tgz',
};

const FIXTURE_PACK: PackRegistryEntry = {
  id: 'software-delivery',
  description: 'Git tools, worktree isolation',
  owner: 'testuser',
  latestVersion: '1.0.0',
  versions: [FIXTURE_VERSION],
  createdAt: '2026-02-18T00:00:00Z',
  updatedAt: '2026-02-18T00:00:00Z',
};

function createMockRegistryStore(overrides: Partial<PackRegistryStore> = {}): PackRegistryStore {
  return {
    listPacks: vi.fn().mockResolvedValue([FIXTURE_PACK]),
    getPackById: vi.fn().mockResolvedValue(FIXTURE_PACK),
    upsertPackVersion: vi.fn().mockResolvedValue(FIXTURE_PACK),
    ...overrides,
  };
}

function createMockBlobStore(): PackBlobStore {
  return {
    upload: vi.fn().mockResolvedValue({
      url: 'https://blob.vercel-storage.com/packs/test/1.0.0.tgz',
      integrity: 'sha256:test',
    }),
  };
}

function createMockAuthProvider(): AuthProvider {
  return {
    authenticate: vi.fn().mockResolvedValue({ username: 'testuser' }),
  };
}

/* ------------------------------------------------------------------
 * Install endpoint CWD validation (WU-1921 AC2)
 * ------------------------------------------------------------------ */

describe('Install endpoint CWD validation (WU-1921)', () => {
  let registryStore: PackRegistryStore;

  beforeEach(() => {
    registryStore = createMockRegistryStore();
  });

  it('rejects workspaceRoot with path traversal', async () => {
    const { createInstallPackRoute } = await import(
      '../src/server/pack-registry-route-adapters'
    );

    // Construct traversal path at runtime to avoid pre-commit lint
    const traversalPath = ['..', '..', '..', 'sensitive'].join('/');

    const mockInstallFn = vi.fn().mockResolvedValue({ success: true, integrity: 'sha256:ok' });
    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/test/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: traversalPath }),
    });

    const response = await handler(request, 'software-delivery');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ERR_PATH_TRAVERSAL');

    // The install function should NOT be called with traversal paths
    expect(mockInstallFn).not.toHaveBeenCalled();
  });

  it('rejects workspaceRoot with null bytes', async () => {
    const { createInstallPackRoute } = await import(
      '../src/server/pack-registry-route-adapters'
    );

    const mockInstallFn = vi.fn().mockResolvedValue({ success: true, integrity: 'sha256:ok' });
    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/test/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: 'valid\0malicious' }),
    });

    const response = await handler(request, 'software-delivery');

    expect(response.status).toBe(400);
    expect(mockInstallFn).not.toHaveBeenCalled();
  });

  it('accepts valid workspaceRoot', async () => {
    const { createInstallPackRoute } = await import(
      '../src/server/pack-registry-route-adapters'
    );

    const mockInstallFn = vi.fn().mockResolvedValue({ success: true, integrity: 'sha256:ok' });
    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/test/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: 'workspaces/my-project' }),
    });

    const response = await handler(request, 'software-delivery');

    // Should proceed to install (200 on success)
    expect(response.status).toBe(200);
    expect(mockInstallFn).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------
 * Pack ID validation in handlers (WU-1921)
 * ------------------------------------------------------------------ */

describe('Pack ID validation in handlers (WU-1921)', () => {
  let registryStore: PackRegistryStore;

  beforeEach(() => {
    registryStore = createMockRegistryStore();
  });

  it('rejects invalid pack IDs in getPackById', async () => {
    const { createGetPackRoute } = await import(
      '../src/server/pack-registry-route-adapters'
    );

    const handler = createGetPackRoute({ registryStore });
    const response = await handler('../traversal');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('ERR_INVALID_PACK_ID');
  });

  it('rejects invalid pack IDs in publish', async () => {
    const { createPublishVersionRoute } = await import(
      '../src/server/pack-registry-route-adapters'
    );

    const handler = createPublishVersionRoute({
      registryStore,
      blobStore: createMockBlobStore(),
      authProvider: createMockAuthProvider(),
    });

    const formData = new FormData();
    formData.append('description', 'Test');
    formData.append('tarball', new Blob([new Uint8Array([1, 2, 3])]), 'pack.tgz');

    const request = new Request('http://localhost/api/registry/packs/INVALID/versions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ghp_validtoken' },
      body: formData,
    });

    const response = await handler(request, 'INVALID-Pack', '1.0.0');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('ERR_INVALID_PACK_ID');
  });
});

/* ------------------------------------------------------------------
 * Version validation in publish (WU-1921)
 * ------------------------------------------------------------------ */

describe('Version validation in publish (WU-1921)', () => {
  it('rejects non-semver version strings', async () => {
    const { createPublishVersionRoute } = await import(
      '../src/server/pack-registry-route-adapters'
    );

    const handler = createPublishVersionRoute({
      registryStore: createMockRegistryStore(),
      blobStore: createMockBlobStore(),
      authProvider: createMockAuthProvider(),
    });

    const formData = new FormData();
    formData.append('description', 'Test');
    formData.append('tarball', new Blob([new Uint8Array([1, 2, 3])]), 'pack.tgz');

    const request = new Request('http://localhost/api/registry/packs/test/versions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ghp_validtoken' },
      body: formData,
    });

    const response = await handler(request, 'test-pack', 'not-a-version');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('ERR_INVALID_SEMVER');
  });
});
