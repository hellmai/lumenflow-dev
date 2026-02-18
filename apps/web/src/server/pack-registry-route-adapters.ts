/**
 * Route adapters for pack registry API (WU-1836, WU-1869).
 *
 * These create handler functions compatible with Next.js Route Handlers.
 * Each adapter wires port interfaces to the pure handler functions,
 * handling HTTP concerns (status codes, headers, request parsing).
 */

import type { PackRegistryStore, PackBlobStore, AuthProvider } from '../lib/pack-registry-types';
import {
  handleListPacks,
  handleGetPack,
  handlePublishVersion,
  authenticatePublisher,
} from './pack-registry-handlers';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  REDIRECT: 302,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' } as const;

const SEARCH_QUERY_PARAM = 'q';
const TARBALL_FIELD_NAME = 'tarball';
const DESCRIPTION_FIELD_NAME = 'description';

const ERROR_TARBALL_REQUIRED = 'tarball field is required in form data';
const ERROR_INTERNAL = 'Internal server error';
const ERROR_VERSION_NOT_FOUND = 'Version not found';

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_CONTENT_TYPE,
  });
}

/* ------------------------------------------------------------------
 * AC1: List packs route
 * ------------------------------------------------------------------ */

interface ListPacksRouteDeps {
  readonly registryStore: PackRegistryStore;
}

export function createListPacksRoute(
  deps: ListPacksRouteDeps,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const query = url.searchParams.get(SEARCH_QUERY_PARAM) ?? undefined;

      const result = await handleListPacks({
        registryStore: deps.registryStore,
        query,
      });

      return jsonResponse(result, HTTP_STATUS.OK);
    } catch {
      return jsonResponse(
        { success: false, error: ERROR_INTERNAL },
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
}

/* ------------------------------------------------------------------
 * AC2: Get pack route
 * ------------------------------------------------------------------ */

interface GetPackRouteDeps {
  readonly registryStore: PackRegistryStore;
}

export function createGetPackRoute(deps: GetPackRouteDeps): (packId: string) => Promise<Response> {
  return async (packId: string): Promise<Response> => {
    try {
      const result = await handleGetPack({
        registryStore: deps.registryStore,
        packId,
      });

      if (!result.success) {
        return jsonResponse(result, HTTP_STATUS.NOT_FOUND);
      }

      return jsonResponse(result, HTTP_STATUS.OK);
    } catch {
      return jsonResponse(
        { success: false, error: ERROR_INTERNAL },
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
}

/* ------------------------------------------------------------------
 * AC3 + AC4: Publish version route (with authentication)
 * ------------------------------------------------------------------ */

interface PublishVersionRouteDeps {
  readonly registryStore: PackRegistryStore;
  readonly blobStore: PackBlobStore;
  readonly authProvider: AuthProvider;
}

export function createPublishVersionRoute(
  deps: PublishVersionRouteDeps,
): (request: Request, packId: string, version: string) => Promise<Response> {
  return async (request: Request, packId: string, version: string): Promise<Response> => {
    try {
      // Authenticate
      const authResult = await authenticatePublisher({
        authProvider: deps.authProvider,
        authorizationHeader: request.headers.get('Authorization') ?? undefined,
      });

      if (!authResult.success) {
        return jsonResponse(authResult, HTTP_STATUS.UNAUTHORIZED);
      }

      // Parse form data
      const formData = await request.formData();
      const tarballFile = formData.get(TARBALL_FIELD_NAME);
      const description = formData.get(DESCRIPTION_FIELD_NAME);

      if (!tarballFile || !(tarballFile instanceof Blob)) {
        return jsonResponse(
          { success: false, error: ERROR_TARBALL_REQUIRED },
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const tarballBuffer = new Uint8Array(await tarballFile.arrayBuffer());

      const result = await handlePublishVersion({
        registryStore: deps.registryStore,
        blobStore: deps.blobStore,
        packId,
        version,
        description: typeof description === 'string' ? description : '',
        tarball: tarballBuffer,
        publisher: authResult.publisher,
      });

      if (!result.success) {
        return jsonResponse(result, HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }

      return jsonResponse(result, HTTP_STATUS.CREATED);
    } catch {
      return jsonResponse(
        { success: false, error: ERROR_INTERNAL },
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
}

/* ------------------------------------------------------------------
 * WU-1869: Get tarball route (redirect to blob URL)
 * ------------------------------------------------------------------ */

interface GetTarballRouteDeps {
  readonly registryStore: PackRegistryStore;
}

export function createGetTarballRoute(
  deps: GetTarballRouteDeps,
): (packId: string, version: string) => Promise<Response> {
  return async (packId: string, version: string): Promise<Response> => {
    try {
      const result = await handleGetPack({
        registryStore: deps.registryStore,
        packId,
      });

      if (!result.success) {
        return jsonResponse(result, HTTP_STATUS.NOT_FOUND);
      }

      const packVersion = result.pack.versions.find((v) => v.version === version);

      if (!packVersion) {
        return jsonResponse(
          { success: false, error: `${ERROR_VERSION_NOT_FOUND}: ${packId}@${version}` },
          HTTP_STATUS.NOT_FOUND,
        );
      }

      return new Response(null, {
        status: HTTP_STATUS.REDIRECT,
        headers: { Location: packVersion.blobUrl },
      });
    } catch {
      return jsonResponse(
        { success: false, error: ERROR_INTERNAL },
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  };
}
