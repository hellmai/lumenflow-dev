/**
 * In-memory pack registry store (WU-1836, WU-1920).
 *
 * Adapter implementing the PackRegistryStore port for development
 * and testing. Stores pack metadata in a Map. Not persistent --
 * data is lost on process restart.
 *
 * For production, this would be replaced with a Vercel Blob-backed
 * JSON file store or a database adapter.
 */

import type { PackRegistryEntry, PackRegistryStore, PackVersion } from '../lib/pack-registry-types';

export class InMemoryPackRegistryStore implements PackRegistryStore {
  private readonly packs: Map<string, PackRegistryEntry>;

  constructor(initialPacks: readonly PackRegistryEntry[] = []) {
    this.packs = new Map(initialPacks.map((pack) => [pack.id, pack]));
  }

  async listPacks(query?: string): Promise<readonly PackRegistryEntry[]> {
    const allPacks = Array.from(this.packs.values());

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
    return this.packs.get(id) ?? null;
  }

  async upsertPackVersion(
    packId: string,
    description: string,
    version: PackVersion,
    owner: string,
  ): Promise<PackRegistryEntry> {
    const existing = this.packs.get(packId);
    const now = new Date().toISOString();

    if (existing) {
      const updated: PackRegistryEntry = {
        ...existing,
        description,
        latestVersion: version.version,
        versions: [...existing.versions, version],
        updatedAt: now,
      };
      this.packs.set(packId, updated);
      return updated;
    }

    const newEntry: PackRegistryEntry = {
      id: packId,
      description,
      owner,
      latestVersion: version.version,
      versions: [version],
      createdAt: now,
      updatedAt: now,
    };
    this.packs.set(packId, newEntry);
    return newEntry;
  }
}
