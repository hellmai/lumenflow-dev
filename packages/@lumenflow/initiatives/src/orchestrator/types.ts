/**
 * Type definitions for initiative orchestration.
 *
 * All shared interfaces and types used across orchestration domain modules.
 *
 * @module orchestrator/types
 */

import type { WUEntry } from '../initiative-yaml.js';

/**
 * Options for checkpoint mode resolution.
 */
export interface CheckpointOptions {
  checkpointPerWave?: boolean;
  noCheckpoint?: boolean;
  dryRun?: boolean;
}

/**
 * Result of checkpoint mode resolution.
 */
export interface CheckpointModeResult {
  enabled: boolean;
  source: 'explicit' | 'override' | 'auto' | 'dryrun';
  reason?: string;
}

/**
 * Result of auto-detection for checkpoint mode.
 */
export interface AutoCheckpointResult {
  autoEnabled: boolean;
  reason: string;
  pendingCount: number;
  waveCount: number;
}

/**
 * Skipped WU entry with reason.
 */
export interface SkippedWUEntry {
  id: string;
  reason: string;
}

/**
 * Deferred WU entry with blockers.
 */
export interface DeferredWUEntry {
  id: string;
  blockedBy: string[];
  reason: string;
}

/**
 * Execution plan result.
 */
export interface ExecutionPlan {
  waves: WUEntry[][];
  skipped: string[];
  skippedWithReasons: SkippedWUEntry[];
  deferred: DeferredWUEntry[];
}

/**
 * Progress statistics for WUs.
 */
export interface ProgressStats {
  total: number;
  done: number;
  active: number;
  pending: number;
  blocked: number;
  percentage: number;
}

/**
 * Bottleneck WU entry.
 */
export interface BottleneckWU {
  id: string;
  title: string;
  blocksCount: number;
}

/**
 * Wave manifest WU entry.
 */
export interface WaveManifestWU {
  id: string;
  lane?: string;
  status?: string;
}

/**
 * Wave manifest structure.
 */
export interface WaveManifest {
  initiative: string;
  wave: number;
  created_at?: string;
  wus: WaveManifestWU[];
  lane_validation?: string;
  done_criteria?: string;
}

/**
 * Checkpoint wave result.
 */
export interface CheckpointWaveResult {
  initiative: string;
  wave: number;
  wus: WaveManifestWU[];
  manifestPath: string | null;
  blockedBy?: string[];
  waitingMessage?: string;
  dryRun?: boolean;
}

/**
 * Dependency filter result.
 */
export interface DependencyFilterResult {
  spawnable: WUEntry[];
  blocked: WUEntry[];
  blockingDeps: string[];
  waitingMessage: string;
}

/**
 * WU-1326: Lock policy type for lane configuration.
 *
 * - 'all' (default): Blocked WUs hold lane lock (current behavior)
 * - 'active': Blocked WUs do NOT hold lane lock (only in_progress holds)
 * - 'none': No WIP checking at all (unlimited parallel WUs in lane)
 */
export type LockPolicy = 'all' | 'active' | 'none';

/**
 * WU-1326: Lane configuration with lock_policy.
 */
export interface LaneConfig {
  lock_policy?: LockPolicy;
  wip_limit?: number;
}

/**
 * WU-1326: Options for lock_policy-aware execution plan building.
 */
export interface LockPolicyOptions {
  laneConfigs?: Record<string, LaneConfig>;
}

/**
 * WU-1326: Lane availability result for policy-aware status display.
 */
export interface LaneAvailabilityResult {
  available: boolean;
  policy: LockPolicy;
  occupiedBy?: string;
  blockedCount: number;
  inProgressCount: number;
}
