/**
 * Checkpoint mode management for initiative orchestration.
 *
 * WU-1821: Implements checkpoint-per-wave pattern for context management.
 * Handles wave manifest creation, auto-detection thresholds, and mode resolution.
 *
 * @module orchestrator/checkpoint
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WUEntry } from '../initiative-yaml.js';
import { findInitiative, getInitiativeWUs } from '../initiative-yaml.js';
import type {
  CheckpointOptions,
  CheckpointModeResult,
  AutoCheckpointResult,
  CheckpointWaveResult,
  WaveManifest,
  DependencyFilterResult,
} from './types.js';
import { WAVE_MANIFEST_DIR, hasStamp, getAllDependencies } from './shared.js';
import { buildExecutionPlan, buildExecutionPlanAsync } from './execution-planning.js';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

/**
 * WU-1200: Wave manifest WU status constant.
 */
const MANIFEST_WU_STATUS = 'queued';

/**
 * WU-1828: Auto-detection thresholds for checkpoint mode.
 *
 * These thresholds determine when checkpoint mode is automatically enabled
 * to prevent "prompt too long" errors for large initiatives.
 *
 * @type {{WU_COUNT: number, WAVE_COUNT: number}}
 */
export const CHECKPOINT_AUTO_THRESHOLDS = {
  /** Auto-enable checkpoint mode if pending WU count exceeds this (>3 = 4+) */
  WU_COUNT: 3,
  /** Auto-enable checkpoint mode if wave count exceeds this (>2 = 3+) */
  WAVE_COUNT: 2,
};

/**
 * WU-2040: Filter WUs by dependency stamp status.
 * WU-1251: Now checks both blocked_by AND dependencies arrays.
 *
 * A WU is only spawnable if ALL its dependencies have stamps.
 * This implements the wait-for-completion pattern per Anthropic multi-agent research.
 *
 * @param {Array<{id: string, doc: {blocked_by?: string[], dependencies?: string[], lane: string, status: string}}>} candidates - WU candidates
 * @returns {{spawnable: Array<object>, blocked: Array<object>, blockingDeps: string[], waitingMessage: string}}
 */
export function filterByDependencyStamps(candidates: WUEntry[]): DependencyFilterResult {
  const spawnable: WUEntry[] = [];
  const blocked: WUEntry[] = [];
  const blockingDeps = new Set<string>();

  for (const wu of candidates) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const deps = getAllDependencies(wu.doc);

    // Check if ALL dependencies have stamps
    const unmetDeps = deps.filter((depId) => !hasStamp(depId));

    if (unmetDeps.length === 0) {
      // All deps satisfied (or no deps)
      spawnable.push(wu);
    } else {
      // Has unmet dependencies
      blocked.push(wu);
      for (const depId of unmetDeps) {
        blockingDeps.add(depId);
      }
    }
  }

  // Build waiting message if needed
  let waitingMessage = '';
  if (spawnable.length === 0 && blockingDeps.size > 0) {
    const depsArray = Array.from(blockingDeps);
    waitingMessage = `Waiting for ${depsArray.join(', ')} to complete. No WUs can spawn until ${depsArray.length === 1 ? 'this dependency has' : 'these dependencies have'} a stamp.`;
  }

  return {
    spawnable,
    blocked,
    blockingDeps: Array.from(blockingDeps),
    waitingMessage,
  };
}

/**
 * WU-1828: Determine if checkpoint mode should be auto-enabled based on initiative size.
 *
 * Auto-detection triggers checkpoint mode when:
 * - Pending WU count exceeds WU_COUNT threshold (>3)
 * - OR wave count exceeds WAVE_COUNT threshold (>2)
 *
 * This prevents "prompt too long" errors for large initiatives by using
 * checkpoint-per-wave execution instead of polling mode.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to analyse
 * @returns {{autoEnabled: boolean, reason: string, pendingCount: number, waveCount: number}}
 */
export function shouldAutoEnableCheckpoint(wus: WUEntry[]): AutoCheckpointResult {
  // Count only pending WUs (not done)
  const pendingWUs = wus.filter((wu) => wu.doc.status !== WU_STATUS.DONE);
  const pendingCount = pendingWUs.length;

  // Check WU count threshold first (faster check)
  if (pendingCount > CHECKPOINT_AUTO_THRESHOLDS.WU_COUNT) {
    return {
      autoEnabled: true,
      reason: `${pendingCount} pending WUs exceeds threshold (>${CHECKPOINT_AUTO_THRESHOLDS.WU_COUNT})`,
      pendingCount,
      waveCount: -1, // Not computed (early return)
    };
  }

  // Only compute waves if WU count didn't trigger
  if (pendingCount === 0) {
    return {
      autoEnabled: false,
      reason: 'No pending WUs',
      pendingCount: 0,
      waveCount: 0,
    };
  }

  // Build execution plan to count waves
  const plan = buildExecutionPlan(wus);
  const waveCount = plan.waves.length;

  // Check wave count threshold
  if (waveCount > CHECKPOINT_AUTO_THRESHOLDS.WAVE_COUNT) {
    return {
      autoEnabled: true,
      reason: `${waveCount} waves exceeds threshold (>${CHECKPOINT_AUTO_THRESHOLDS.WAVE_COUNT})`,
      pendingCount,
      waveCount,
    };
  }

  return {
    autoEnabled: false,
    reason: `${pendingCount} pending WUs and ${waveCount} waves within thresholds`,
    pendingCount,
    waveCount,
  };
}

/**
 * WU-1828: Determine if checkpoint mode should be auto-enabled based on initiative size asynchronously.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to analyse
 * @returns {Promise<{autoEnabled: boolean, reason: string, pendingCount: number, waveCount: number}>}
 */
export async function shouldAutoEnableCheckpointAsync(
  wus: WUEntry[],
): Promise<AutoCheckpointResult> {
  // Count only pending WUs (not done)
  const pendingWUs = wus.filter((wu) => wu.doc.status !== WU_STATUS.DONE);
  const pendingCount = pendingWUs.length;

  // Check WU count threshold first (faster check)
  if (pendingCount > CHECKPOINT_AUTO_THRESHOLDS.WU_COUNT) {
    return {
      autoEnabled: true,
      reason: `${pendingCount} pending WUs exceeds threshold (>${CHECKPOINT_AUTO_THRESHOLDS.WU_COUNT})`,
      pendingCount,
      waveCount: -1, // Not computed (early return)
    };
  }

  // Only compute waves if WU count didn't trigger
  if (pendingCount === 0) {
    return {
      autoEnabled: false,
      reason: 'No pending WUs',
      pendingCount: 0,
      waveCount: 0,
    };
  }

  // Build execution plan to count waves
  const plan = await buildExecutionPlanAsync(wus);
  const waveCount = plan.waves.length;

  // Check wave count threshold
  if (waveCount > CHECKPOINT_AUTO_THRESHOLDS.WAVE_COUNT) {
    return {
      autoEnabled: true,
      reason: `${waveCount} waves exceeds threshold (>${CHECKPOINT_AUTO_THRESHOLDS.WAVE_COUNT})`,
      pendingCount,
      waveCount,
    };
  }

  return {
    autoEnabled: false,
    reason: `${pendingCount} pending WUs and ${waveCount} waves within thresholds`,
    pendingCount,
    waveCount,
  };
}

/**
 * WU-1828: Resolve checkpoint mode from CLI flags and auto-detection.
 * WU-2430: Updated to suppress auto-detection in dry-run mode.
 *
 * Flag precedence:
 * 1. --checkpoint-per-wave (-c): Explicitly enables checkpoint mode
 * 2. --no-checkpoint: Explicitly disables checkpoint mode (overrides auto-detection)
 * 3. --dry-run: Suppresses auto-detection (dry-run uses polling mode for preview)
 * 4. Auto-detection: Enabled based on initiative size if no explicit flags
 *
 * @param {{checkpointPerWave?: boolean, noCheckpoint?: boolean, dryRun?: boolean}} options - CLI options
 * @param {Array<{id: string, doc: object}>} wus - WUs for auto-detection
 * @returns {{enabled: boolean, source: 'explicit'|'override'|'auto'|'dryrun', reason?: string}}
 */
export function resolveCheckpointMode(
  options: CheckpointOptions,
  wus: WUEntry[],
): CheckpointModeResult {
  const { checkpointPerWave = false, noCheckpoint = false, dryRun = false } = options;

  // Explicit enable via -c flag
  if (checkpointPerWave) {
    return {
      enabled: true,
      source: 'explicit',
      reason: 'Enabled via -c/--checkpoint-per-wave flag',
    };
  }

  // Explicit disable via --no-checkpoint flag
  if (noCheckpoint) {
    return {
      enabled: false,
      source: 'override',
      reason: 'Disabled via --no-checkpoint flag',
    };
  }

  // WU-2430: Dry-run suppresses auto-detection (preview should use polling mode)
  if (dryRun) {
    return {
      enabled: false,
      source: 'dryrun',
      reason: 'Disabled in dry-run mode (preview uses polling mode)',
    };
  }

  // Auto-detection
  const autoResult = shouldAutoEnableCheckpoint(wus);
  return {
    enabled: autoResult.autoEnabled,
    source: 'auto',
    reason: autoResult.reason,
  };
}

/**
 * WU-1828: Resolve checkpoint mode from CLI flags and auto-detection asynchronously.
 *
 * @param {{checkpointPerWave?: boolean, noCheckpoint?: boolean, dryRun?: boolean}} options - CLI options
 * @param {Array<{id: string, doc: object}>} wus - WUs for auto-detection
 * @returns {Promise<{enabled: boolean, source: 'explicit'|'override'|'auto'|'dryrun', reason?: string}>}
 */
export async function resolveCheckpointModeAsync(
  options: CheckpointOptions,
  wus: WUEntry[],
): Promise<CheckpointModeResult> {
  const { checkpointPerWave = false, noCheckpoint = false, dryRun = false } = options;

  // Explicit enable via -c flag
  if (checkpointPerWave) {
    return {
      enabled: true,
      source: 'explicit',
      reason: 'Enabled via -c/--checkpoint-per-wave flag',
    };
  }

  // Explicit disable via --no-checkpoint flag
  if (noCheckpoint) {
    return {
      enabled: false,
      source: 'override',
      reason: 'Disabled via --no-checkpoint flag',
    };
  }

  // WU-2430: Dry-run suppresses auto-detection (preview should use polling mode)
  if (dryRun) {
    return {
      enabled: false,
      source: 'dryrun',
      reason: 'Disabled in dry-run mode (preview uses polling mode)',
    };
  }

  // Auto-detection
  const autoResult = await shouldAutoEnableCheckpointAsync(wus);
  return {
    enabled: autoResult.autoEnabled,
    source: 'auto',
    reason: autoResult.reason,
  };
}

/**
 * Validate checkpoint-per-wave flag combinations.
 *
 * WU-1828: Extended to validate --no-checkpoint flag combinations.
 *
 * @param {{checkpointPerWave?: boolean, dryRun?: boolean, noCheckpoint?: boolean}} options - CLI options
 * @throws {Error} If invalid flag combination
 */
export function validateCheckpointFlags(options: CheckpointOptions): void {
  if (options.checkpointPerWave && options.dryRun) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      'Cannot combine --checkpoint-per-wave (-c) with --dry-run (-d). ' +
        'Checkpoint mode writes manifests and spawns agents.',
      { flags: { checkpointPerWave: true, dryRun: true } },
    );
  }

  // WU-1828: Validate -c and --no-checkpoint are mutually exclusive
  if (options.checkpointPerWave && options.noCheckpoint) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      'Cannot combine --checkpoint-per-wave (-c) with --no-checkpoint. ' +
        'These flags are mutually exclusive.',
      { flags: { checkpointPerWave: true, noCheckpoint: true } },
    );
  }
}

/**
 * Build a checkpoint wave for an initiative.
 *
 * WU-1821: Creates a wave manifest file and returns spawn candidates.
 * Implements idempotency: skips WUs with stamps or already in previous manifests.
 *
 * Idempotency precedence (single source of truth):
 * 1. Stamp (highest): .lumenflow/stamps/WU-XXXX.done exists -> WU is done
 * 2. Manifest: WU already in previous wave manifest -> skip
 * 3. Status: Only spawn status: ready WUs
 *
 * @param {string} initRef - Initiative ID or slug
 * @returns {{wave: number, wus: Array<{id: string, lane: string, status: string}>, manifestPath: string, initiative: string}|null}
 *   Wave data or null if all WUs complete
 */
export function buildCheckpointWave(
  initRef: string,
  options: CheckpointOptions = {},
): CheckpointWaveResult | null {
  const { dryRun = false } = options;
  // Load initiative and WUs
  const initData = findInitiative(initRef);
  if (!initData) {
    throw createError(ErrorCodes.INIT_NOT_FOUND, `Initiative '${initRef}' not found.`, { initRef });
  }

  const initId = initData.id;
  const wus = getInitiativeWUs(initRef);

  // Filter to spawn candidates:
  // 1. status: ready only (from YAML - authoritative)
  // 2. No stamp exists (idempotency)
  const readyCandidates = wus.filter((wu) => {
    if (wu.doc.status !== WU_STATUS.READY) {
      return false;
    }
    if (hasStamp(wu.id)) {
      return false;
    }
    return true;
  });

  // If no ready candidates, all work is done
  if (readyCandidates.length === 0) {
    return null;
  }

  // WU-2040: Filter by dependency stamps (wait-for-completion pattern)
  const depResult = filterByDependencyStamps(readyCandidates);

  // If no spawnable WUs due to unmet dependencies, return blocking info
  if (depResult.spawnable.length === 0) {
    return {
      initiative: initId,
      wave: -1,
      wus: [],
      manifestPath: null,
      blockedBy: depResult.blockingDeps,
      waitingMessage: depResult.waitingMessage,
    };
  }

  // Apply lane WIP=1 constraint: max one WU per lane per wave
  const selectedWUs = [];
  const usedLanes = new Set();

  for (const wu of depResult.spawnable) {
    const lane = wu.doc.lane;
    if (!usedLanes.has(lane)) {
      selectedWUs.push(wu);
      usedLanes.add(lane);
    }
  }

  // Determine wave number
  const waveNum = getNextWaveNumber(initId);

  // Build manifest
  const manifest = {
    initiative: initId,
    wave: waveNum,
    created_at: new Date().toISOString(),
    wus: selectedWUs.map((wu) => ({
      id: wu.id,
      lane: wu.doc.lane,
      status: MANIFEST_WU_STATUS,
    })),
    lane_validation: 'pass',
    done_criteria: 'All stamps exist in .lumenflow/stamps/',
  };

  // WU-2277: Skip file creation in dry-run mode
  const manifestPath = join(WAVE_MANIFEST_DIR, `${initId}-wave-${waveNum}.json`);
  if (!dryRun) {
    // Ensure directory exists
    if (!existsSync(WAVE_MANIFEST_DIR)) {
      mkdirSync(WAVE_MANIFEST_DIR, { recursive: true });
    }

    // Write manifest
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return {
    initiative: initId,
    wave: waveNum,
    wus: manifest.wus,
    manifestPath,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Get existing wave manifests for an initiative.
 *
 * @param {string} initId - Initiative ID
 * @returns {Array<{wave: number, wus: Array<{id: string}>}>} Parsed manifests
 */
function getExistingWaveManifests(initId: string): WaveManifest[] {
  if (!existsSync(WAVE_MANIFEST_DIR)) {
    return [];
  }

  const files = readdirSync(WAVE_MANIFEST_DIR);
  // eslint-disable-next-line security/detect-non-literal-regexp -- initId from internal state, not user input
  const pattern = new RegExp(`^${initId}-wave-(\\d+)\\.json$`);
  const manifests = [];

  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      try {
        const content = readFileSync(join(WAVE_MANIFEST_DIR, file), 'utf8');
        const manifest = JSON.parse(content);
        manifests.push(manifest);
      } catch {
        // Skip invalid manifests
      }
    }
  }

  return manifests.sort((a, b) => a.wave - b.wave);
}

/**
 * Get WU IDs that have already been spawned in previous manifests.
 *
 * @param {string} initId - Initiative ID
 * @returns {Set<string>} Set of WU IDs already in manifests
 */
function _getSpawnedWUIds(initId: string): Set<string> {
  const manifests = getExistingWaveManifests(initId);
  const spawnedIds = new Set<string>();

  for (const manifest of manifests) {
    if (manifest.wus) {
      for (const wu of manifest.wus) {
        spawnedIds.add(wu.id);
      }
    }
  }

  return spawnedIds;
}

/**
 * Determine the next wave number for an initiative.
 *
 * @param {string} initId - Initiative ID
 * @returns {number} Next wave number (0-indexed)
 */
function getNextWaveNumber(initId: string): number {
  const manifests = getExistingWaveManifests(initId);
  if (manifests.length === 0) {
    return 0;
  }
  const maxWave = Math.max(...manifests.map((m) => m.wave));
  return maxWave + 1;
}
