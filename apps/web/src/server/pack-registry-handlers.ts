/**
 * Pack registry API handlers (WU-1836, WU-1920).
 *
 * Pure functions for pack listing, detail, publishing, and authentication.
 * Decoupled from Next.js route infrastructure and storage backends
 * via port interfaces (PackRegistryStore, PackBlobStore, AuthProvider).
 *
 * WU-1920 security hardening:
 * - S-OWN: Pack ownership validation (publisher = owner)
 * - S-IMMUT: Version immutability (duplicate version returns 409)
 * - S-TARVAL: Tarball validation (size limit)
 * - S-RACE: Optimistic concurrency retry on ConcurrentModificationError
 * - S-RATE: Per-publisher rate limiting on publish
 */

import type {
  PackRegistryStore,
  PackBlobStore,
  PackRegistryEntry,
  PackVersion,
  PackListResponse,
  PackRegistryErrorResponse,
  PublisherIdentity,
  AuthProvider,
} from '../lib/pack-registry-types';
import { ConcurrentModificationError } from './pack-registry-store-vercel-blob';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const ERROR_PACK_NOT_FOUND = 'Pack not found';
const ERROR_AUTHORIZATION_REQUIRED = 'Authorization header is required';
const ERROR_BEARER_FORMAT_REQUIRED = 'Authorization header must use Bearer scheme';
const ERROR_INVALID_TOKEN = 'Invalid or expired token';
const ERROR_PUBLISH_PREFIX = 'Failed to publish version';
const ERROR_OWNERSHIP_VIOLATION = 'Pack ownership violation: publisher is not the pack owner';
const ERROR_VERSION_EXISTS = 'Version already exists';
const ERROR_TARBALL_TOO_LARGE = 'Tarball exceeds maximum size';
const ERROR_CONCURRENT_MODIFICATION = 'Failed to publish due to concurrent modification';
const ERROR_RATE_LIMITED = 'Publish rate limit exceeded';

const BEARER_PREFIX = 'Bearer ';

/** Maximum tarball size in bytes (50 MB). */
export const TARBALL_MAX_SIZE = 50 * 1024 * 1024;

/** Maximum retries for optimistic concurrency conflicts. */
export const CONCURRENCY_MAX_RETRIES = 3;

/** Maximum publish requests per publisher within the rate limit window. */
export const RATE_LIMIT_MAX_REQUESTS = 10;

/** Rate limit window duration in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/* ------------------------------------------------------------------
 * S-RATE: Per-publisher rate limiter (WU-1920)
 * ------------------------------------------------------------------ */

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Check whether a publisher has exceeded the publish rate limit.
 * Returns true if the request is allowed, false if rate-limited.
 */
function checkRateLimit(publisherUsername: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let entry = rateLimitStore.get(publisherUsername);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(publisherUsername, entry);
  }

  // Prune timestamps outside the window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  entry.timestamps.push(now);
  return true;
}

/** Reset rate limiter state (for testing). */
export function resetRateLimiter(): void {
  rateLimitStore.clear();
}

/* ------------------------------------------------------------------
 * AC1: List packs with search
 * ------------------------------------------------------------------ */

interface ListPacksInput {
  readonly registryStore: PackRegistryStore;
  readonly query?: string;
}

export async function handleListPacks(input: ListPacksInput): Promise<PackListResponse> {
  const packs = await input.registryStore.listPacks(input.query);
  return {
    packs,
    total: packs.length,
  };
}

/* ------------------------------------------------------------------
 * AC2: Get pack by ID
 * ------------------------------------------------------------------ */

interface GetPackInput {
  readonly registryStore: PackRegistryStore;
  readonly packId: string;
}

type GetPackResult =
  | { readonly success: true; readonly pack: PackRegistryEntry }
  | PackRegistryErrorResponse;

export async function handleGetPack(input: GetPackInput): Promise<GetPackResult> {
  const pack = await input.registryStore.getPackById(input.packId);

  if (pack === null) {
    return { success: false, error: `${ERROR_PACK_NOT_FOUND}: ${input.packId}` };
  }

  return { success: true, pack };
}

/* ------------------------------------------------------------------
 * AC3: Publish pack version (with WU-1920 security hardening)
 * ------------------------------------------------------------------ */

interface PublishVersionInput {
  readonly registryStore: PackRegistryStore;
  readonly blobStore: PackBlobStore;
  readonly packId: string;
  readonly version: string;
  readonly description: string;
  readonly tarball: Uint8Array;
  readonly publisher: PublisherIdentity;
}

type PublishResult =
  | { readonly success: true; readonly version: PackVersion }
  | PackRegistryErrorResponse;

export async function handlePublishVersion(input: PublishVersionInput): Promise<PublishResult> {
  // S-RATE: Check per-publisher rate limit
  if (!checkRateLimit(input.publisher.username)) {
    return {
      success: false,
      error: ERROR_RATE_LIMITED,
      statusCode: 429,
    };
  }

  // S-TARVAL: Validate tarball size
  if (input.tarball.byteLength > TARBALL_MAX_SIZE) {
    return {
      success: false,
      error: `${ERROR_TARBALL_TOO_LARGE}: ${input.tarball.byteLength} bytes exceeds limit of ${TARBALL_MAX_SIZE} bytes`,
    };
  }

  // Look up existing pack for ownership and version immutability checks
  const existingPack = await input.registryStore.getPackById(input.packId);

  if (existingPack) {
    // S-OWN: Validate pack ownership
    if (existingPack.owner !== input.publisher.username) {
      return {
        success: false,
        error: ERROR_OWNERSHIP_VIOLATION,
        statusCode: 403,
      };
    }

    // S-IMMUT: Check version immutability
    const versionExists = existingPack.versions.some((v) => v.version === input.version);
    if (versionExists) {
      return {
        success: false,
        error: `${ERROR_VERSION_EXISTS}: ${input.packId}@${input.version}`,
        statusCode: 409,
      };
    }
  }

  try {
    const blob = await input.blobStore.upload(input.packId, input.version, input.tarball);

    const now = new Date().toISOString();

    const newVersion: PackVersion = {
      version: input.version,
      integrity: blob.integrity,
      publishedAt: now,
      publishedBy: input.publisher.username,
      blobUrl: blob.url,
    };

    // S-RACE: Retry on optimistic concurrency conflicts
    let lastError: unknown;
    for (let attempt = 0; attempt < CONCURRENCY_MAX_RETRIES; attempt++) {
      try {
        await input.registryStore.upsertPackVersion(
          input.packId,
          input.description,
          newVersion,
          input.publisher.username,
        );
        return { success: true, version: newVersion };
      } catch (error) {
        if (error instanceof ConcurrentModificationError) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    // All retries exhausted
    const message =
      lastError instanceof Error
        ? `${ERROR_CONCURRENT_MODIFICATION}: ${lastError.message}`
        : ERROR_CONCURRENT_MODIFICATION;
    return { success: false, error: message, statusCode: 409 };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${ERROR_PUBLISH_PREFIX}: unknown error`;
    return { success: false, error: message };
  }
}

/* ------------------------------------------------------------------
 * AC4: Authentication
 * ------------------------------------------------------------------ */

interface AuthenticateInput {
  readonly authProvider: AuthProvider;
  readonly authorizationHeader: string | undefined;
}

type AuthResult =
  | { readonly success: true; readonly publisher: PublisherIdentity }
  | PackRegistryErrorResponse;

export async function authenticatePublisher(input: AuthenticateInput): Promise<AuthResult> {
  if (!input.authorizationHeader) {
    return { success: false, error: ERROR_AUTHORIZATION_REQUIRED };
  }

  if (!input.authorizationHeader.startsWith(BEARER_PREFIX)) {
    return { success: false, error: ERROR_BEARER_FORMAT_REQUIRED };
  }

  const token = input.authorizationHeader.slice(BEARER_PREFIX.length);

  const publisher = await input.authProvider.authenticate(token);

  if (publisher === null) {
    return { success: false, error: ERROR_INVALID_TOKEN };
  }

  return { success: true, publisher };
}
