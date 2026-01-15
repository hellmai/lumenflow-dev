/**
 * Flow Metrics Module
 *
 * Flow state calculation, bottleneck analysis, and report generation.
 *
 * @module @lumenflow/metrics/flow
 */

export { calculateFlowState } from './calculate-flow-state.js';

export {
  analyzeBottlenecks,
  criticalPath,
  impactScore,
  topologicalSort,
  getBottleneckAnalysis,
  type DependencyGraph,
} from './analyze-bottlenecks.js';

export { generateFlowReport } from './generate-flow-report.js';

export { captureMetricsSnapshot } from './capture-metrics-snapshot.js';
