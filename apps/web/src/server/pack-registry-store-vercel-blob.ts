/**
 * Vercel Blob-backed pack registry store and blob store (WU-1869).
 *
 * Adapters implementing PackRegistryStore and PackBlobStore ports
 * backed by Vercel Blob storage. The registry index is stored as a
 * single JSON blob; tarballs are stored as individual blobs.
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
 * Registry index shape (stored as JSON blob)
 * ------------------------------------------------------------------ */

interface RegistryIndex {
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

    if (listing.blobs.length === 0) {
      return { packs: [] };
    }

    const blob = listing.blobs[0];
    const response = await fetch(blob.url);
    const text = await response.text();

    return JSON.parse(text) as RegistryIndex;
  }

  /**
   * Save the registry index to Vercel Blob, overwriting any existing blob.
   */
  private async saveIndex(index: RegistryIndex): Promise<void> {
    const content = JSON.stringify(index, null, 2);
    await put(REGISTRY_INDEX_PATH, content, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
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
  ): Promise<PackRegistryEntry> {
    const index = await this.loadIndex();
    const now = new Date().toISOString();

    const existingIndex = index.packs.findIndex((pack) => pack.id === packId);

    let updatedPack: PackRegistryEntry;

    if (existingIndex >= 0) {
      const existing = index.packs[existingIndex];
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
        latestVersion: version.version,
        versions: [version],
        createdAt: now,
        updatedAt: now,
      };
    }

    const mutablePacks = [...index.packs];
    if (existingIndex >= 0) {
      mutablePacks[existingIndex] = updatedPack;
    } else {
      mutablePacks.push(updatedPack);
    }

    await this.saveIndex({ packs: mutablePacks });

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

    const blob = await put(path, data, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
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
