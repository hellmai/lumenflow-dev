/**
 * GET /api/registry/packs/:id/versions/:version/tarball
 *
 * Serves pack tarball by redirecting to the blob storage URL.
 * Returns 302 redirect to the blob URL for existing pack versions.
 * Returns 404 if the pack or version is not found.
 *
 * WU-1869: Vercel Blob-backed pack registry.
 */

import { getRegistryStore } from '../../../../../../../src/server/pack-registry-config';
import { createGetTarballRoute } from '../../../../../../../src/server/pack-registry-route-adapters';
import type { RouteContext } from '../../../../../../../src/server/api-route-paths';
import { resolveRouteParams } from '../../../../../../../src/server/api-route-paths';

const getTarball = createGetTarballRoute({
  registryStore: getRegistryStore(),
});

interface TarballParams {
  readonly id: string;
  readonly version: string;
}

export async function GET(
  _request: Request,
  context: RouteContext<TarballParams>,
): Promise<Response> {
  const { id, version } = await resolveRouteParams(context);
  return getTarball(id, version);
}
