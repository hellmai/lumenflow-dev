/**
 * GET /api/registry/packs/:id
 *
 * Returns pack metadata, all versions, and integrity hashes.
 * Returns 404 if the pack is not found.
 */

import { getRegistryStore } from '../../../../../src/server/pack-registry-config';
import { createGetPackRoute } from '../../../../../src/server/pack-registry-route-adapters';
import type { RouteContext } from '../../../../../src/server/api-route-paths';
import { resolveRouteParams } from '../../../../../src/server/api-route-paths';

const getPack = createGetPackRoute({
  registryStore: getRegistryStore(),
});

interface PackIdParams {
  readonly id: string;
}

export async function GET(
  _request: Request,
  context: RouteContext<PackIdParams>,
): Promise<Response> {
  const { id } = await resolveRouteParams(context);
  return getPack(id);
}
