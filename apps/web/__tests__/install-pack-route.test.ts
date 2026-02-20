import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PackRegistryStore,
  PackRegistryEntry,
  PackVersion,
} from '../src/lib/pack-registry-types';

/**
 * Tests for POST /api/registry/packs/:id/install route adapter (WU-1878).
 *
 * AC1: POST endpoint accepts workspaceRoot and version, calls installPackFromRegistry()
 * AC4: Success/error feedback shown after install attempt (API response shape)
 */

/* ------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

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
  owner: 'testuser',
  latestVersion: '1.0.0',
  versions: [FIXTURE_VERSION],
  createdAt: '2026-02-18T00:00:00Z',
  updatedAt: '2026-02-18T00:00:00Z',
};

/* ------------------------------------------------------------------
 * Mock factories
 * ------------------------------------------------------------------ */

function createMockRegistryStore(overrides: Partial<PackRegistryStore> = {}): PackRegistryStore {
  return {
    listPacks: vi.fn().mockResolvedValue([FIXTURE_PACK]),
    getPackById: vi.fn().mockResolvedValue(FIXTURE_PACK),
    upsertPackVersion: vi.fn().mockResolvedValue(FIXTURE_PACK),
    ...overrides,
  };
}

/* ------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------ */

describe('createInstallPackRoute', () => {
  let registryStore: PackRegistryStore;
  let mockInstallFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registryStore = createMockRegistryStore();
    mockInstallFn = vi.fn().mockResolvedValue({
      success: true,
      integrity: 'sha256:abc123',
    });
  });

  it('returns 200 with success on valid install request', async () => {
    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
        version: '1.0.0',
      }),
    });

    const response = await handler(request, 'software-delivery');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.integrity).toBe('sha256:abc123');
  });

  it('calls installFn with correct parameters', async () => {
    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
        version: '1.0.0',
      }),
    });

    await handler(request, 'software-delivery');

    expect(mockInstallFn).toHaveBeenCalledWith({
      workspaceRoot: './test-workspace',
      packId: 'software-delivery',
      version: '1.0.0',
      registryUrl: expect.any(String),
      integrity: 'sha256:abc123',
      fetchFn: expect.any(Function),
    });
  });

  it('returns 400 when workspaceRoot is missing', async () => {
    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.0.0' }),
    });

    const response = await handler(request, 'software-delivery');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('workspaceRoot');
  });

  it('returns 404 when pack is not found', async () => {
    const notFoundStore = createMockRegistryStore({
      getPackById: vi.fn().mockResolvedValue(null),
    });

    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore: notFoundStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/nonexistent/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
        version: '1.0.0',
      }),
    });

    const response = await handler(request, 'nonexistent');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('returns 404 when requested version is not found', async () => {
    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
        version: '99.99.99',
      }),
    });

    const response = await handler(request, 'software-delivery');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Version not found');
  });

  it('defaults to latestVersion when version is omitted', async () => {
    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: mockInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
      }),
    });

    await handler(request, 'software-delivery');

    expect(mockInstallFn).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '1.0.0',
      }),
    );
  });

  it('returns 500 when installFn fails', async () => {
    const failingInstallFn = vi.fn().mockResolvedValue({
      success: false,
      error: 'workspace.yaml not found',
    });

    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: failingInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
        version: '1.0.0',
      }),
    });

    const response = await handler(request, 'software-delivery');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain('workspace.yaml not found');
  });

  it('returns 500 on unexpected exception', async () => {
    const throwingInstallFn = vi.fn().mockRejectedValue(new Error('Unexpected crash'));

    const { createInstallPackRoute } = await import('../src/server/pack-registry-route-adapters');

    const handler = createInstallPackRoute({
      registryStore,
      installFn: throwingInstallFn,
    });

    const request = new Request('http://localhost/api/registry/packs/software-delivery/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: './test-workspace',
        version: '1.0.0',
      }),
    });

    const response = await handler(request, 'software-delivery');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
  });
});
