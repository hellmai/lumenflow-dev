/**
 * Pack registry API handlers (WU-1836).
 *
 * Pure functions for pack listing, detail, publishing, and authentication.
 * Decoupled from Next.js route infrastructure and storage backends
 * via port interfaces (PackRegistryStore, PackBlobStore, AuthProvider).
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

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const ERROR_PACK_NOT_FOUND = 'Pack not found';
const ERROR_AUTHORIZATION_REQUIRED = 'Authorization header is required';
const ERROR_BEARER_FORMAT_REQUIRED = 'Authorization header must use Bearer scheme';
const ERROR_INVALID_TOKEN = 'Invalid or expired token';
const ERROR_PUBLISH_PREFIX = 'Failed to publish version';

const BEARER_PREFIX = 'Bearer ';

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
 * AC3: Publish pack version
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

    await input.registryStore.upsertPackVersion(input.packId, input.description, newVersion);

    return { success: true, version: newVersion };
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
