/**
 * Pack registry dependency configuration (WU-1836, WU-1869).
 *
 * Creates and provides the concrete adapter instances for the pack
 * registry ports. When BLOB_READ_WRITE_TOKEN is set, uses Vercel Blob
 * adapters for persistent storage. Otherwise falls back to in-memory
 * stores for development.
 *
 * This is the composition root for the registry API.
 */

import type {
  PackRegistryStore,
  PackBlobStore,
  AuthProvider,
  PublisherIdentity,
} from '../lib/pack-registry-types';
import { InMemoryPackRegistryStore } from './pack-registry-store-memory';
import {
  VercelBlobPackRegistryStore,
  VercelBlobPackBlobStore,
} from './pack-registry-store-vercel-blob';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';

/* ------------------------------------------------------------------
 * In-memory blob store (development adapter)
 * ------------------------------------------------------------------ */

class InMemoryBlobStore implements PackBlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async upload(
    packId: string,
    version: string,
    data: Uint8Array,
  ): Promise<{ url: string; integrity: string }> {
    const key = `${packId}/${version}.tgz`;
    this.blobs.set(key, data);

    // Compute a simple hash for integrity
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return {
      url: `/api/registry/blobs/${key}`,
      integrity: `sha256:${hashHex}`,
    };
  }
}

/* ------------------------------------------------------------------
 * GitHub OAuth auth provider (development stub)
 * ------------------------------------------------------------------ */

const GITHUB_API_USER_URL = 'https://api.github.com/user';
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';

class GitHubOAuthProvider implements AuthProvider {
  async authenticate(token: string): Promise<PublisherIdentity | null> {
    try {
      const response = await fetch(GITHUB_API_USER_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: GITHUB_ACCEPT_HEADER,
        },
      });

      if (!response.ok) {
        return null;
      }

      const user = (await response.json()) as { login: string; avatar_url: string };

      return {
        username: user.login,
        avatarUrl: user.avatar_url,
      };
    } catch {
      return null;
    }
  }
}

/* ------------------------------------------------------------------
 * Environment detection
 * ------------------------------------------------------------------ */

function hasVercelBlobToken(): boolean {
  return (
    typeof process.env[BLOB_TOKEN_ENV_VAR] === 'string' &&
    process.env[BLOB_TOKEN_ENV_VAR].length > 0
  );
}

/* ------------------------------------------------------------------
 * Singleton instances
 * ------------------------------------------------------------------ */

let registryStore: PackRegistryStore | null = null;
let blobStore: PackBlobStore | null = null;
let authProvider: AuthProvider | null = null;

export function getRegistryStore(): PackRegistryStore {
  if (!registryStore) {
    registryStore = hasVercelBlobToken()
      ? new VercelBlobPackRegistryStore()
      : new InMemoryPackRegistryStore();
  }
  return registryStore;
}

export function getBlobStore(): PackBlobStore {
  if (!blobStore) {
    blobStore = hasVercelBlobToken() ? new VercelBlobPackBlobStore() : new InMemoryBlobStore();
  }
  return blobStore;
}

export function getAuthProvider(): AuthProvider {
  if (!authProvider) {
    authProvider = new GitHubOAuthProvider();
  }
  return authProvider;
}
