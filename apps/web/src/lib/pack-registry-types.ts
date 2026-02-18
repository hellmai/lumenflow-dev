/**
 * Types for the pack registry API (WU-1836).
 *
 * Domain types for pack metadata, versions, and registry operations.
 * These are decoupled from infrastructure (Vercel Blob, GitHub OAuth)
 * to keep the domain pure.
 */

/* ------------------------------------------------------------------
 * Pack version metadata
 * ------------------------------------------------------------------ */

/** A specific version of a pack in the registry. */
export interface PackVersion {
  readonly version: string;
  readonly integrity: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly blobUrl: string;
}

/* ------------------------------------------------------------------
 * Pack registry entry
 * ------------------------------------------------------------------ */

/** A pack in the registry with all its versions. */
export interface PackRegistryEntry {
  readonly id: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly versions: readonly PackVersion[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ------------------------------------------------------------------
 * API response types
 * ------------------------------------------------------------------ */

/** Response for GET /api/registry/packs (list). */
export interface PackListResponse {
  readonly packs: readonly PackRegistryEntry[];
  readonly total: number;
}

/** Response for GET /api/registry/packs/:id (detail). */
export interface PackDetailResponse {
  readonly pack: PackRegistryEntry;
}

/** Response for POST /api/registry/packs/:id/versions (publish). */
export interface PackPublishResponse {
  readonly success: true;
  readonly version: PackVersion;
}

/** Error response returned by all endpoints on failure. */
export interface PackRegistryErrorResponse {
  readonly success: false;
  readonly error: string;
}

/* ------------------------------------------------------------------
 * Port interfaces (hexagonal architecture)
 * ------------------------------------------------------------------ */

/** Port for reading/writing the pack registry index. */
export interface PackRegistryStore {
  /** List all packs, optionally filtered by search query. */
  listPacks(query?: string): Promise<readonly PackRegistryEntry[]>;

  /** Get a single pack by ID. Returns null if not found. */
  getPackById(id: string): Promise<PackRegistryEntry | null>;

  /** Add or update a pack version in the index. */
  upsertPackVersion(
    packId: string,
    description: string,
    version: PackVersion,
  ): Promise<PackRegistryEntry>;
}

/** Port for storing pack tarballs. */
export interface PackBlobStore {
  /** Upload a tarball and return its URL and integrity hash. */
  upload(
    packId: string,
    version: string,
    data: Uint8Array,
  ): Promise<{ url: string; integrity: string }>;
}

/** Authenticated publisher identity. */
export interface PublisherIdentity {
  readonly username: string;
  readonly avatarUrl?: string;
}

/** Port for authenticating publishers. */
export interface AuthProvider {
  /** Validate a bearer token and return the publisher identity. Returns null if invalid. */
  authenticate(token: string): Promise<PublisherIdentity | null>;
}
