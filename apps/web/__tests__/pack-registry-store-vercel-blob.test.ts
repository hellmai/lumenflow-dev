import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import type { PackVersion, PackRegistryEntry } from '../src/lib/pack-registry-types';

/* ------------------------------------------------------------------
 * Tests for VercelBlobPackRegistryStore and VercelBlobPackBlobStore.
 *
 * Verifies the Vercel Blob adapters implement the PackRegistryStore
 * and PackBlobStore ports correctly. Uses mocked @vercel/blob SDK.
 * ------------------------------------------------------------------ */

// --- Mock @vercel/blob ---

const mockPut = vi.fn();
const mockList = vi.fn();

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => mockPut(...args),
  list: (...args: unknown[]) => mockList(...args),
}));

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
  description: 'A test pack for unit tests',
  owner: 'testuser',
  latestVersion: '1.0.0',
  versions: [FIXTURE_VERSION],
  createdAt: '2026-02-18T00:00:00Z',
  updatedAt: '2026-02-18T00:00:00Z',
};

const REGISTRY_INDEX_PATH = 'registry/registry-index.json';

// --- Helper to create mock blob response ---

function createMockBlobResponse(
  content: string,
  url = 'https://blob.vercel-storage.com/registry/registry-index.json',
) {
  return {
    url,
    downloadUrl: url,
    pathname: REGISTRY_INDEX_PATH,
    contentType: 'application/json',
    contentDisposition: '',
  };
}

function createMockRegistryIndex(packs: PackRegistryEntry[]): string {
  return JSON.stringify({ packs });
}

/* ------------------------------------------------------------------
 * VercelBlobPackRegistryStore
 * ------------------------------------------------------------------ */

describe('VercelBlobPackRegistryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPacks', () => {
    it('returns all packs from the blob index', async () => {
      const indexContent = createMockRegistryIndex([FIXTURE_PACK]);

      // Mock list() to find existing blobs
      mockList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.vercel-storage.com/registry/registry-index.json',
            pathname: REGISTRY_INDEX_PATH,
          },
        ],
        cursor: undefined,
        hasMore: false,
      });

      // Mock fetch for downloading the index
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(indexContent, { status: 200 })));

      try {
        const { VercelBlobPackRegistryStore } =
          await import('../src/server/pack-registry-store-vercel-blob');
        const store = new VercelBlobPackRegistryStore();

        const result = await store.listPacks();

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('test-pack');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns empty array when index does not exist', async () => {
      mockList.mockResolvedValue({
        blobs: [],
        cursor: undefined,
        hasMore: false,
      });

      const { VercelBlobPackRegistryStore } =
        await import('../src/server/pack-registry-store-vercel-blob');
      const store = new VercelBlobPackRegistryStore();

      const result = await store.listPacks();

      expect(result).toHaveLength(0);
    });

    it('filters packs by query', async () => {
      const secondPack: PackRegistryEntry = {
        ...FIXTURE_PACK,
        id: 'other-pack',
        description: 'Another pack',
      };
      const indexContent = createMockRegistryIndex([FIXTURE_PACK, secondPack]);

      mockList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.vercel-storage.com/registry/registry-index.json',
            pathname: REGISTRY_INDEX_PATH,
          },
        ],
        cursor: undefined,
        hasMore: false,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(indexContent, { status: 200 })));

      try {
        const { VercelBlobPackRegistryStore } =
          await import('../src/server/pack-registry-store-vercel-blob');
        const store = new VercelBlobPackRegistryStore();

        const result = await store.listPacks('test');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('test-pack');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getPackById', () => {
    it('returns pack when found in index', async () => {
      const indexContent = createMockRegistryIndex([FIXTURE_PACK]);

      mockList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.vercel-storage.com/registry/registry-index.json',
            pathname: REGISTRY_INDEX_PATH,
          },
        ],
        cursor: undefined,
        hasMore: false,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(indexContent, { status: 200 })));

      try {
        const { VercelBlobPackRegistryStore } =
          await import('../src/server/pack-registry-store-vercel-blob');
        const store = new VercelBlobPackRegistryStore();

        const result = await store.getPackById('test-pack');

        expect(result).not.toBeNull();
        expect(result!.id).toBe('test-pack');
        expect(result!.versions).toHaveLength(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns null when pack is not found', async () => {
      const indexContent = createMockRegistryIndex([FIXTURE_PACK]);

      mockList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.vercel-storage.com/registry/registry-index.json',
            pathname: REGISTRY_INDEX_PATH,
          },
        ],
        cursor: undefined,
        hasMore: false,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(indexContent, { status: 200 })));

      try {
        const { VercelBlobPackRegistryStore } =
          await import('../src/server/pack-registry-store-vercel-blob');
        const store = new VercelBlobPackRegistryStore();

        const result = await store.getPackById('nonexistent');

        expect(result).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('upsertPackVersion', () => {
    it('creates new pack entry when pack does not exist', async () => {
      const indexContent = createMockRegistryIndex([]);

      mockList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.vercel-storage.com/registry/registry-index.json',
            pathname: REGISTRY_INDEX_PATH,
          },
        ],
        cursor: undefined,
        hasMore: false,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(indexContent, { status: 200 })));

      mockPut.mockResolvedValue(createMockBlobResponse(''));

      try {
        const { VercelBlobPackRegistryStore } =
          await import('../src/server/pack-registry-store-vercel-blob');
        const store = new VercelBlobPackRegistryStore();

        const result = await store.upsertPackVersion(
          'new-pack',
          'A brand new pack',
          FIXTURE_VERSION,
          'testuser',
        );

        expect(result.id).toBe('new-pack');
        expect(result.description).toBe('A brand new pack');
        expect(result.owner).toBe('testuser');
        expect(result.latestVersion).toBe('1.0.0');
        expect(result.versions).toHaveLength(1);

        // Verify put was called with updated index
        expect(mockPut).toHaveBeenCalledWith(
          REGISTRY_INDEX_PATH,
          expect.any(String),
          expect.objectContaining({ access: 'public', addRandomSuffix: false }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('appends version to existing pack', async () => {
      const indexContent = createMockRegistryIndex([FIXTURE_PACK]);

      mockList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.vercel-storage.com/registry/registry-index.json',
            pathname: REGISTRY_INDEX_PATH,
          },
        ],
        cursor: undefined,
        hasMore: false,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response(indexContent, { status: 200 })));

      mockPut.mockResolvedValue(createMockBlobResponse(''));

      try {
        const { VercelBlobPackRegistryStore } =
          await import('../src/server/pack-registry-store-vercel-blob');
        const store = new VercelBlobPackRegistryStore();

        const newVersion: PackVersion = {
          version: '2.0.0',
          integrity: 'sha256:def456',
          publishedAt: '2026-02-19T00:00:00Z',
          publishedBy: 'testuser',
          blobUrl: 'https://blob.vercel-storage.com/packs/test-pack/2.0.0.tgz',
        };

        const result = await store.upsertPackVersion(
          'test-pack',
          'Updated description',
          newVersion,
          'testuser',
        );

        expect(result.versions).toHaveLength(2);
        expect(result.latestVersion).toBe('2.0.0');
        expect(result.description).toBe('Updated description');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('creates index blob when it does not exist', async () => {
      mockList.mockResolvedValue({
        blobs: [],
        cursor: undefined,
        hasMore: false,
      });

      mockPut.mockResolvedValue(createMockBlobResponse(''));

      const { VercelBlobPackRegistryStore } =
        await import('../src/server/pack-registry-store-vercel-blob');
      const store = new VercelBlobPackRegistryStore();

      const result = await store.upsertPackVersion(
        'new-pack',
        'A new pack',
        FIXTURE_VERSION,
        'testuser',
      );

      expect(result.id).toBe('new-pack');
      expect(mockPut).toHaveBeenCalled();
    });
  });
});

/* ------------------------------------------------------------------
 * VercelBlobPackBlobStore
 * ------------------------------------------------------------------ */

describe('VercelBlobPackBlobStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads tarball to Vercel Blob with correct path', async () => {
    const blobUrl = 'https://blob.vercel-storage.com/packs/test-pack/1.0.0.tgz';
    mockPut.mockResolvedValue({
      url: blobUrl,
      downloadUrl: blobUrl,
      pathname: 'packs/test-pack/1.0.0.tgz',
    });

    const { VercelBlobPackBlobStore } =
      await import('../src/server/pack-registry-store-vercel-blob');
    const store = new VercelBlobPackBlobStore();

    const data = new Uint8Array([1, 2, 3, 4]);
    const result = await store.upload('test-pack', '1.0.0', data);

    expect(result.url).toBe(blobUrl);
    expect(result.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(mockPut).toHaveBeenCalledWith(
      'packs/test-pack/1.0.0.tgz',
      expect.any(Uint8Array),
      expect.objectContaining({ access: 'public', addRandomSuffix: false }),
    );
  });

  it('computes SHA-256 integrity hash', async () => {
    const blobUrl = 'https://blob.vercel-storage.com/packs/my-pack/2.0.0.tgz';
    mockPut.mockResolvedValue({
      url: blobUrl,
      downloadUrl: blobUrl,
      pathname: 'packs/my-pack/2.0.0.tgz',
    });

    const { VercelBlobPackBlobStore } =
      await import('../src/server/pack-registry-store-vercel-blob');
    const store = new VercelBlobPackBlobStore();

    const data = new Uint8Array([10, 20, 30]);
    const result = await store.upload('my-pack', '2.0.0', data);

    // Verify integrity is a valid sha256 hash
    expect(result.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Same data should produce the same hash
    const result2 = await store.upload('my-pack', '2.0.0', data);
    expect(result2.integrity).toBe(result.integrity);
  });
});
