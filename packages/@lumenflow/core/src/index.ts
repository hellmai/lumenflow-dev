/**
 * @lumenflow/core - Battle-tested LumenFlow workflow framework
 * @module @lumenflow/core
 */

// Package version
export const VERSION = '0.0.0';

// Core utilities
export * from './arg-parser.js';
export * from './date-utils.js';
export * from './error-handler.js';
export * from './retry-strategy.js';

// Migration utilities (WU-1075)
export * from './beacon-migration.js';

// User normalizer (explicit exports to avoid conflicts)
export {
  DEFAULT_DOMAIN,
  inferDefaultDomain,
  normalizeToEmail,
  isValidEmail,
} from './user-normalizer.js';

// Git operations
export * from './git-adapter.js';

// State machine
export * from './state-machine.js';

// WU State Schema (explicit exports to avoid SpawnEvent conflict with spawn-registry)
export {
  WU_EVENT_TYPES,
  WU_STATUSES,
  WU_PATTERNS,
  CreateEventSchema,
  ClaimEventSchema,
  BlockEventSchema,
  UnblockEventSchema,
  CompleteEventSchema,
  CheckpointEventSchema,
  WUEventSchema,
  validateWUEvent,
  // Rename conflicting exports
  SpawnEventSchema as WUSpawnEventSchema,
  type CreateEvent,
  type ClaimEvent,
  type BlockEvent,
  type UnblockEvent,
  type CompleteEvent,
  type CheckpointEvent,
  type WUEvent,
  type SpawnEvent as WUSpawnEvent,
} from './wu-state-schema.js';

// WU State Store (explicit exports to avoid isLockStale conflict)
export {
  WU_EVENTS_FILE_NAME,
  WUStateStore,
  acquireLock,
  releaseLock,
  repairStateFile,
  isLockStale as isWULockStale,
  type WUStateEntry,
  type LockData as WULockData,
  type CheckpointOptions,
  type RepairResult,
} from './wu-state-store.js';

// Lane management
export * from './lane-checker.js';
export * from './lane-inference.js';

// Lane lock (explicit exports with proper names)
export {
  getStaleThresholdMs,
  getLocksDir,
  getLockFilePath,
  isLockStale,
  isZombieLock,
  readLockMetadata,
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  forceRemoveStaleLock,
  getAllLaneLocks,
  auditedUnlock,
} from './lane-lock.js';

export * from './lane-validator.js';

// WU lifecycle
export * from './wu-yaml.js';

// WU claim helpers (skip isValidEmail which conflicts with user-normalizer)
export { getAssignedEmail } from './wu-claim-helpers.js';

export * from './wu-done-worktree.js';
export * from './wu-done-validators.js';
export * from './wu-helpers.js';
export * from './wu-schema.js';
export * from './wu-validator.js';

// Spawn system
export * from './spawn-registry-store.js';
export * from './spawn-registry-schema.js';
export * from './spawn-tree.js';
export * from './spawn-recovery.js';
export * from './spawn-monitor.js';
export * from './spawn-escalation.js';

// Backlog management
export * from './backlog-generator.js';
export * from './backlog-parser.js';
export * from './backlog-editor.js';
export * from './backlog-sync-validator.js';

// Worktree utilities
export * from './worktree-scanner.js';
export * from './worktree-ownership.js';
export * from './micro-worktree.js';

// Guards and validators
// NOTE: Configuration added below
export * from './dependency-guard.js';
export * from './stamp-utils.js';
// Configuration
export * from './lumenflow-config.js';
export * from './lumenflow-config-schema.js';

// Gates configuration (WU-1067)
export * from './gates-config.js';

// Branch check utilities
export * from './branch-check.js';

// WU-1062: External plan storage
export * from './lumenflow-home.js';

// WU-1070: Force bypass audit logging
export * from './force-bypass-audit.js';

// WU-1075: LumenFlow directory paths (exported from wu-constants)
export { LUMENFLOW_PATHS, BEACON_PATHS } from './wu-constants.js';
