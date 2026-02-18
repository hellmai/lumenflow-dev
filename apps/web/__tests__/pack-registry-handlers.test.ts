import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PackRegistryStore,
  PackBlobStore,
  AuthProvider,
  PackRegistryEntry,
  PackVersion,
  PublisherIdentity,
} from '../src/lib/pack-registry-types';

/* ------------------------------------------------------------------
 * AC1: GET /api/registry/packs returns pack list with search
 * AC2: GET /api/registry/packs/:id returns pack metadata and versions
 * AC3: POST publish endpoint stores tarball and updates index
 * AC4: GitHub OAuth authentication for publishers
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

const FIXTURE_SECOND_PACK: PackRegistryEntry = {
  id: 'customer-support',
  description: 'Ticket management and PII redaction',
  latestVersion: '2.0.0',
  versions: [
    {
      version: '2.0.0',
      integrity: 'sha256:def456',
      publishedAt: '2026-02-18T01:00:00Z',
      publishedBy: 'supportdev',
      blobUrl: 'https://blob.vercel-storage.com/packs/customer-support/2.0.0.tgz',
    },
  ],
  createdAt: '2026-02-17T00:00:00Z',
  updatedAt: '2026-02-18T01:00:00Z',
};

const FIXTURE_PUBLISHER: PublisherIdentity = {
  username: 'testuser',
  avatarUrl: 'https://github.com/testuser.png',
};

// --- Mock factories ---

function createMockRegistryStore(overrides: Partial<PackRegistryStore> = {}): PackRegistryStore {
  return {
    listPacks: vi.fn().mockResolvedValue([FIXTURE_PACK, FIXTURE_SECOND_PACK]),
    getPackById: vi.fn().mockResolvedValue(FIXTURE_PACK),
    upsertPackVersion: vi.fn().mockResolvedValue(FIXTURE_PACK),
    ...overrides,
  };
}

function createMockBlobStore(overrides: Partial<PackBlobStore> = {}): PackBlobStore {
  return {
    upload: vi.fn().mockResolvedValue({
      url: 'https://blob.vercel-storage.com/packs/software-delivery/2.0.0.tgz',
      integrity: 'sha256:newversion',
    }),
    ...overrides,
  };
}

function createMockAuthProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    authenticate: vi.fn().mockResolvedValue(FIXTURE_PUBLISHER),
    ...overrides,
  };
}

// --- Tests ---

describe('Pack Registry Handlers', () => {
  let registryStore: PackRegistryStore;
  let blobStore: PackBlobStore;
  let authProvider: AuthProvider;

  beforeEach(() => {
    registryStore = createMockRegistryStore();
    blobStore = createMockBlobStore();
    authProvider = createMockAuthProvider();
  });

  describe('AC1: GET /api/registry/packs returns pack list with search', () => {
    it('returns all packs when no search query is provided', async () => {
      const { handleListPacks } = await import('../src/server/pack-registry-handlers');

      const result = await handleListPacks({ registryStore });

      expect(result.packs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(registryStore.listPacks).toHaveBeenCalledWith(undefined);
    });

    it('passes search query to the registry store', async () => {
      const { handleListPacks } = await import('../src/server/pack-registry-handlers');

      await handleListPacks({ registryStore, query: 'delivery' });

      expect(registryStore.listPacks).toHaveBeenCalledWith('delivery');
    });

    it('returns empty list when no packs match search', async () => {
      const emptyStore = createMockRegistryStore({
        listPacks: vi.fn().mockResolvedValue([]),
      });

      const { handleListPacks } = await import('../src/server/pack-registry-handlers');

      const result = await handleListPacks({
        registryStore: emptyStore,
        query: 'nonexistent',
      });

      expect(result.packs).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('AC2: GET /api/registry/packs/:id returns pack metadata and versions', () => {
    it('returns pack metadata when found', async () => {
      const { handleGetPack } = await import('../src/server/pack-registry-handlers');

      const result = await handleGetPack({
        registryStore,
        packId: 'software-delivery',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pack.id).toBe('software-delivery');
        expect(result.pack.versions).toHaveLength(1);
        expect(result.pack.latestVersion).toBe('1.0.0');
      }
    });

    it('returns error when pack is not found', async () => {
      const notFoundStore = createMockRegistryStore({
        getPackById: vi.fn().mockResolvedValue(null),
      });

      const { handleGetPack } = await import('../src/server/pack-registry-handlers');

      const result = await handleGetPack({
        registryStore: notFoundStore,
        packId: 'nonexistent',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });

    it('includes version integrity hashes in response', async () => {
      const { handleGetPack } = await import('../src/server/pack-registry-handlers');

      const result = await handleGetPack({
        registryStore,
        packId: 'software-delivery',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pack.versions[0].integrity).toBe('sha256:abc123');
      }
    });
  });

  describe('AC3: POST publish endpoint stores tarball and updates index', () => {
    it('stores tarball and updates registry index', async () => {
      const { handlePublishVersion } = await import('../src/server/pack-registry-handlers');

      const tarballData = new Uint8Array([1, 2, 3, 4]);

      const result = await handlePublishVersion({
        registryStore,
        blobStore,
        packId: 'software-delivery',
        version: '2.0.0',
        description: 'Git tools, worktree isolation, quality gates',
        tarball: tarballData,
        publisher: FIXTURE_PUBLISHER,
      });

      expect(result.success).toBe(true);
      expect(blobStore.upload).toHaveBeenCalledWith('software-delivery', '2.0.0', tarballData);
      expect(registryStore.upsertPackVersion).toHaveBeenCalled();
    });

    it('returns the new version metadata on success', async () => {
      const { handlePublishVersion } = await import('../src/server/pack-registry-handlers');

      const tarballData = new Uint8Array([1, 2, 3, 4]);

      const result = await handlePublishVersion({
        registryStore,
        blobStore,
        packId: 'software-delivery',
        version: '2.0.0',
        description: 'Updated description',
        tarball: tarballData,
        publisher: FIXTURE_PUBLISHER,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.version.version).toBe('2.0.0');
        expect(result.version.publishedBy).toBe('testuser');
        expect(result.version.integrity).toBe('sha256:newversion');
      }
    });

    it('returns error when blob upload fails', async () => {
      const failingBlobStore = createMockBlobStore({
        upload: vi.fn().mockRejectedValue(new Error('Upload failed')),
      });

      const { handlePublishVersion } = await import('../src/server/pack-registry-handlers');

      const result = await handlePublishVersion({
        registryStore,
        blobStore: failingBlobStore,
        packId: 'test-pack',
        version: '1.0.0',
        description: 'Test',
        tarball: new Uint8Array([1]),
        publisher: FIXTURE_PUBLISHER,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Upload failed');
      }
    });
  });

  describe('AC4: GitHub OAuth authentication for publishers', () => {
    it('authenticates valid bearer token and returns publisher identity', async () => {
      const { authenticatePublisher } = await import('../src/server/pack-registry-handlers');

      const result = await authenticatePublisher({
        authProvider,
        authorizationHeader: 'Bearer ghp_validtoken123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.publisher.username).toBe('testuser');
      }
      expect(authProvider.authenticate).toHaveBeenCalledWith('ghp_validtoken123');
    });

    it('returns error when no authorization header is provided', async () => {
      const { authenticatePublisher } = await import('../src/server/pack-registry-handlers');

      const result = await authenticatePublisher({
        authProvider,
        authorizationHeader: undefined,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Authorization');
      }
    });

    it('returns error when authorization header is not Bearer format', async () => {
      const { authenticatePublisher } = await import('../src/server/pack-registry-handlers');

      const result = await authenticatePublisher({
        authProvider,
        authorizationHeader: 'Basic abc123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Bearer');
      }
    });

    it('returns error when token is invalid', async () => {
      const invalidAuthProvider = createMockAuthProvider({
        authenticate: vi.fn().mockResolvedValue(null),
      });

      const { authenticatePublisher } = await import('../src/server/pack-registry-handlers');

      const result = await authenticatePublisher({
        authProvider: invalidAuthProvider,
        authorizationHeader: 'Bearer ghp_invalidtoken',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid');
      }
    });
  });
});
