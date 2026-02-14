/**
 * Delegation Tree Builder (WU-1674)
 *
 * Delegation-surface aliases for spawn tree internals.
 */

import {
  STATUS_INDICATORS,
  buildSpawnTree,
  formatSpawnTree,
  getSpawnsByInitiative,
  getSpawnsByWU,
  treeToJSON,
} from './spawn-tree.js';

export { STATUS_INDICATORS, treeToJSON };

export function buildDelegationTree(delegations, rootWuId) {
  return buildSpawnTree(delegations, rootWuId);
}

export function formatDelegationTree(tree) {
  return formatSpawnTree(tree);
}

export function getDelegationsByWU(wuId, registryDir) {
  return getSpawnsByWU(wuId, registryDir);
}

export function getDelegationsByInitiative(initId, registryDir, wuDir) {
  return getSpawnsByInitiative(initId, registryDir, wuDir);
}
