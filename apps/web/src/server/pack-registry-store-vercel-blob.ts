/**
 * Vercel Blob-backed pack registry store and blob store (WU-1869, WU-1920).
 *
 * Adapters implementing PackRegistryStore and PackBlobStore ports
 * backed by Vercel Blob storage. The registry index is stored as a
 * single JSON blob; tarballs are stored as individual blobs.
 *
 * WU-1920 additions:
 * - ConcurrentModificationError for optimistic concurrency
 * - Version-based concurrency control on index writes
 * - Owner field on pack entries
 *
 * Requires BLOB_READ_WRITE_TOKEN environment variable to be set.
 */

import { put, list } from '@vercel/blob';
import type {
  PackRegistryEntry,
  PackRegistryStore,
  PackBlobStore,
  PackVersion,
} from '../lib/pack-registry-types';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const REGISTRY_INDEX_PATH = 'registry/registry-index.json';
const PACKS_BLOB_PREFIX = 'packs/';
const TARBALL_EXTENSION = '.tgz';
const BLOB_ACCESS = 'public' as const;
const SHA256_PREFIX = 'sha256:';

/* ------------------------------------------------------------------
 * ConcurrentModificationError (WU-1920 S-RACE)
 * ------------------------------------------------------------------ */

/**
 * Thrown when a write to the registry index conflicts with a concurrent write.
 * Callers should retry the operation.
 */
export class ConcurrentModificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentModificationError';
  }
}

/* ------------------------------------------------------------------
 * Registry index shape (stored as JSON blob)
 * ------------------------------------------------------------------ */

interface RegistryIndex {
  /** Monotonically increasing version for optimistic concurrency control. */
  readonly indexVersion: number;
  readonly packs: readonly PackRegistryEntry[];
}

/* ------------------------------------------------------------------
 * VercelBlobPackRegistryStore
 * ------------------------------------------------------------------ */

export class VercelBlobPackRegistryStore implements PackRegistryStore {
  /**
   * Load the registry index from Vercel Blob.
   * Returns an empty index if the blob does not exist.
   */
  private async loadIndex(): Promise<RegistryIndex> {
    const listing = await list({ prefix: REGISTRY_INDEX_PATH });

    const firstBlob = listing.blobs[0];
    if (!firstBlob) {
      return { indexVersion: 0, packs: [] };
    }

    const response = await fetch(firstBlob.url);
    const text = await response.text();

    const parsed = JSON.parse(text) as Partial<RegistryIndex>;

    // Backfill indexVersion for pre-WU-1920 indices
    return {
      indexVersion: parsed.indexVersion ?? 0,
      packs: parsed.packs ?? [],
    };
  }

  /**
   * Save the registry index to Vercel Blob with optimistic concurrency.
   * Throws ConcurrentModificationError if the index was modified since loading.
   */
  private async saveIndex(index: RegistryIndex, expectedVersion: number): Promise<void> {
    // Re-read the index to check for concurrent modifications
    const currentIndex = await this.loadIndex();
    if (currentIndex.indexVersion !== expectedVersion) {
      throw new ConcurrentModificationError(
        `Expected index version ${expectedVersion}, but found ${currentIndex.indexVersion}`,
      );
    }

    const nextIndex: RegistryIndex = {
      ...index,
      indexVersion: expectedVersion + 1,
    };

    const content = JSON.stringify(nextIndex, null, 2);
    await put(REGISTRY_INDEX_PATH, content, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async listPacks(query?: string): Promise<readonly PackRegistryEntry[]> {
    const index = await this.loadIndex();
    const allPacks = index.packs;

    if (!query || query.length === 0) {
      return allPacks;
    }

    const lowerQuery = query.toLowerCase();

    return allPacks.filter(
      (pack) =>
        pack.id.toLowerCase().includes(lowerQuery) ||
        pack.description.toLowerCase().includes(lowerQuery),
    );
  }

  async getPackById(id: string): Promise<PackRegistryEntry | null> {
    const index = await this.loadIndex();
    return index.packs.find((pack) => pack.id === id) ?? null;
  }

  async upsertPackVersion(
    packId: string,
    description: string,
    version: PackVersion,
    owner: string,
  ): Promise<PackRegistryEntry> {
    const index = await this.loadIndex();
    const now = new Date().toISOString();

    const existing = index.packs.find((pack) => pack.id === packId);

    let updatedPack: PackRegistryEntry;

    if (existing) {
      updatedPack = {
        ...existing,
        description,
        latestVersion: version.version,
        versions: [...existing.versions, version],
        updatedAt: now,
      };
    } else {
      updatedPack = {
        id: packId,
        description,
        owner,
        latestVersion: version.version,
        versions: [version],
        createdAt: now,
        updatedAt: now,
      };
    }

    const mutablePacks = existing
      ? index.packs.map((pack) => (pack.id === packId ? updatedPack : pack))
      : [...index.packs, updatedPack];

    await this.saveIndex({ ...index, packs: mutablePacks }, index.indexVersion);

    return updatedPack;
  }
}

/* ------------------------------------------------------------------
 * VercelBlobPackBlobStore
 * ------------------------------------------------------------------ */

export class VercelBlobPackBlobStore implements PackBlobStore {
  async upload(
    packId: string,
    version: string,
    data: Uint8Array,
  ): Promise<{ url: string; integrity: string }> {
    const path = `${PACKS_BLOB_PREFIX}${packId}/${version}${TARBALL_EXTENSION}`;

    const blob = await put(path, Buffer.from(data), {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Compute SHA-256 integrity hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return {
      url: blob.url,
      integrity: `${SHA256_PREFIX}${hashHex}`,
    };
  }
}
