/**
 * Metrics Snapshot Capture
 *
 * Captures DORA metrics, lane health, and flow state snapshots.
 *
 * @module @lumenflow/metrics/flow
 */

import type { MetricsSnapshot, MetricsSnapshotInput, LaneHealth, WUMetrics } from '../types.js';
import { calculateDORAMetrics } from '../dora/calculate-dora-metrics.js';
import { calculateFlowState } from './calculate-flow-state.js';
import { STATISTICS } from '../dora/constants.js';

/**
 * Determine lane health status based on blocked ratio
 */
function determineLaneStatus(blocked: number, inProgress: number): LaneHealth['status'] {
  if (blocked === 0) return 'healthy';
  if (inProgress > 0 && blocked <= inProgress) return 'at-risk';
  return 'blocked';
}

interface LaneAccumulator {
  lane: string;
  wusCompleted: number;
  wusInProgress: number;
  wusBlocked: number;
  cycleTimes: number[];
}

/**
 * Create empty lane accumulator
 */
function createLaneAccumulator(lane: string): LaneAccumulator {
  return {
    lane,
    wusCompleted: 0,
    wusInProgress: 0,
    wusBlocked: 0,
    cycleTimes: [],
  };
}

/**
 * Update lane accumulator with WU data
 */
function updateLaneAccumulator(acc: LaneAccumulator, wu: WUMetrics): void {
  switch (wu.status) {
    case 'in_progress':
      acc.wusInProgress++;
      break;
    case 'blocked':
      acc.wusBlocked++;
      break;
    case 'done':
      acc.wusCompleted++;
      if (typeof wu.cycleTimeHours === 'number') {
        acc.cycleTimes.push(wu.cycleTimeHours);
      }
      break;
  }
}

/**
 * Calculate median from sorted array
 */
function medianFromSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const midIndex = Math.floor(sorted.length / 2);
  // Use .at() to avoid object injection warning - midIndex is always valid
  return sorted.at(midIndex) ?? 0;
}

/**
 * Convert lane accumulator to health metrics
 */
function accumulatorToHealth(acc: LaneAccumulator): LaneHealth {
  const avgCycleTime =
    acc.cycleTimes.length > 0
      ? acc.cycleTimes.reduce((sum, t) => sum + t, 0) / acc.cycleTimes.length
      : 0;

  const sortedTimes = [...acc.cycleTimes].sort((a, b) => a - b);
  const medianCycleTime = medianFromSorted(sortedTimes);

  const status = determineLaneStatus(acc.wusBlocked, acc.wusInProgress);

  return {
    lane: acc.lane,
    wusCompleted: acc.wusCompleted,
    wusInProgress: acc.wusInProgress,
    wusBlocked: acc.wusBlocked,
    averageCycleTimeHours:
      Math.round(avgCycleTime * STATISTICS.ROUNDING_FACTOR) / STATISTICS.ROUNDING_FACTOR,
    medianCycleTimeHours:
      Math.round(medianCycleTime * STATISTICS.ROUNDING_FACTOR) / STATISTICS.ROUNDING_FACTOR,
    status,
  };
}

/**
 * Calculate lane-level metrics
 */
function calculateLaneMetrics(wuMetrics: WUMetrics[]): {
  lanes: LaneHealth[];
  totalActive: number;
  totalBlocked: number;
  totalCompleted: number;
} {
  const laneMap = new Map<string, LaneAccumulator>();

  for (const wu of wuMetrics) {
    if (!laneMap.has(wu.lane)) {
      laneMap.set(wu.lane, createLaneAccumulator(wu.lane));
    }

    const laneData = laneMap.get(wu.lane);
    if (laneData) {
      updateLaneAccumulator(laneData, wu);
    }
  }

  const laneMetrics = Array.from(laneMap.values()).map(accumulatorToHealth);
  laneMetrics.sort((a, b) => a.lane.localeCompare(b.lane));

  const activeStatuses = ['ready', 'in_progress', 'blocked', 'waiting'];
  const totalActive = wuMetrics.filter((wu) => activeStatuses.includes(wu.status)).length;
  const totalBlocked = wuMetrics.filter((wu) => wu.status === 'blocked').length;
  const totalCompleted = wuMetrics.filter((wu) => wu.status === 'done').length;

  return {
    lanes: laneMetrics,
    totalActive,
    totalBlocked,
    totalCompleted,
  };
}

/**
 * Capture metrics snapshot based on type
 */
export function captureMetricsSnapshot(input: MetricsSnapshotInput): MetricsSnapshot {
  const { commits, wuMetrics, skipGatesEntries, weekStart, weekEnd, type } = input;

  const snapshot: MetricsSnapshot = {};

  if (type === 'all' || type === 'dora') {
    snapshot.dora = calculateDORAMetrics(commits, skipGatesEntries, wuMetrics, weekStart, weekEnd);
  }

  if (type === 'all' || type === 'lanes') {
    snapshot.lanes = calculateLaneMetrics(wuMetrics);
  }

  if (type === 'all' || type === 'flow') {
    snapshot.flow = calculateFlowState(wuMetrics);
  }

  return snapshot;
}
