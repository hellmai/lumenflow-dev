// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lifecycle barrel exports for @lumenflow/core.
 *
 * WU-2169: Introduce grouped domain-scoped entrypoints.
 */

// Lane and occupancy lifecycle
export * from '../lane-checker.js';
export {
  getStaleThresholdMs,
  getLocksDir,
  getLockFilePath,
  isLockStale as isLaneLockStale,
  isZombieLock,
  readLockMetadata,
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  forceRemoveStaleLock,
  getAllLaneLocks,
  auditedUnlock,
} from '../lane-lock.js';
export * from '../lane-validator.js';

// WU state and schema lifecycle
export * from '../wu-schema.js';
export * from '../wu-state-schema.js';
export * from '../wu-state-store.js';
export * from '../wu-yaml.js';

// WU orchestration lifecycle
export * from '../wu-done-worktree.js';
export * from '../wu-done-worktree-services.js';
export * from '../wu-done-validators.js';
export * from '../wu-helpers.js';
export * from '../wu-rules-engine.js';
export * from '../wu-validator.js';
export * from '../sync-validator.js';
export * from '../wu-list.js';
