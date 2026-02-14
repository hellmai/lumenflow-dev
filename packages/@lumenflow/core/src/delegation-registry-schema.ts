/**
 * Delegation Registry Schema (WU-1674)
 *
 * Delegation-surface alias for spawn registry internals.
 * Clean-slate command/tool/module surfaces should reference delegation names.
 */

export {
  SpawnStatus as DelegationStatus,
  type SpawnStatusValue as DelegationStatusValue,
  SPAWN_STATUSES as DELEGATION_STATUSES,
  SpawnIntent as DelegationIntent,
  type SpawnIntentValue as DelegationIntentValue,
  SPAWN_INTENTS as DELEGATION_INTENTS,
  SPAWN_PATTERNS as DELEGATION_PATTERNS,
  SpawnEventSchema as DelegationEventSchema,
  type SpawnEvent as DelegationEvent,
  validateSpawnEvent as validateDelegationEvent,
  generateSpawnId as generateDelegationId,
} from './spawn-registry-schema.js';
