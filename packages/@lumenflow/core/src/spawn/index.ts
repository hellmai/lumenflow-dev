/**
 * Spawn Module (WU-2539)
 *
 * Exports spawn registry functionality.
 *
 * @module @lumenflow/core/spawn
 */

export {
  validateSpawnEvent,
  generateSpawnId,
  SpawnStatus,
  SPAWN_STATUSES,
  SPAWN_PATTERNS,
  SpawnEventSchema,
  type SpawnEvent,
} from './spawn-registry-schema.js';

export { SpawnRegistryStore, SPAWN_REGISTRY_FILE_NAME } from './spawn-registry-store.js';
