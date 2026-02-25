// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Initiative Orchestrator (WU-1581, WU-1821, WU-1648)
 *
 * Thin composition layer that re-exports domain modules for initiative orchestration.
 * Actual logic lives in the orchestrator/ subdirectory, split by domain responsibility:
 *
 * - orchestrator/types.ts         -- Shared type definitions
 * - orchestrator/shared.ts        -- Shared utilities (hasStamp, getAllDependencies)
 * - orchestrator/execution-planning.ts -- Wave-based execution plan building
 * - orchestrator/checkpoint.ts    -- Checkpoint mode, wave manifests, auto-detection
 * - orchestrator/formatting.ts    -- Output formatting (plans, progress, spawn XML)
 * - orchestrator/spawn-status.ts  -- WU spawn status checking
 * - orchestrator/lane-policy.ts   -- Lane lock policy management
 * - orchestrator/initiative-loading.ts -- Initiative/WU loading
 *
 * @see {@link packages/@lumenflow/cli/src/orchestrate-initiative.ts} - CLI entry point
 * @see {@link packages/@lumenflow/cli/src/lib/initiative-yaml.ts} - Initiative loading
 * @see {@link packages/@lumenflow/cli/src/lib/dependency-graph.ts} - Dependency graph utilities
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  CheckpointOptions,
  CheckpointModeResult,
  AutoCheckpointResult,
  SkippedWUEntry,
  DeferredWUEntry,
  ExecutionPlan,
  ProgressStats,
  BottleneckWU,
  WaveManifestWU,
  WaveManifest,
  CheckpointWaveResult,
  DependencyFilterResult,
  LockPolicy,
  LaneConfig,
  LockPolicyOptions,
  LaneAvailabilityResult,
} from './orchestrator/types.js';

// ── Shared utilities ──────────────────────────────────────────────────────────
export { LOG_PREFIX } from './orchestrator/shared.js';

// ── Execution planning ────────────────────────────────────────────────────────
export {
  buildExecutionPlan,
  buildExecutionPlanAsync,
  buildExecutionPlanWithLockPolicy,
} from './orchestrator/execution-planning.js';

// ── Checkpoint ────────────────────────────────────────────────────────────────
export {
  CHECKPOINT_AUTO_THRESHOLDS,
  filterByDependencyStamps,
  shouldAutoEnableCheckpoint,
  shouldAutoEnableCheckpointAsync,
  resolveCheckpointMode,
  resolveCheckpointModeAsync,
  validateCheckpointFlags,
  buildCheckpointWave,
} from './orchestrator/checkpoint.js';

// ── Formatting ────────────────────────────────────────────────────────────────
export {
  formatExecutionPlan,
  generateSpawnCommands,
  calculateProgress,
  formatProgress,
  getBottleneckWUs,
  formatCheckpointOutput,
  generateEmbeddedSpawnPrompt,
  formatTaskInvocationWithEmbeddedSpawn,
  formatExecutionPlanWithEmbeddedSpawns,
} from './orchestrator/formatting.js';

// ── Spawn status ──────────────────────────────────────────────────────────────
export {
  getManifestWUStatus,
  isWUActuallySpawned,
  getSpawnCandidatesWithYAMLCheck,
} from './orchestrator/spawn-status.js';

// ── Lane policy ───────────────────────────────────────────────────────────────
export { getLockPolicyForLane, getLaneAvailability } from './orchestrator/lane-policy.js';

// ── Initiative loading ────────────────────────────────────────────────────────
export { loadInitiativeWUs, loadMultipleInitiatives } from './orchestrator/initiative-loading.js';

// ── Scope advisory (WU-2142/WU-2155) ────────────────────────────────────────
export {
  analyseScopeShape,
  formatScopeAdvisory,
  SCOPE_ADVISORY_THRESHOLDS,
  type ScopeAdvisory,
  type ScopeAdvisoryResult,
  type ScopeAdvisoryType,
  type ScopeAdvisorySeverity,
} from './orchestrator/scope-advisory.js';
