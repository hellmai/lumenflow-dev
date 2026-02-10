/**
 * Initiative Orchestrator (WU-1581, WU-1821)
 *
 * Core orchestration logic for parallel agent execution of initiative WUs.
 * Builds execution plans based on WU dependencies and manages wave-based execution.
 *
 * Architecture:
 * - Loads initiative(s) and their WUs
 * - Builds dependency graph for topological ordering
 * - Groups independent WUs into parallel execution waves
 * - Generates spawn commands for agent delegation
 *
 * WU-1821 additions:
 * - Checkpoint-per-wave pattern for context management
 * - Wave manifest files for idempotent resumption
 * - Compact output for token discipline
 *
 * @see {@link packages/@lumenflow/cli/src/orchestrate-initiative.ts} - CLI entry point
 * @see {@link packages/@lumenflow/cli/src/lib/initiative-yaml.ts} - Initiative loading
 * @see {@link packages/@lumenflow/cli/src/lib/dependency-graph.ts} - Dependency graph utilities
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findInitiative, getInitiativeWUs } from './initiative-yaml.js';
import type { InitiativeDoc, WUEntry } from './initiative-yaml.js';

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
import {
  buildDependencyGraph,
  buildDependencyGraphAsync,
  validateGraph,
} from '@lumenflow/core/dependency-graph';

/**
 * WU-1251: Helper to get all dependencies from a WU doc.
 *
 * Combines both `blocked_by` and `dependencies` arrays for dependency resolution.
 * The WU YAML schema supports both:
 * - `blocked_by`: Legacy/explicit blockers
 * - `dependencies`: Semantic dependencies on other WUs
 *
 * Both arrays represent the same concept: WUs that must complete before this WU can start.
 *
 * @param {object} doc - WU document
 * @returns {string[]} Combined list of all dependency WU IDs (deduplicated)
 */
function getAllDependencies(doc: { blocked_by?: string[]; dependencies?: string[] }): string[] {
  const blockedBy = doc.blocked_by ?? [];
  const dependencies = doc.dependencies ?? [];

  // Combine and deduplicate
  const allDeps = new Set([...blockedBy, ...dependencies]);
  return Array.from(allDeps);
}
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { WU_STATUS, STRING_LITERALS } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';
// WU-2027: Import spawn generation for embedding in orchestration output
import { generateTaskInvocation } from '@lumenflow/core/wu-spawn';
import { SpawnStrategyFactory } from '@lumenflow/core/spawn-strategy';

/**
 * Wave manifest directory path (gitignored).
 */
const WAVE_MANIFEST_DIR = '.lumenflow/artifacts/waves';

/**
 * Stamps directory path.
 */
const STAMPS_DIR = '.lumenflow/stamps';

/**
 * Log prefix for orchestrator messages.
 */
const LOG_PREFIX = '[orchestrate:initiative]';

/**
 * WU-2280: Banner separator for ACTION REQUIRED output.
 * Used to make it unambiguous that agents have NOT been spawned yet.
 */
const BANNER_SEPARATOR =
  '==============================================================================';

/**
 * WU-2040: XML tag patterns for Task invocation extraction.
 * Split to avoid XML parsing issues in agent tools.
 */
const ANTML_NS = 'antml:';
const XML_PATTERNS = {
  FUNCTION_CALLS_OPEN: `<${ANTML_NS}function_calls>`,
  FUNCTION_CALLS_CLOSE: `</${ANTML_NS}function_calls>`,
  INVOKE_OPEN: `<${ANTML_NS}invoke`,
  INVOKE_CLOSE: `</${ANTML_NS}invoke>`,
};

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
 * WU-1200: Wave manifest WU status constant.
 *
 * Changed from 'spawned' to 'queued' to prevent confusion.
 * 'spawned' implies an agent was launched, but the manifest is written
 * BEFORE an agent is actually invoked (when the prompt is output, not when
 * the user copies and executes it).
 *
 * Using 'queued' makes it clear the WU is ready to be spawned but not yet running.
 */
const MANIFEST_WU_STATUS = 'queued';

/**
 * Default reason string for deferred WUs when no specific reason is provided.
 * Extracted to constant to avoid sonarjs/no-duplicate-string lint warnings.
 */
const DEFAULT_DEFERRED_REASON = 'waiting for dependencies';

/**
 * WU-1200: Get the status string used in wave manifests for WUs.
 *
 * Returns 'queued' instead of 'spawned' to prevent confusion.
 * A WU is 'queued' in the manifest when the spawn prompt is output,
 * but it's not actually 'spawned' until an agent claims it.
 *
 * @returns {string} The manifest WU status ('queued')
 */
export function getManifestWUStatus(): string {
  return MANIFEST_WU_STATUS;
}

/**
 * WU-1200: Check if a WU has actually been spawned (agent launched).
 *
 * This checks the WU YAML status, not the wave manifest. A WU is considered
 * "actually spawned" only if:
 * - Its YAML status is 'in_progress' (agent has claimed it)
 * - OR its YAML status is 'done' (agent has completed it)
 *
 * Wave manifests can have stale 'spawned' statuses from previous runs where
 * the prompt was output but no agent was ever invoked. This function provides
 * the authoritative check based on YAML status.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-001')
 * @returns {boolean} True if the WU is actually in progress or done
 */
export function isWUActuallySpawned(wuId: string): boolean {
  const wuPath = WU_PATHS.WU(wuId);

  if (!existsSync(wuPath)) {
    // WU file not found - can't determine status, assume not spawned
    return false;
  }

  try {
    const text = readFileSync(wuPath, 'utf8');
    const doc = parseYAML(text);
    const status = doc.status ?? 'unknown';

    // WU is "actually spawned" if status indicates active or completed work
    return status === WU_STATUS.IN_PROGRESS || status === WU_STATUS.DONE;
  } catch {
    // Error reading/parsing WU file - assume not spawned
    return false;
  }
}

/**
 * WU-1200: Get spawn candidates with YAML status verification.
 *
 * Filters WUs to find candidates that can be spawned, checking YAML status
 * instead of relying solely on wave manifests. This prevents stale manifests
 * from blocking new orchestration runs.
 *
 * A WU is a spawn candidate if:
 * - Its YAML status is 'ready' (not in_progress, done, blocked, etc.)
 * - It's in the provided WU list (part of the initiative)
 *
 * This function ignores wave manifest status because:
 * - Manifests can be stale (prompt output but agent never launched)
 * - YAML status is the authoritative source of truth
 *
 * @param {string} _initId - Initiative ID (for logging/context, not used for filtering)
 * @param {Array<{id: string, doc: object}>} wus - WUs to filter
 * @returns {Array<{id: string, doc: object}>} WUs that can be spawned
 */
export function getSpawnCandidatesWithYAMLCheck(_initId: string, wus: WUEntry[]): WUEntry[] {
  // Filter to only 'ready' status WUs based on YAML, not manifest
  return wus.filter((wu) => {
    const status = wu.doc.status ?? 'unknown';
    return status === WU_STATUS.READY;
  });
}

/**
 * Load initiative and its WUs.
 *
 * @param {string} initRef - Initiative ID or slug
 * @returns {{initiative: object, wus: Array<{id: string, doc: object}>}}
 * @throws {Error} If initiative not found
 */
export function loadInitiativeWUs(initRef: string): { initiative: InitiativeDoc; wus: WUEntry[] } {
  const initiative = findInitiative(initRef);

  if (!initiative) {
    throw createError(
      ErrorCodes.INIT_NOT_FOUND,
      `Initiative '${initRef}' not found. Check the ID or slug.`,
      { initRef },
    );
  }

  const wus = getInitiativeWUs(initRef);

  return {
    initiative: initiative.doc,
    wus,
  };
}

/**
 * Load multiple initiatives and combine their WUs.
 *
 * Used for cross-initiative parallel execution.
 *
 * @param {string[]} initRefs - Array of initiative IDs or slugs
 * @returns {Array<{id: string, doc: object}>} Combined WUs from all initiatives
 * @throws {Error} If any initiative not found
 */
export function loadMultipleInitiatives(initRefs: string[]): WUEntry[] {
  const allWUs = [];
  const seenIds = new Set();

  for (const ref of initRefs) {
    const { wus } = loadInitiativeWUs(ref);

    for (const wu of wus) {
      if (!seenIds.has(wu.id)) {
        seenIds.add(wu.id);
        allWUs.push(wu);
      }
    }
  }

  return allWUs;
}

/**
 * Build execution plan from WUs.
 *
 * Groups WUs into waves based on dependencies:
 * - Wave 0: All WUs with no blockers (can run in parallel)
 * - Wave 1: WUs blocked by wave 0 WUs only
 * - Wave N: WUs blocked by wave N-1 WUs
 *
 * WU-2430: Enhanced filtering:
 * - Only schedules status: ready WUs (not blocked/in_progress)
 * - Reports skipped WUs with reasons (skippedWithReasons)
 * - Defers WUs with unstamped external dependencies (deferred)
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to plan
 * @returns {{waves: Array<Array<{id: string, doc: object}>>, skipped: string[], skippedWithReasons: Array<{id: string, reason: string}>, deferred: Array<{id: string, blockedBy: string[], reason: string}>}}
 * @throws {Error} If circular dependencies detected
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- wave-building logic inherently complex
export function buildExecutionPlan(wus: WUEntry[]): ExecutionPlan {
  // WU-2430: Enhanced categorisation of WUs
  const skipped: string[] = []; // IDs of done WUs (backwards compat)
  const skippedWithReasons: SkippedWUEntry[] = []; // WU-2430: Non-ready WUs with reasons
  const deferred: DeferredWUEntry[] = []; // WU-2430: Ready WUs waiting on external blockers

  const doneStatuses = new Set([WU_STATUS.DONE, WU_STATUS.COMPLETED]);

  // Categorise WUs by status
  for (const wu of wus) {
    const status = wu.doc.status ?? 'unknown';
    if (doneStatuses.has(status)) {
      skipped.push(wu.id);
    } else if (status !== WU_STATUS.READY) {
      skippedWithReasons.push({ id: wu.id, reason: `status: ${status}` });
    }
  }

  // WU-2430: Only ready WUs are candidates for execution
  const readyWUs = wus.filter((wu) => wu.doc.status === WU_STATUS.READY);

  if (readyWUs.length === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build a map for quick lookup
  const wuMap = new Map(readyWUs.map((wu) => [wu.id, wu]));
  const wuIds = new Set(wuMap.keys());
  const allWuMap = new Map(wus.map((wu) => [wu.id, wu]));
  const allWuIds = new Set(allWuMap.keys());

  // Build dependency graph for validation (check cycles)
  const graph = buildDependencyGraph();
  const { cycles } = validateGraph(graph);

  // Filter cycles to only those involving our WUs
  const relevantCycles = cycles.filter((cycle: string[]) =>
    cycle.some((id: string) => wuIds.has(id)),
  );

  if (relevantCycles.length > 0) {
    const cycleStr = relevantCycles.map((c: string[]) => c.join(' → ')).join('; ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Circular dependencies detected: ${cycleStr}`, {
      cycles: relevantCycles,
    });
  }

  // WU-2430: Check for external blockers without stamps
  // A WU with blocked_by dependencies that are NOT in the initiative
  // and do NOT have stamps should be deferred
  const deferredIds = new Set<string>();
  const deferredReasons = new Map<string, Set<string>>();
  const deferredBlockers = new Map<string, Set<string>>();

  const addDeferredEntry = (wuId: string, blockers: string[], reason: string): void => {
    deferredIds.add(wuId);
    if (!deferredReasons.has(wuId)) {
      deferredReasons.set(wuId, new Set<string>());
    }
    if (!deferredBlockers.has(wuId)) {
      deferredBlockers.set(wuId, new Set<string>());
    }
    const reasonSet = deferredReasons.get(wuId)!;
    const blockerSet = deferredBlockers.get(wuId)!;
    for (const blockerId of blockers) {
      blockerSet.add(blockerId);
    }
    reasonSet.add(reason);
  };

  for (const wu of readyWUs) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const blockers = getAllDependencies(wu.doc);
    const externalBlockers = blockers.filter((blockerId: string) => !allWuIds.has(blockerId));
    const internalBlockers = blockers.filter((blockerId: string) => allWuIds.has(blockerId));

    if (externalBlockers.length > 0) {
      // Check if any external blockers lack stamps
      const unstampedBlockers = externalBlockers.filter(
        (blockerId: string) => !hasStamp(blockerId),
      );
      if (unstampedBlockers.length > 0) {
        addDeferredEntry(
          wu.id,
          unstampedBlockers,
          `waiting for external: ${unstampedBlockers.join(', ')}`,
        );
      }
    }

    if (internalBlockers.length > 0) {
      const nonReadyInternal = internalBlockers.filter((blockerId) => {
        const blocker = allWuMap.get(blockerId);
        const status = blocker?.doc?.status ?? 'unknown';
        if (status === WU_STATUS.READY) {
          return false;
        }
        return !doneStatuses.has(status);
      });

      if (nonReadyInternal.length > 0) {
        const details = nonReadyInternal.map((blockerId) => {
          const status = allWuMap.get(blockerId)?.doc?.status ?? 'unknown';
          return `${blockerId} (status: ${status})`;
        });
        addDeferredEntry(wu.id, nonReadyInternal, `waiting for internal: ${details.join(', ')}`);
      }
    }
  }

  let hasNewDeferral = true;
  while (hasNewDeferral) {
    hasNewDeferral = false;
    for (const wu of readyWUs) {
      if (deferredIds.has(wu.id)) {
        continue;
      }
      // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
      const blockers = getAllDependencies(wu.doc);
      const deferredInternal = blockers.filter(
        (blockerId) => allWuIds.has(blockerId) && deferredIds.has(blockerId),
      );

      if (deferredInternal.length > 0) {
        const details = deferredInternal.map((blockerId) => {
          const status = allWuMap.get(blockerId)?.doc?.status ?? 'unknown';
          return `${blockerId} (status: ${status})`;
        });
        addDeferredEntry(wu.id, deferredInternal, `waiting for internal: ${details.join(', ')}`);
        hasNewDeferral = true;
      }
    }
  }

  for (const wu of readyWUs) {
    if (deferredIds.has(wu.id)) {
      const blockerSet = deferredBlockers.get(wu.id) || new Set();
      const reasonSet = deferredReasons.get(wu.id) || new Set();
      deferred.push({
        id: wu.id,
        blockedBy: Array.from(blockerSet),
        reason: reasonSet.size > 0 ? Array.from(reasonSet).join('; ') : DEFAULT_DEFERRED_REASON,
      });
    }
  }

  // Remove deferred WUs from candidates
  const schedulableWUs = readyWUs.filter((wu) => !deferredIds.has(wu.id));
  const schedulableMap = new Map(schedulableWUs.map((wu) => [wu.id, wu]));
  const schedulableIds = new Set(schedulableMap.keys());

  if (schedulableIds.size === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build waves using Kahn's algorithm (topological sort by levels)
  // WU-1618: Also enforce lane WIP=1 constraint (no two WUs with same lane in same wave)
  const waves = [];
  const remaining = new Set(schedulableIds);
  const completed = new Set(skipped); // Treat done WUs as completed for dependency resolution

  // Also treat stamped external deps as completed
  for (const wu of wus) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const blockers = getAllDependencies(wu.doc);
    for (const blockerId of blockers) {
      if (!allWuIds.has(blockerId) && hasStamp(blockerId)) {
        completed.add(blockerId);
      }
    }
  }

  while (remaining.size > 0) {
    const wave = [];
    const lanesInWave = new Set(); // WU-1618: Track lanes used in this wave
    const deferredToNextWave = []; // WUs that could run but lane is occupied

    for (const id of remaining) {
      const wu = schedulableMap.get(id)!;
      // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
      const blockers = getAllDependencies(wu.doc);

      // Check if all blockers are either done or completed in previous waves
      const allBlockersDone = blockers.every((blockerId) => completed.has(blockerId));

      if (allBlockersDone) {
        // WU-1618: Check if lane is already occupied in this wave
        const lane = wu.doc.lane;
        if (lanesInWave.has(lane)) {
          // Defer to next wave (lane conflict)
          deferredToNextWave.push(wu);
        } else {
          wave.push(wu);
          lanesInWave.add(lane);
        }
      }
    }

    // Deadlock detection: if no WUs can be scheduled but remaining exist
    // WU-1618: Account for deferred WUs (they can run in next wave, not stuck)
    if (wave.length === 0 && remaining.size > 0 && deferredToNextWave.length === 0) {
      const stuckIds = Array.from(remaining);
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Circular or unresolvable dependencies detected. Stuck WUs: ${stuckIds.join(', ')}`,
        { stuckIds },
      );
    }

    // Add wave and mark WUs as completed
    waves.push(wave);
    for (const wu of wave) {
      remaining.delete(wu.id);
      completed.add(wu.id);
    }
  }

  return { waves, skipped, skippedWithReasons, deferred };
}

/**
 * Build execution plan from WUs asynchronously.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to plan
 * @returns {Promise<ExecutionPlan>}
 */
export async function buildExecutionPlanAsync(wus: WUEntry[]): Promise<ExecutionPlan> {
  // WU-2430: Enhanced categorisation of WUs
  const skipped: string[] = []; // IDs of done WUs (backwards compat)
  const skippedWithReasons: SkippedWUEntry[] = []; // WU-2430: Non-ready WUs with reasons
  const deferred: DeferredWUEntry[] = []; // WU-2430: Ready WUs waiting on external blockers

  const doneStatuses = new Set([WU_STATUS.DONE, WU_STATUS.COMPLETED]);

  // Categorise WUs by status
  for (const wu of wus) {
    const status = wu.doc.status ?? 'unknown';
    if (doneStatuses.has(status)) {
      skipped.push(wu.id);
    } else if (status !== WU_STATUS.READY) {
      skippedWithReasons.push({ id: wu.id, reason: `status: ${status}` });
    }
  }

  // WU-2430: Only ready WUs are candidates for execution
  const readyWUs = wus.filter((wu) => wu.doc.status === WU_STATUS.READY);

  if (readyWUs.length === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build a map for quick lookup
  const wuMap = new Map(readyWUs.map((wu) => [wu.id, wu]));
  const wuIds = new Set(wuMap.keys());
  const allWuMap = new Map(wus.map((wu) => [wu.id, wu]));
  const allWuIds = new Set(allWuMap.keys());

  // Build dependency graph for validation (check cycles)
  const graph = await buildDependencyGraphAsync();
  const { cycles } = validateGraph(graph);

  // Filter cycles to only those involving our WUs
  const relevantCycles = cycles.filter((cycle: string[]) =>
    cycle.some((id: string) => wuIds.has(id)),
  );

  if (relevantCycles.length > 0) {
    const cycleStr = relevantCycles.map((c: string[]) => c.join(' → ')).join('; ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Circular dependencies detected: ${cycleStr}`, {
      cycles: relevantCycles,
    });
  }

  // WU-2430: Check for external blockers without stamps
  // A WU with blocked_by dependencies that are NOT in the initiative
  // and do NOT have stamps should be deferred
  const deferredIds = new Set<string>();
  const deferredReasons = new Map<string, Set<string>>();
  const deferredBlockers = new Map<string, Set<string>>();

  const addDeferredEntry = (wuId: string, blockers: string[], reason: string): void => {
    deferredIds.add(wuId);
    if (!deferredReasons.has(wuId)) {
      deferredReasons.set(wuId, new Set<string>());
    }
    if (!deferredBlockers.has(wuId)) {
      deferredBlockers.set(wuId, new Set<string>());
    }
    const reasonSet = deferredReasons.get(wuId)!;
    const blockerSet = deferredBlockers.get(wuId)!;
    for (const blockerId of blockers) {
      blockerSet.add(blockerId);
    }
    reasonSet.add(reason);
  };

  for (const wu of readyWUs) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const blockers = getAllDependencies(wu.doc);
    const externalBlockers = blockers.filter((blockerId: string) => !allWuIds.has(blockerId));
    const internalBlockers = blockers.filter((blockerId: string) => allWuIds.has(blockerId));

    if (externalBlockers.length > 0) {
      // Check if any external blockers lack stamps
      const unstampedBlockers = externalBlockers.filter(
        (blockerId: string) => !hasStamp(blockerId),
      );
      if (unstampedBlockers.length > 0) {
        addDeferredEntry(
          wu.id,
          unstampedBlockers,
          `waiting for external: ${unstampedBlockers.join(', ')}`,
        );
      }
    }

    if (internalBlockers.length > 0) {
      const nonReadyInternal = internalBlockers.filter((blockerId) => {
        const blocker = allWuMap.get(blockerId);
        const status = blocker?.doc?.status ?? 'unknown';
        if (status === WU_STATUS.READY) {
          return false;
        }
        return !doneStatuses.has(status);
      });

      if (nonReadyInternal.length > 0) {
        const details = nonReadyInternal.map((blockerId) => {
          const status = allWuMap.get(blockerId)?.doc?.status ?? 'unknown';
          return `${blockerId} (status: ${status})`;
        });
        addDeferredEntry(wu.id, nonReadyInternal, `waiting for internal: ${details.join(', ')}`);
      }
    }
  }

  let hasNewDeferral = true;
  while (hasNewDeferral) {
    hasNewDeferral = false;
    for (const wu of readyWUs) {
      if (deferredIds.has(wu.id)) {
        continue;
      }
      // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
      const blockers = getAllDependencies(wu.doc);
      const deferredInternal = blockers.filter(
        (blockerId) => allWuIds.has(blockerId) && deferredIds.has(blockerId),
      );

      if (deferredInternal.length > 0) {
        const details = deferredInternal.map((blockerId) => {
          const status = allWuMap.get(blockerId)?.doc?.status ?? 'unknown';
          return `${blockerId} (status: ${status})`;
        });
        addDeferredEntry(wu.id, deferredInternal, `waiting for internal: ${details.join(', ')}`);
        hasNewDeferral = true;
      }
    }
  }

  for (const wu of readyWUs) {
    if (deferredIds.has(wu.id)) {
      const blockerSet = deferredBlockers.get(wu.id) || new Set();
      const reasonSet = deferredReasons.get(wu.id) || new Set();
      deferred.push({
        id: wu.id,
        blockedBy: Array.from(blockerSet),
        reason: reasonSet.size > 0 ? Array.from(reasonSet).join('; ') : DEFAULT_DEFERRED_REASON,
      });
    }
  }

  // Remove deferred WUs from candidates
  const schedulableWUs = readyWUs.filter((wu) => !deferredIds.has(wu.id));
  const schedulableMap = new Map(schedulableWUs.map((wu) => [wu.id, wu]));
  const schedulableIds = new Set(schedulableMap.keys());

  if (schedulableIds.size === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build waves using Kahn's algorithm (topological sort by levels)
  // WU-1618: Also enforce lane WIP=1 constraint (no two WUs with same lane in same wave)
  const waves: WUEntry[][] = [];
  const remaining = new Set(schedulableIds);
  const completed = new Set(skipped); // Treat done WUs as completed for dependency resolution

  // Also treat stamped external deps as completed
  for (const wu of wus) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const blockers = getAllDependencies(wu.doc);
    for (const blockerId of blockers) {
      if (!allWuIds.has(blockerId) && hasStamp(blockerId)) {
        completed.add(blockerId);
      }
    }
  }

  while (remaining.size > 0) {
    const wave: WUEntry[] = [];
    const lanesInWave = new Set(); // WU-1618: Track lanes used in this wave
    const deferredToNextWave = []; // WUs that could run but lane is occupied

    for (const id of remaining) {
      const wu = schedulableMap.get(id)!;
      // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
      const blockers = getAllDependencies(wu.doc);

      // Check if all blockers are either done or completed in previous waves
      const allBlockersDone = blockers.every((blockerId) => completed.has(blockerId));

      if (allBlockersDone) {
        // WU-1618: Check if lane is already occupied in this wave
        const lane = wu.doc.lane;
        if (lanesInWave.has(lane)) {
          // Defer to next wave (lane conflict)
          deferredToNextWave.push(wu);
        } else {
          wave.push(wu);
          lanesInWave.add(lane);
        }
      }
    }

    // Deadlock detection: if no WUs can be scheduled but remaining exist
    // WU-1618: Account for deferred WUs (they can run in next wave, not stuck)
    if (wave.length === 0 && remaining.size > 0 && deferredToNextWave.length === 0) {
      const stuckIds = Array.from(remaining);
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Circular or unresolvable dependencies detected. Stuck WUs: ${stuckIds.join(', ')}`,
        { stuckIds },
      );
    }

    // Add wave and mark WUs as completed
    waves.push(wave);
    for (const wu of wave) {
      remaining.delete(wu.id);
      completed.add(wu.id);
    }
  }

  return { waves, skipped, skippedWithReasons, deferred };
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
 * Get bottleneck WUs from a set of WUs based on how many downstream WUs they block.
 * A bottleneck is a WU that blocks multiple other WUs.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to analyse
 * @param {number} [limit=5] - Maximum number of bottlenecks to return
 * @returns {Array<{id: string, title: string, blocksCount: number}>} Bottleneck WUs sorted by impact
 */
export function getBottleneckWUs(wus: WUEntry[], limit = 5): BottleneckWU[] {
  // Build a map of WU ID -> count of WUs that depend on it
  const blocksCounts = new Map();

  // Initialise all WUs with 0
  for (const wu of wus) {
    blocksCounts.set(wu.id, 0);
  }

  // Count how many WUs each WU blocks
  for (const wu of wus) {
    // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
    const blockers = getAllDependencies(wu.doc);
    for (const blockerId of blockers) {
      if (blocksCounts.has(blockerId)) {
        blocksCounts.set(blockerId, blocksCounts.get(blockerId) + 1);
      }
    }
  }

  // Convert to array and filter out WUs that don't block anything
  const bottlenecks: BottleneckWU[] = [];
  for (const wu of wus) {
    const blocksCount = blocksCounts.get(wu.id);
    if (blocksCount !== undefined && blocksCount > 0) {
      bottlenecks.push({
        id: wu.id,
        title: wu.doc.title ?? wu.id,
        blocksCount,
      });
    }
  }

  // Sort by blocks count descending
  bottlenecks.sort((a, b) => b.blocksCount - a.blocksCount);

  return bottlenecks.slice(0, limit);
}

/**
 * Format execution plan for display.
 *
 * WU-2430: Enhanced to show skippedWithReasons and deferred WUs.
 *
 * @param {object} initiative - Initiative document
 * @param {{waves: Array<Array<{id: string, doc: object}>>, skipped: string[], skippedWithReasons?: Array<{id: string, reason: string}>, deferred?: Array<{id: string, blockedBy: string[], reason: string}>}} plan - Execution plan
 * @returns {string} Formatted plan output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- display formatting inherently complex
export function formatExecutionPlan(initiative: InitiativeDoc, plan: ExecutionPlan): string {
  const lines = [];

  lines.push(`Initiative: ${initiative.id} — ${initiative.title}`);
  lines.push('');

  if (plan.skipped.length > 0) {
    lines.push(`Skipped (already done): ${plan.skipped.join(', ')}`);
    lines.push('');
  }

  // WU-2430: Show WUs skipped due to non-ready status
  if (plan.skippedWithReasons && plan.skippedWithReasons.length > 0) {
    lines.push('Skipped (not ready):');
    for (const entry of plan.skippedWithReasons) {
      lines.push(`  - ${entry.id}: ${entry.reason}`);
    }
    lines.push('');
  }

  // WU-2430: Show WUs deferred due to unmet dependencies
  if (plan.deferred && plan.deferred.length > 0) {
    lines.push('Deferred (waiting for dependencies):');
    for (const entry of plan.deferred) {
      lines.push(`  - ${entry.id}: ${entry.reason}`);
      if (entry.blockedBy && entry.blockedBy.length > 0) {
        lines.push(`      blocked by: ${entry.blockedBy.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (plan.waves.length === 0) {
    lines.push('No pending WUs to execute.');
    return lines.join(STRING_LITERALS.NEWLINE);
  }

  lines.push(`Execution Plan: ${plan.waves.length} wave(s)`);
  lines.push('');

  // Identify bottleneck WUs (WU-1596)
  const allWUs = plan.waves.flat();
  const bottleneckWUs = getBottleneckWUs(allWUs);

  if (bottleneckWUs.length > 0) {
    lines.push('Bottleneck WUs (prioritise these for fastest unblocking):');
    for (const bottleneck of bottleneckWUs) {
      lines.push(
        `  - ${bottleneck.id}: ${bottleneck.title} [blocks ${bottleneck.blocksCount} WU${bottleneck.blocksCount !== 1 ? 's' : ''}]`,
      );
    }
    lines.push('');
  }

  for (let i = 0; i < plan.waves.length; i++) {
    const wave = plan.waves[i]!;
    lines.push(`Wave ${i} (${wave.length} WU${wave.length !== 1 ? 's' : ''} in parallel):`);

    for (const wu of wave) {
      // WU-1251: Use getAllDependencies to combine blocked_by and dependencies arrays
      const blockers = getAllDependencies(wu.doc);
      const blockerStr = blockers.length > 0 ? ` [blocked by: ${blockers.join(', ')}]` : '';
      // Mark bottleneck WUs (WU-1596)
      const isBottleneck = bottleneckWUs.some((b) => b.id === wu.id);
      const bottleneckMarker = isBottleneck ? ' *BOTTLENECK*' : '';
      lines.push(`  - ${wu.id}: ${wu.doc.title}${blockerStr}${bottleneckMarker}`);
    }

    lines.push('');
  }

  // Add coordination guidance for multi-wave plans (WU-1592)
  if (plan.waves.length > 1) {
    lines.push('Coordination Guidance:');
    lines.push('  - Poll mem:inbox between waves: pnpm mem:inbox --since 10m');
    lines.push('  - Check for bug discoveries from sub-agents');
    lines.push('  - Review signals before proceeding to next wave');
    lines.push('');
  }

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * Generate spawn commands for a wave of WUs.
 *
 * @param {Array<{id: string, doc: object}>} wave - WUs in the wave
 * @returns {string[]} Array of spawn command strings
 */
export function generateSpawnCommands(wave: WUEntry[]): string[] {
  return wave.map((wu) => `pnpm wu:spawn --id ${wu.id}`);
}

/**
 * Calculate progress statistics for WUs.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to calculate progress for
 * @returns {{total: number, done: number, active: number, pending: number, blocked: number, percentage: number}}
 */
export function calculateProgress(wus: WUEntry[]): ProgressStats {
  const stats = {
    total: wus.length,
    done: 0,
    active: 0,
    pending: 0,
    blocked: 0,
    percentage: 0,
  };

  for (const { doc } of wus) {
    switch (doc.status) {
      case WU_STATUS.DONE:
        stats.done++;
        break;
      case WU_STATUS.IN_PROGRESS:
        stats.active++;
        break;
      case WU_STATUS.BLOCKED:
        stats.blocked++;
        break;
      case WU_STATUS.READY:
        stats.pending++;
        break;
      default:
        // Skip other statuses (e.g., cancelled) - counted in total only
        break;
    }
  }

  stats.percentage = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return stats;
}

/**
 * Format progress for display.
 *
 * @param {{total: number, done: number, active: number, pending: number, blocked: number, percentage: number}} progress
 * @returns {string} Formatted progress string
 */
export function formatProgress(progress: ProgressStats): string {
  const bar = createProgressBar(progress.percentage);
  return [
    `Progress: ${bar} ${progress.percentage}%`,
    `  Done: ${progress.done}/${progress.total}`,
    `  Active: ${progress.active}`,
    `  Pending: ${progress.pending}`,
    `  Blocked: ${progress.blocked}`,
  ].join(STRING_LITERALS.NEWLINE);
}

/**
 * Create a visual progress bar.
 *
 * @param {number} percentage - Completion percentage (0-100)
 * @param {number} [width=20] - Bar width in characters
 * @returns {string} Visual progress bar
 */
function createProgressBar(percentage: number, width = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Check if a stamp file exists for a WU.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-001')
 * @returns {boolean} True if stamp exists
 */
function hasStamp(wuId: string): boolean {
  const stampPath = join(STAMPS_DIR, `${wuId}.done`);
  return existsSync(stampPath);
}

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
 * 1. Stamp (highest): .lumenflow/stamps/WU-XXXX.done exists → WU is done
 * 2. Manifest: WU already in previous wave manifest → skip
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

  // WU-1200: Check YAML status, not just wave manifests
  // Wave manifests can be stale (prompt output but agent never launched)
  // YAML status is the authoritative source of truth

  // Filter to spawn candidates:
  // 1. status: ready only (from YAML - authoritative)
  // 2. No stamp exists (idempotency)
  // 3. WU is not actually spawned (YAML status not in_progress/done)
  //
  // Note: We no longer rely on wave manifests for exclusion because:
  // - Manifests can be stale (AC3: Stale wave manifests don't block new runs)
  // - YAML status is updated when an agent actually claims the WU
  const readyCandidates = wus.filter((wu) => {
    // Only ready WUs (YAML status - authoritative)
    if (wu.doc.status !== WU_STATUS.READY) {
      return false;
    }
    // Skip if stamp exists (highest precedence - WU is complete)
    if (hasStamp(wu.id)) {
      return false;
    }
    // WU-1200: Check YAML status, not manifest status
    // If YAML says 'ready', the WU hasn't been claimed yet, so it's spawnable
    // (even if a stale manifest says it was 'spawned')
    return true;
  });

  // If no ready candidates, all work is done
  if (readyCandidates.length === 0) {
    return null;
  }

  // WU-2040: Filter by dependency stamps (wait-for-completion pattern)
  // A WU is only spawnable if ALL its blocked_by dependencies have stamps
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
  // WU-1200: Use 'queued' status instead of 'spawned' to prevent confusion
  // 'queued' indicates the WU is ready to spawn, not that an agent was launched
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

/**
 * Format checkpoint wave output with Task invocations.
 *
 * WU-1821: Token discipline - keep output minimal for context management.
 * WU-2040: Output full Task invocation blocks instead of pnpm wu:spawn meta-prompts.
 * WU-2280: Prevent false wave spawned confusion - use markdown code blocks and ACTION REQUIRED banner.
 * WU-2430: Handle dry-run mode - indicate preview mode clearly.
 *
 * @param {{initiative: string, wave: number, wus: Array<{id: string, lane: string}>, manifestPath: string, blockedBy?: string[], waitingMessage?: string, dryRun?: boolean}} waveData
 * @returns {string} Formatted output with embedded Task invocations
 */
export function formatCheckpointOutput(waveData: CheckpointWaveResult): string {
  const lines = [];
  const isDryRun = waveData.dryRun === true;

  // WU-2040: Handle blocked case with waiting message
  if (waveData.blockedBy && waveData.blockedBy.length > 0) {
    lines.push(`Waiting for dependencies to complete:`);
    for (const depId of waveData.blockedBy) {
      lines.push(`  - ${depId}`);
    }
    lines.push('');
    lines.push(waveData.waitingMessage || 'No WUs can spawn until dependencies have stamps.');
    lines.push('');
    lines.push('Check dependency progress with:');
    lines.push(`  pnpm mem:inbox --since 10m`);
    lines.push(`  pnpm orchestrate:initiative -i ${waveData.initiative} -c`);
    return lines.join(STRING_LITERALS.NEWLINE);
  }

  // WU-2430: Dry-run header
  if (isDryRun) {
    lines.push('[DRY-RUN PREVIEW] Checkpoint mode output (no manifest written)');
    lines.push('');
  }

  lines.push(`Wave ${waveData.wave} manifest: ${waveData.manifestPath}`);
  lines.push(`WUs in this wave: ${waveData.wus.length}`);

  for (const wu of waveData.wus) {
    lines.push(`  - ${wu.id} (${wu.lane})`);
  }

  lines.push('');

  // WU-2280: ACTION REQUIRED banner - per Anthropic skill best practices
  // Make it unambiguous that agents have NOT been spawned yet
  lines.push(BANNER_SEPARATOR);
  lines.push('ACTION REQUIRED: Agents have NOT been spawned yet.');
  lines.push('');
  lines.push('To spawn agents, copy the XML below and invoke the Task tool.');
  lines.push('The output below is documentation only - it will NOT execute automatically.');
  lines.push(BANNER_SEPARATOR);
  lines.push('');

  // WU-2280: Wrap XML in markdown code block to prevent confusion with actual tool calls
  // Raw XML output could be mistaken for a tool invocation by agents
  lines.push('```xml');

  // Build the Task invocation content
  const xmlLines = [];
  xmlLines.push(XML_PATTERNS.FUNCTION_CALLS_OPEN);

  for (const wu of waveData.wus) {
    try {
      // Generate full Task invocation with embedded spawn prompt
      const fullInvocation = generateEmbeddedSpawnPrompt(wu.id);

      // Extract just the inner invoke block (remove outer function_calls wrapper)
      const startIdx = fullInvocation.indexOf(XML_PATTERNS.INVOKE_OPEN);
      const endIdx = fullInvocation.indexOf(XML_PATTERNS.INVOKE_CLOSE);

      if (startIdx !== -1 && endIdx !== -1) {
        const invokeBlock = fullInvocation.substring(
          startIdx,
          endIdx + XML_PATTERNS.INVOKE_CLOSE.length,
        );
        xmlLines.push(invokeBlock);
      }
    } catch {
      // Fallback to simple reference if WU file not found
      xmlLines.push(`<!-- Could not generate Task invocation for ${wu.id} -->`);
    }
  }

  xmlLines.push(XML_PATTERNS.FUNCTION_CALLS_CLOSE);
  lines.push(xmlLines.join(STRING_LITERALS.NEWLINE));

  lines.push('```');

  lines.push('');
  lines.push('Resume with:');
  lines.push(`  pnpm mem:ready --wu WU-ORCHESTRATOR`);
  lines.push(`  pnpm orchestrate:initiative -i ${waveData.initiative} -c`);

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * WU-2027: Generate embedded spawn prompt for a WU.
 *
 * Instead of outputting a meta-prompt like "Run: pnpm wu:spawn --id WU-XXX",
 * this function runs the spawn logic internally and returns the full ~3KB
 * prompt content ready for embedding in a Task invocation.
 *
 * This follows Anthropic guidance that sub-agent prompts must be fully
 * self-contained to prevent delegation failures.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-001')
 * @returns {string} Escaped spawn prompt content ready for XML embedding
 * @throws {Error} If WU file not found or cannot be parsed
 */
export function generateEmbeddedSpawnPrompt(wuId: string): string {
  const wuPath = WU_PATHS.WU(wuId);

  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.WU_NOT_FOUND, `WU file not found: ${wuPath}`, {
      wuId,
      path: wuPath,
    });
  }

  // Read and parse WU YAML
  const text = readFileSync(wuPath, 'utf8');
  const doc = parseYAML(text);

  // Generate the full Task invocation (includes XML wrapper)
  // The prompt is already XML-escaped in generateTaskInvocation
  return generateTaskInvocation(doc, wuId, SpawnStrategyFactory.create('claude-code'));
}

/**
 * WU-2027: Format a Task invocation with embedded spawn content for a WU.
 *
 * Creates a complete Task tool invocation block with the full spawn prompt
 * embedded directly, rather than a meta-prompt referencing wu:spawn.
 *
 * @param {{id: string, doc: object}} wu - WU with id and YAML doc
 * @returns {string} Complete Task invocation with embedded spawn content
 */
export function formatTaskInvocationWithEmbeddedSpawn(wu: WUEntry): string {
  // Generate the full Task invocation for this WU
  return generateTaskInvocation(wu.doc, wu.id, SpawnStrategyFactory.create('claude-code'));
}

/**
 * WU-2027: Format execution plan with embedded spawns (no meta-prompts).
 * WU-2280: Updated to use markdown code blocks and ACTION REQUIRED banner.
 *
 * Generates Task invocation blocks for all WUs in the execution plan,
 * with full spawn content embedded directly. This replaces the meta-prompt
 * pattern that was causing delegation failures.
 *
 * @param {{waves: Array<Array<{id: string, doc: object}>>, skipped: string[]}} plan - Execution plan
 * @returns {string} Formatted output with embedded Task invocations
 */

export function formatExecutionPlanWithEmbeddedSpawns(plan: ExecutionPlan): string {
  const lines = [];

  if (plan.waves.length === 0) {
    return 'No pending WUs to execute.';
  }

  for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex++) {
    const wave = plan.waves[waveIndex]!;
    lines.push(
      `## Wave ${waveIndex} (${wave.length} WU${wave.length !== 1 ? 's' : ''} in parallel)`,
    );
    lines.push('');

    // WU-2280: ACTION REQUIRED banner - per Anthropic skill best practices
    lines.push(BANNER_SEPARATOR);
    lines.push('ACTION REQUIRED: Agents have NOT been spawned yet.');
    lines.push('');
    lines.push('To spawn agents, copy the XML below and invoke the Task tool.');
    lines.push('The output below is documentation only - it will NOT execute automatically.');
    lines.push(BANNER_SEPARATOR);
    lines.push('');

    // WU-2280: Wrap XML in markdown code block to prevent confusion with actual tool calls
    lines.push('```xml');

    // Build parallel spawn block for this wave
    const xmlLines = [];
    const openTag = '<' + 'antml:function_calls>';
    const closeTag = '</' + 'antml:function_calls>';

    xmlLines.push(openTag);

    for (const wu of wave) {
      const fullInvocation = generateTaskInvocation(
        wu.doc,
        wu.id,
        SpawnStrategyFactory.create('claude-code'),
      );

      // Extract just the inner invoke block (remove outer function_calls wrapper)
      // Use indexOf for reliable extraction (regex can have escaping issues)
      const startPattern = '<' + 'antml:invoke';
      const endPattern = '</' + 'antml:invoke>';
      const startIdx = fullInvocation.indexOf(startPattern);
      const endIdx = fullInvocation.indexOf(endPattern);

      if (startIdx !== -1 && endIdx !== -1) {
        let invokeBlock = fullInvocation.substring(startIdx, endIdx + endPattern.length);

        // Add run_in_background parameter for parallel execution
        if (!invokeBlock.includes('run_in_background')) {
          const paramOpen = '<' + 'antml:parameter name="';
          const paramClose = '</' + 'antml:parameter>';
          const invokeTag = '<' + 'antml:invoke name="Task">';
          invokeBlock = invokeBlock.replace(
            invokeTag,
            `${invokeTag}\n${paramOpen}run_in_background">true${paramClose}`,
          );
        }
        xmlLines.push(invokeBlock);
      }
    }

    xmlLines.push(closeTag);
    lines.push(xmlLines.join(STRING_LITERALS.NEWLINE));
    lines.push('```');
    lines.push('');

    if (waveIndex < plan.waves.length - 1) {
      lines.push(`After all Wave ${waveIndex} agents complete, proceed to Wave ${waveIndex + 1}.`);
      lines.push('Before next wave: pnpm mem:inbox --since 10m (check for bug discoveries)');
      lines.push('');
    }
  }

  return lines.join(STRING_LITERALS.NEWLINE);
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

/**
 * WU-1326: Get lock_policy for a lane from configuration.
 *
 * Returns the lock_policy from config if specified, otherwise defaults to 'all'
 * for backward compatibility.
 *
 * @param {string} lane - Lane name (e.g., 'Framework: Core')
 * @param {Record<string, LaneConfig> | undefined} laneConfigs - Lane configurations
 * @returns {LockPolicy} The lock_policy for the lane ('all' | 'active' | 'none')
 */
export function getLockPolicyForLane(
  lane: string,
  laneConfigs?: Record<string, LaneConfig>,
): LockPolicy {
  if (!laneConfigs) {
    return 'all'; // Default for backward compatibility
  }

  const config = laneConfigs[lane];
  if (!config || !config.lock_policy) {
    return 'all'; // Default for unspecified lanes
  }

  return config.lock_policy;
}

/**
 * WU-1326: Check if a WU status holds the lane lock based on lock_policy.
 *
 * - policy=all: both 'in_progress' and 'blocked' hold lane lock
 * - policy=active: only 'in_progress' holds lane lock
 * - policy=none: nothing holds lane lock (no WIP checking)
 *
 * @param {string} status - WU status
 * @param {LockPolicy} policy - Lane lock policy
 * @returns {boolean} True if status holds lane lock
 */
function _statusHoldsLaneLock(status: string, policy: LockPolicy): boolean {
  if (policy === 'none') {
    return false; // No WIP checking
  }

  if (policy === 'active') {
    // Only in_progress holds lane lock
    return status === WU_STATUS.IN_PROGRESS;
  }

  // policy === 'all' (default) - both in_progress and blocked hold lane
  return status === WU_STATUS.IN_PROGRESS || status === WU_STATUS.BLOCKED;
}

/**
 * WU-1326: Build execution plan respecting lock_policy per lane.
 *
 * This is an enhanced version of buildExecutionPlan that respects lock_policy
 * when determining lane occupancy for wave building.
 *
 * When policy=active, blocked WUs do NOT prevent ready WUs in the same lane
 * from being scheduled in the same wave.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to plan
 * @param {LockPolicyOptions} options - Lock policy options including laneConfigs
 * @returns {ExecutionPlan} Execution plan with waves, skipped, and deferred WUs
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- wave-building logic inherently complex
export function buildExecutionPlanWithLockPolicy(
  wus: WUEntry[],
  options: LockPolicyOptions = {},
): ExecutionPlan {
  const { laneConfigs = {} } = options;

  // WU-2430: Enhanced categorisation of WUs
  const skipped: string[] = []; // IDs of done WUs (backwards compat)
  const skippedWithReasons: SkippedWUEntry[] = []; // WU-2430: Non-ready WUs with reasons
  const deferred: DeferredWUEntry[] = []; // WU-2430: Ready WUs waiting on external blockers

  const doneStatuses = new Set([WU_STATUS.DONE, WU_STATUS.COMPLETED]);

  // Categorise WUs by status
  for (const wu of wus) {
    const status = wu.doc.status ?? 'unknown';
    if (doneStatuses.has(status)) {
      skipped.push(wu.id);
    } else if (status !== WU_STATUS.READY) {
      skippedWithReasons.push({ id: wu.id, reason: `status: ${status}` });
    }
  }

  // WU-2430: Only ready WUs are candidates for execution
  const readyWUs = wus.filter((wu) => wu.doc.status === WU_STATUS.READY);

  if (readyWUs.length === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build a map for quick lookup
  const wuMap = new Map(readyWUs.map((wu) => [wu.id, wu]));
  const wuIds = new Set(wuMap.keys());
  const allWuMap = new Map(wus.map((wu) => [wu.id, wu]));
  const allWuIds = new Set(allWuMap.keys());

  // Build dependency graph for validation (check cycles)
  const graph = buildDependencyGraph();
  const { cycles } = validateGraph(graph);

  // Filter cycles to only those involving our WUs
  const relevantCycles = cycles.filter((cycle: string[]) =>
    cycle.some((id: string) => wuIds.has(id)),
  );

  if (relevantCycles.length > 0) {
    const cycleStr = relevantCycles.map((c: string[]) => c.join(' → ')).join('; ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Circular dependencies detected: ${cycleStr}`, {
      cycles: relevantCycles,
    });
  }

  // WU-2430: Check for external blockers without stamps
  const deferredIds = new Set<string>();
  const deferredReasons = new Map<string, Set<string>>();
  const deferredBlockers = new Map<string, Set<string>>();

  const addDeferredEntry = (wuId: string, blockers: string[], reason: string): void => {
    deferredIds.add(wuId);
    let reasonSet = deferredReasons.get(wuId);
    let blockerSet = deferredBlockers.get(wuId);
    if (!reasonSet) {
      reasonSet = new Set<string>();
      deferredReasons.set(wuId, reasonSet);
    }
    if (!blockerSet) {
      blockerSet = new Set<string>();
      deferredBlockers.set(wuId, blockerSet);
    }
    for (const blockerId of blockers) {
      blockerSet.add(blockerId);
    }
    reasonSet.add(reason);
  };

  for (const wu of readyWUs) {
    const blockers = getAllDependencies(wu.doc);
    const externalBlockers = blockers.filter((blockerId: string) => !allWuIds.has(blockerId));
    const internalBlockers = blockers.filter((blockerId: string) => allWuIds.has(blockerId));

    if (externalBlockers.length > 0) {
      const unstampedBlockers = externalBlockers.filter(
        (blockerId: string) => !hasStamp(blockerId),
      );
      if (unstampedBlockers.length > 0) {
        addDeferredEntry(
          wu.id,
          unstampedBlockers,
          `waiting for external: ${unstampedBlockers.join(', ')}`,
        );
      }
    }

    if (internalBlockers.length > 0) {
      const nonReadyInternal = internalBlockers.filter((blockerId) => {
        const blocker = allWuMap.get(blockerId);
        const status = blocker?.doc?.status ?? 'unknown';
        if (status === WU_STATUS.READY) {
          return false;
        }
        return !doneStatuses.has(status);
      });

      if (nonReadyInternal.length > 0) {
        const details = nonReadyInternal.map((blockerId) => {
          const status = allWuMap.get(blockerId)?.doc?.status ?? 'unknown';
          return `${blockerId} (status: ${status})`;
        });
        addDeferredEntry(wu.id, nonReadyInternal, `waiting for internal: ${details.join(', ')}`);
      }
    }
  }

  let hasNewDeferral = true;
  while (hasNewDeferral) {
    hasNewDeferral = false;
    for (const wu of readyWUs) {
      if (deferredIds.has(wu.id)) {
        continue;
      }
      const blockers = getAllDependencies(wu.doc);
      const deferredInternal = blockers.filter(
        (blockerId) => allWuIds.has(blockerId) && deferredIds.has(blockerId),
      );

      if (deferredInternal.length > 0) {
        const details = deferredInternal.map((blockerId) => {
          const status = allWuMap.get(blockerId)?.doc?.status ?? 'unknown';
          return `${blockerId} (status: ${status})`;
        });
        addDeferredEntry(wu.id, deferredInternal, `waiting for internal: ${details.join(', ')}`);
        hasNewDeferral = true;
      }
    }
  }

  for (const wu of readyWUs) {
    if (deferredIds.has(wu.id)) {
      const blockerSet = deferredBlockers.get(wu.id) || new Set();
      const reasonSet = deferredReasons.get(wu.id) || new Set();
      deferred.push({
        id: wu.id,
        blockedBy: Array.from(blockerSet),
        reason: reasonSet.size > 0 ? Array.from(reasonSet).join('; ') : DEFAULT_DEFERRED_REASON,
      });
    }
  }

  // Remove deferred WUs from candidates
  const schedulableWUs = readyWUs.filter((wu) => !deferredIds.has(wu.id));
  const schedulableMap = new Map(schedulableWUs.map((wu) => [wu.id, wu]));
  const schedulableIds = new Set(schedulableMap.keys());

  if (schedulableIds.size === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // WU-1326: Build set of lanes currently occupied based on policy
  // Track which lanes are occupied by in_progress or blocked WUs
  const lanesOccupiedByInProgress = new Set<string>();
  const lanesOccupiedByBlocked = new Set<string>();

  for (const wu of wus) {
    const status = wu.doc.status ?? 'unknown';
    const lane = wu.doc.lane;
    if (lane) {
      if (status === WU_STATUS.IN_PROGRESS) {
        lanesOccupiedByInProgress.add(lane);
      } else if (status === WU_STATUS.BLOCKED) {
        lanesOccupiedByBlocked.add(lane);
      }
    }
  }

  // Build waves using Kahn's algorithm (topological sort by levels)
  // WU-1326: Enforce lane WIP based on lock_policy
  const waves: WUEntry[][] = [];
  const remaining = new Set(schedulableIds);
  const completed = new Set(skipped);

  // Also treat stamped external deps as completed
  for (const wu of wus) {
    const blockers = getAllDependencies(wu.doc);
    for (const blockerId of blockers) {
      if (!allWuIds.has(blockerId) && hasStamp(blockerId)) {
        completed.add(blockerId);
      }
    }
  }

  while (remaining.size > 0) {
    const wave: WUEntry[] = [];
    const lanesInWave = new Set<string>(); // Track lanes used in this wave
    const deferredToNextWave: WUEntry[] = []; // WUs that could run but lane is occupied

    for (const id of remaining) {
      const wu = schedulableMap.get(id);
      if (!wu) continue; // Should not happen - remaining only contains valid IDs
      const blockers = getAllDependencies(wu.doc);

      // Check if all blockers are either done or completed in previous waves
      const allBlockersDone = blockers.every((blockerId) => completed.has(blockerId));

      if (allBlockersDone) {
        const lane = wu.doc.lane ?? '';

        // WU-1326: Get lock_policy for this lane
        const policy = getLockPolicyForLane(lane, laneConfigs);

        // WU-1326: Check if lane is already occupied in this wave
        // Skip this check when policy=none (allows unlimited parallel WUs in same lane)
        if (policy !== 'none' && lanesInWave.has(lane)) {
          // Defer to next wave (lane conflict within this wave)
          deferredToNextWave.push(wu);
          continue;
        }

        // WU-1326: Check if lane is occupied by existing WUs based on policy
        // policy=none: laneBlocked stays false (no WIP checking)
        // policy=active: only in_progress blocks
        // policy=all: both in_progress and blocked block
        let laneBlocked = false;

        if (policy === 'active') {
          // Only in_progress WUs block the lane
          laneBlocked = lanesOccupiedByInProgress.has(lane);
        } else if (policy === 'all') {
          // policy === 'all' (default): both in_progress and blocked block lane
          laneBlocked = lanesOccupiedByInProgress.has(lane) || lanesOccupiedByBlocked.has(lane);
        }
        // policy === 'none': laneBlocked remains false

        if (laneBlocked) {
          // Lane is occupied by existing WU based on policy
          deferredToNextWave.push(wu);
        } else {
          wave.push(wu);
          lanesInWave.add(lane);
        }
      }
    }

    // Deadlock detection: if no WUs can be scheduled but remaining exist
    if (wave.length === 0 && remaining.size > 0 && deferredToNextWave.length === 0) {
      const stuckIds = Array.from(remaining);
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Circular or unresolvable dependencies detected. Stuck WUs: ${stuckIds.join(', ')}`,
        { stuckIds },
      );
    }

    // Add wave and mark WUs as completed
    if (wave.length > 0) {
      waves.push(wave);
      for (const wu of wave) {
        remaining.delete(wu.id);
        completed.add(wu.id);
      }
    }

    // Add deferred WUs back to remaining for next wave (if wave had items)
    // If wave was empty but we have deferred items, we need to make progress
    if (wave.length === 0 && deferredToNextWave.length > 0) {
      // Schedule one deferred WU per lane to make progress
      const processedLanes = new Set<string>();
      for (const wu of deferredToNextWave) {
        const lane = wu.doc.lane ?? '';
        if (!processedLanes.has(lane)) {
          wave.push(wu);
          processedLanes.add(lane);
        }
      }
      if (wave.length > 0) {
        waves.push(wave);
        for (const wu of wave) {
          remaining.delete(wu.id);
          completed.add(wu.id);
        }
      }
    }
  }

  return { waves, skipped, skippedWithReasons, deferred };
}

/**
 * WU-1326: Get lane availability respecting lock_policy.
 *
 * Returns availability status for each lane based on current WU states
 * and configured lock_policy.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to check
 * @param {LockPolicyOptions} options - Lock policy options
 * @returns {Record<string, LaneAvailabilityResult>} Lane availability map
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- lane availability logic with multiple policy branches
export function getLaneAvailability(
  wus: WUEntry[],
  options: LockPolicyOptions = {},
): Record<string, LaneAvailabilityResult> {
  const { laneConfigs = {} } = options;
  const result: Record<string, LaneAvailabilityResult> = {};

  // Group WUs by lane
  const wusByLane = new Map<string, WUEntry[]>();
  for (const wu of wus) {
    const lane = wu.doc.lane;
    if (lane) {
      const laneWUs = wusByLane.get(lane);
      if (laneWUs) {
        laneWUs.push(wu);
      } else {
        wusByLane.set(lane, [wu]);
      }
    }
  }

  // Calculate availability for each lane
  for (const [lane, laneWUs] of wusByLane) {
    const policy = getLockPolicyForLane(lane, laneConfigs);

    let inProgressCount = 0;
    let blockedCount = 0;
    let occupiedBy: string | undefined;

    for (const wu of laneWUs) {
      const status = wu.doc.status ?? 'unknown';
      if (status === WU_STATUS.IN_PROGRESS) {
        inProgressCount++;
        if (!occupiedBy) {
          occupiedBy = wu.id;
        }
      } else if (status === WU_STATUS.BLOCKED) {
        blockedCount++;
        // Only set occupiedBy for blocked if policy=all
        if (policy === 'all' && !occupiedBy) {
          occupiedBy = wu.id;
        }
      }
    }

    // Determine availability based on policy
    let available = false;

    if (policy === 'none') {
      // No WIP checking - always available
      available = true;
      occupiedBy = undefined;
    } else if (policy === 'active') {
      // Only in_progress blocks
      available = inProgressCount === 0;
      if (available) {
        occupiedBy = undefined;
      }
    } else {
      // policy === 'all': both in_progress and blocked block
      available = inProgressCount === 0 && blockedCount === 0;
    }

    result[lane] = {
      available,
      policy,
      occupiedBy,
      blockedCount,
      inProgressCount,
    };
  }

  return result;
}

export { LOG_PREFIX };
