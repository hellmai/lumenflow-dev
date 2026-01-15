/**
 * @lumenflow/metrics
 *
 * DORA/SPACE analytics and flow metrics for LumenFlow workflow framework.
 *
 * @module @lumenflow/metrics
 */

export const METRICS_VERSION = '0.1.0';

// Types
export type {
  DORAStatusTier,
  WUMetrics,
  GitCommit,
  SkipGatesEntry,
  DeploymentFrequencyMetrics,
  LeadTimeMetrics,
  ChangeFailureRateMetrics,
  MTTRMetrics,
  DORAMetrics,
  LaneHealth,
  FlowState,
  GateTelemetryEvent,
  LLMTelemetryEvent,
  GateMetricsByName,
  LLMMetrics,
  FlowReportData,
  BottleneckResult,
  CriticalPathResult,
  BottleneckAnalysis,
  DependencyGraphNode,
  MetricsSnapshotType,
  MetricsSnapshot,
  TelemetryEmitFn,
  GateEventInput,
  LLMClassificationStartInput,
  LLMClassificationCompleteInput,
  LLMClassificationErrorInput,
  WUFlowEventInput,
  FlowReportInput,
  MetricsSnapshotInput,
} from './types.js';

// DORA metrics
export {
  calculateDeploymentFrequency,
  calculateLeadTime,
  calculateCFR,
  calculateMTTR,
  calculateDORAMetrics,
  identifyEmergencyFixes,
  DEPLOYMENT_FREQUENCY,
  LEAD_TIME_HOURS,
  CFR_PERCENT,
  MTTR_HOURS,
  STATISTICS,
} from './dora/index.js';

// Flow metrics
export {
  calculateFlowState,
  analyzeBottlenecks,
  criticalPath,
  impactScore,
  topologicalSort,
  getBottleneckAnalysis,
  generateFlowReport,
  captureMetricsSnapshot,
  type DependencyGraph,
} from './flow/index.js';

// Telemetry
export {
  createTelemetryEmitter,
  TELEMETRY_PATHS,
  type TelemetryEmitter,
} from './telemetry/index.js';
