import { describe, expect, it } from 'vitest';
import type { PackVersion, PackRegistryEntry } from '../src/lib/pack-registry-types';

/* ------------------------------------------------------------------
 * Tests for InMemoryPackRegistryStore.
 * Verifies the store adapter correctly implements the PackRegistryStore port.
 * ------------------------------------------------------------------ */

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

describe('InMemoryPackRegistryStore', () => {
  describe('listPacks', () => {
    it('returns all packs when no query is provided', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK]);

      const result = await store.listPacks();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-pack');
    });

    it('returns empty array when store is empty', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore();

      const result = await store.listPacks();

      expect(result).toHaveLength(0);
    });

    it('filters packs by ID matching query', async () => {
      const secondPack: PackRegistryEntry = {
        ...FIXTURE_PACK,
        id: 'other-pack',
        description: 'Another pack',
      };

      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK, secondPack]);

      const result = await store.listPacks('test');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-pack');
    });

    it('filters packs by description matching query', async () => {
      const secondPack: PackRegistryEntry = {
        ...FIXTURE_PACK,
        id: 'other-pack',
        description: 'Ticket management for customer support',
      };

      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK, secondPack]);

      const result = await store.listPacks('ticket');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('other-pack');
    });

    it('search is case-insensitive', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK]);

      const result = await store.listPacks('TEST');

      expect(result).toHaveLength(1);
    });
  });

  describe('getPackById', () => {
    it('returns pack when found', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK]);

      const result = await store.getPackById('test-pack');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-pack');
      expect(result!.versions).toHaveLength(1);
    });

    it('returns null when pack is not found', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK]);

      const result = await store.getPackById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('upsertPackVersion', () => {
    it('creates new pack entry when pack does not exist', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore();

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
    });

    it('appends version to existing pack', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore([FIXTURE_PACK]);

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
    });

    it('new pack is findable via getPackById', async () => {
      const { InMemoryPackRegistryStore } =
        await import('../src/server/pack-registry-store-memory');
      const store = new InMemoryPackRegistryStore();

      await store.upsertPackVersion('new-pack', 'A new pack', FIXTURE_VERSION, 'testuser');

      const found = await store.getPackById('new-pack');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('new-pack');
    });
  });
});
