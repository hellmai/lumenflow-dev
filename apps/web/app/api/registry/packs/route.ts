/**
 * GET /api/registry/packs
 *
 * Lists all packs in the registry, with optional search via ?q= parameter.
 * Returns { packs: PackRegistryEntry[], total: number }.
 */

import { getRegistryStore } from '../../../../src/server/pack-registry-config';
import { createListPacksRoute } from '../../../../src/server/pack-registry-route-adapters';

const listPacks = createListPacksRoute({
  registryStore: getRegistryStore(),
});

export async function GET(request: Request): Promise<Response> {
  return listPacks(request);
}
