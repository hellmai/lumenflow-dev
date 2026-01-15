/**
 * Calculate WU flow state aggregation
 *
 * Application layer: Business logic for aggregating WU flow states
 *
 * @module @lumenflow/metrics/flow
 */

import type { WUMetrics, FlowState } from '../types.js';

/**
 * Calculate flow state from WU metrics
 */
export function calculateFlowState(wuMetrics: WUMetrics[]): FlowState {
  const ready = wuMetrics.filter((wu) => wu.status === 'ready').length;
  const inProgress = wuMetrics.filter((wu) => wu.status === 'in_progress').length;
  const blocked = wuMetrics.filter((wu) => wu.status === 'blocked').length;
  const waiting = wuMetrics.filter((wu) => wu.status === 'waiting').length;
  const done = wuMetrics.filter((wu) => wu.status === 'done').length;

  const totalActive = ready + inProgress + blocked + waiting;

  return {
    ready,
    inProgress,
    blocked,
    waiting,
    done,
    totalActive,
  };
}
