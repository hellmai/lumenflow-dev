/**
 * Execution plan building for initiative orchestration.
 *
 * Groups WUs into parallel execution waves based on dependencies using
 * Kahn's algorithm (topological sort by levels).
 *
 * @module orchestrator/execution-planning
 */

import type { WUEntry } from '../initiative-yaml.js';
import type { ExecutionPlan, LockPolicyOptions } from './types.js';
import { getAllDependencies, hasStamp, DEFAULT_DEFERRED_REASON } from './shared.js';
import { getLockPolicyForLane } from './lane-policy.js';
import {
  buildDependencyGraph,
  buildDependencyGraphAsync,
  validateGraph,
} from '@lumenflow/core/dependency-graph';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

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
  const { readyWUs, skipped, skippedWithReasons, deferred, doneStatuses, allWuMap, allWuIds } =
    categoriseWUs(wus);

  if (readyWUs.length === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  const wuMap = new Map(readyWUs.map((wu) => [wu.id, wu]));
  const wuIds = new Set(wuMap.keys());

  // Build dependency graph for validation (check cycles)
  const graph = buildDependencyGraph();
  validateCycles(graph, wuIds);

  // Process deferrals
  const deferredIds = processDeferrals(readyWUs, allWuMap, allWuIds, doneStatuses, deferred);

  // Remove deferred WUs from candidates
  const schedulableWUs = readyWUs.filter((wu) => !deferredIds.has(wu.id));
  const schedulableMap = new Map(schedulableWUs.map((wu) => [wu.id, wu]));
  const schedulableIds = new Set(schedulableMap.keys());

  if (schedulableIds.size === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build waves using Kahn's algorithm (topological sort by levels)
  // WU-1618: Also enforce lane WIP=1 constraint (no two WUs with same lane in same wave)
  const waves = buildWaves(schedulableMap, schedulableIds, skipped, wus, allWuIds);

  return { waves, skipped, skippedWithReasons, deferred };
}

/**
 * Build execution plan from WUs asynchronously.
 *
 * @param {Array<{id: string, doc: object}>} wus - WUs to plan
 * @returns {Promise<ExecutionPlan>}
 */
export async function buildExecutionPlanAsync(wus: WUEntry[]): Promise<ExecutionPlan> {
  const { readyWUs, skipped, skippedWithReasons, deferred, doneStatuses, allWuMap, allWuIds } =
    categoriseWUs(wus);

  if (readyWUs.length === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  const wuMap = new Map(readyWUs.map((wu) => [wu.id, wu]));
  const wuIds = new Set(wuMap.keys());

  // Build dependency graph for validation (check cycles)
  const graph = await buildDependencyGraphAsync();
  validateCycles(graph, wuIds);

  // Process deferrals
  const deferredIds = processDeferrals(readyWUs, allWuMap, allWuIds, doneStatuses, deferred);

  // Remove deferred WUs from candidates
  const schedulableWUs = readyWUs.filter((wu) => !deferredIds.has(wu.id));
  const schedulableMap = new Map(schedulableWUs.map((wu) => [wu.id, wu]));
  const schedulableIds = new Set(schedulableMap.keys());

  if (schedulableIds.size === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // Build waves
  const waves: WUEntry[][] = buildWaves(schedulableMap, schedulableIds, skipped, wus, allWuIds);

  return { waves, skipped, skippedWithReasons, deferred };
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
  const { readyWUs, skipped, skippedWithReasons, deferred, doneStatuses, allWuMap, allWuIds } =
    categoriseWUs(wus);

  if (readyWUs.length === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  const wuMap = new Map(readyWUs.map((wu) => [wu.id, wu]));
  const wuIds = new Set(wuMap.keys());

  // Build dependency graph for validation (check cycles)
  const graph = buildDependencyGraph();
  validateCycles(graph, wuIds);

  // Process deferrals
  const deferredIds = processDeferrals(readyWUs, allWuMap, allWuIds, doneStatuses, deferred);

  // Remove deferred WUs from candidates
  const schedulableWUs = readyWUs.filter((wu) => !deferredIds.has(wu.id));
  const schedulableMap = new Map(schedulableWUs.map((wu) => [wu.id, wu]));
  const schedulableIds = new Set(schedulableMap.keys());

  if (schedulableIds.size === 0) {
    return { waves: [], skipped, skippedWithReasons, deferred };
  }

  // WU-1326: Build set of lanes currently occupied based on policy
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
  addStampedExternalDeps(wus, allWuIds, completed);

  while (remaining.size > 0) {
    const wave: WUEntry[] = [];
    const lanesInWave = new Set<string>();
    const deferredToNextWave: WUEntry[] = [];

    for (const id of remaining) {
      const wu = schedulableMap.get(id);
      if (!wu) continue;
      const blockers = getAllDependencies(wu.doc);

      const allBlockersDone = blockers.every((blockerId) => completed.has(blockerId));

      if (allBlockersDone) {
        const lane = wu.doc.lane ?? '';
        const policy = getLockPolicyForLane(lane, laneConfigs);

        if (policy !== 'none' && lanesInWave.has(lane)) {
          deferredToNextWave.push(wu);
          continue;
        }

        let laneBlocked = false;

        if (policy === 'active') {
          laneBlocked = lanesOccupiedByInProgress.has(lane);
        } else if (policy === 'all') {
          laneBlocked = lanesOccupiedByInProgress.has(lane) || lanesOccupiedByBlocked.has(lane);
        }

        if (laneBlocked) {
          deferredToNextWave.push(wu);
        } else {
          wave.push(wu);
          lanesInWave.add(lane);
        }
      }
    }

    // Deadlock detection
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
    if (wave.length === 0 && deferredToNextWave.length > 0) {
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

// ── Internal helpers ──────────────────────────────────────────────────────────

interface CategorisedWUs {
  readyWUs: WUEntry[];
  skipped: string[];
  skippedWithReasons: { id: string; reason: string }[];
  deferred: { id: string; blockedBy: string[]; reason: string }[];
  doneStatuses: Set<string>;
  allWuMap: Map<string, WUEntry>;
  allWuIds: Set<string>;
}

function categoriseWUs(wus: WUEntry[]): CategorisedWUs {
  const skipped: string[] = [];
  const skippedWithReasons: { id: string; reason: string }[] = [];
  const deferred: { id: string; blockedBy: string[]; reason: string }[] = [];
  const doneStatuses = new Set([WU_STATUS.DONE, WU_STATUS.COMPLETED]);

  for (const wu of wus) {
    const status = wu.doc.status ?? 'unknown';
    if (doneStatuses.has(status)) {
      skipped.push(wu.id);
    } else if (status !== WU_STATUS.READY) {
      skippedWithReasons.push({ id: wu.id, reason: `status: ${status}` });
    }
  }

  const readyWUs = wus.filter((wu) => wu.doc.status === WU_STATUS.READY);
  const allWuMap = new Map(wus.map((wu) => [wu.id, wu]));
  const allWuIds = new Set(allWuMap.keys());

  return { readyWUs, skipped, skippedWithReasons, deferred, doneStatuses, allWuMap, allWuIds };
}

function validateCycles(graph: ReturnType<typeof buildDependencyGraph>, wuIds: Set<string>): void {
  const { cycles } = validateGraph(graph);

  const relevantCycles = cycles.filter((cycle: string[]) =>
    cycle.some((id: string) => wuIds.has(id)),
  );

  if (relevantCycles.length > 0) {
    const cycleStr = relevantCycles.map((c: string[]) => c.join(' \u2192 ')).join('; ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Circular dependencies detected: ${cycleStr}`, {
      cycles: relevantCycles,
    });
  }
}

function processDeferrals(
  readyWUs: WUEntry[],
  allWuMap: Map<string, WUEntry>,
  allWuIds: Set<string>,
  doneStatuses: Set<string>,
  deferred: { id: string; blockedBy: string[]; reason: string }[],
): Set<string> {
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

  return deferredIds;
}

function addStampedExternalDeps(
  wus: WUEntry[],
  allWuIds: Set<string>,
  completed: Set<string>,
): void {
  for (const wu of wus) {
    const blockers = getAllDependencies(wu.doc);
    for (const blockerId of blockers) {
      if (!allWuIds.has(blockerId) && hasStamp(blockerId)) {
        completed.add(blockerId);
      }
    }
  }
}

function buildWaves(
  schedulableMap: Map<string, WUEntry>,
  schedulableIds: Set<string>,
  skipped: string[],
  allWUs: WUEntry[],
  allWuIds: Set<string>,
): WUEntry[][] {
  const waves: WUEntry[][] = [];
  const remaining = new Set(schedulableIds);
  const completed = new Set(skipped);

  // Also treat stamped external deps as completed
  addStampedExternalDeps(allWUs, allWuIds, completed);

  while (remaining.size > 0) {
    const wave: WUEntry[] = [];
    const lanesInWave = new Set();
    const deferredToNextWave: WUEntry[] = [];

    for (const id of remaining) {
      const wu = schedulableMap.get(id)!;
      const blockers = getAllDependencies(wu.doc);

      const allBlockersDone = blockers.every((blockerId) => completed.has(blockerId));

      if (allBlockersDone) {
        const lane = wu.doc.lane;
        if (lanesInWave.has(lane)) {
          deferredToNextWave.push(wu);
        } else {
          wave.push(wu);
          lanesInWave.add(lane);
        }
      }
    }

    // Deadlock detection
    if (wave.length === 0 && remaining.size > 0 && deferredToNextWave.length === 0) {
      const stuckIds = Array.from(remaining);
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Circular or unresolvable dependencies detected. Stuck WUs: ${stuckIds.join(', ')}`,
        { stuckIds },
      );
    }

    waves.push(wave);
    for (const wu of wave) {
      remaining.delete(wu.id);
      completed.add(wu.id);
    }
  }

  return waves;
}
