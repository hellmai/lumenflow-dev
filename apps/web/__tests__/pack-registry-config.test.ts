import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------
 * Tests for pack-registry-config.ts adapter selection.
 *
 * Verifies that:
 * - When BLOB_READ_WRITE_TOKEN is set, Vercel Blob adapters are used
 * - When BLOB_READ_WRITE_TOKEN is not set, in-memory adapters are used
 * - Singleton instances are returned consistently
 * ------------------------------------------------------------------ */

// Mock @vercel/blob to avoid real API calls
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  list: vi.fn().mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false }),
}));

describe('pack-registry-config adapter selection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getRegistryStore', () => {
    it('returns InMemoryPackRegistryStore when BLOB_READ_WRITE_TOKEN is not set', async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const { getRegistryStore } = await import('../src/server/pack-registry-config');
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');

      const store = getRegistryStore();

      expect(store).toBeInstanceOf(InMemoryPackRegistryStore);
    });

    it('returns VercelBlobPackRegistryStore when BLOB_READ_WRITE_TOKEN is set', async () => {
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';

      const { getRegistryStore } = await import('../src/server/pack-registry-config');
      const { VercelBlobPackRegistryStore } =
        await import('../src/server/pack-registry-store-vercel-blob');

      const store = getRegistryStore();

      expect(store).toBeInstanceOf(VercelBlobPackRegistryStore);
    });

    it('returns the same singleton instance on repeated calls', async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const { getRegistryStore } = await import('../src/server/pack-registry-config');

      const store1 = getRegistryStore();
      const store2 = getRegistryStore();

      expect(store1).toBe(store2);
    });
  });

  describe('getBlobStore', () => {
    it('returns InMemoryBlobStore when BLOB_READ_WRITE_TOKEN is not set', async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const { getBlobStore } = await import('../src/server/pack-registry-config');

      const store = getBlobStore();

      // InMemoryBlobStore is a private class, so we check by behavior
      // It should have an upload method
      expect(typeof store.upload).toBe('function');
    });

    it('returns VercelBlobPackBlobStore when BLOB_READ_WRITE_TOKEN is set', async () => {
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';

      const { getBlobStore } = await import('../src/server/pack-registry-config');
      const { VercelBlobPackBlobStore } =
        await import('../src/server/pack-registry-store-vercel-blob');

      const store = getBlobStore();

      expect(store).toBeInstanceOf(VercelBlobPackBlobStore);
    });

    it('returns the same singleton instance on repeated calls', async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const { getBlobStore } = await import('../src/server/pack-registry-config');

      const store1 = getBlobStore();
      const store2 = getBlobStore();

      expect(store1).toBe(store2);
    });
  });
});
