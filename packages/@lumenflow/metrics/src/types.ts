/**
 * Types and Interfaces for @lumenflow/metrics
 *
 * DORA/SPACE analytics types for LumenFlow workflow framework.
 * Based on "Accelerate" research by Nicole Forsgren, Jez Humble, Gene Kim.
 *
 * @module @lumenflow/metrics/types
 */

/**
 * Status classification tier for DORA metrics
 * Based on DORA research thresholds.
 */
export type DORAStatusTier = 'elite' | 'high' | 'medium' | 'low';

/**
 * Work Unit lifecycle metadata
 */
export interface WUMetrics {
  id: string;
  title: string;
  lane: string;
  status: 'ready' | 'in_progress' | 'blocked' | 'waiting' | 'done';
  priority?: string;
  claimedAt?: Date;
  completedAt?: Date;
  cycleTimeHours?: number;
}

/**
 * Git commit metadata for deployment frequency and lead time
 */
export interface GitCommit {
  hash: string;
  timestamp: Date;
  message: string;
  type?: string;
  wuId?: string;
}

/**
 * Skip-gates audit entry for Change Failure Rate calculation
 */
export interface SkipGatesEntry {
  timestamp: Date;
  wuId: string;
  reason: string;
  gate: string;
}

/**
 * Deployment Frequency metrics
 */
export interface DeploymentFrequencyMetrics {
  deploysPerWeek: number;
  status: DORAStatusTier;
}

/**
 * Lead Time for Changes metrics
 */
export interface LeadTimeMetrics {
  averageHours: number;
  medianHours: number;
  p90Hours: number;
  status: DORAStatusTier;
}

/**
 * Change Failure Rate metrics
 */
export interface ChangeFailureRateMetrics {
  failurePercentage: number;
  totalDeployments: number;
  failures: number;
  status: DORAStatusTier;
}

/**
 * Mean Time to Recovery metrics
 */
export interface MTTRMetrics {
  averageHours: number;
  incidents: number;
  status: DORAStatusTier;
}

/**
 * Complete DORA metrics report
 */
export interface DORAMetrics {
  deploymentFrequency: DeploymentFrequencyMetrics;
  leadTimeForChanges: LeadTimeMetrics;
  changeFailureRate: ChangeFailureRateMetrics;
  meanTimeToRecovery: MTTRMetrics;
}

/**
 * Per-lane health aggregation
 */
export interface LaneHealth {
  lane: string;
  wusCompleted: number;
  wusInProgress: number;
  wusBlocked: number;
  averageCycleTimeHours: number;
  medianCycleTimeHours: number;
  status: 'healthy' | 'at-risk' | 'blocked';
}

/**
 * WU flow state aggregation
 */
export interface FlowState {
  ready: number;
  inProgress: number;
  blocked: number;
  waiting: number;
  done: number;
  totalActive: number;
}

/**
 * Gate execution telemetry event
 */
export interface GateTelemetryEvent {
  timestamp: string;
  wuId: string | null;
  lane: string | null;
  gateName: string;
  passed: boolean;
  durationMs: number;
}

/**
 * LLM classification telemetry event
 */
export interface LLMTelemetryEvent {
  timestamp: string;
  eventType:
    | 'llm.classification.start'
    | 'llm.classification.complete'
    | 'llm.classification.error';
  classificationType: string;
  durationMs?: number;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  confidence?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  errorType?: string;
  errorMessage?: string;
}

/**
 * Gate metrics by name for flow report
 */
export interface GateMetricsByName {
  [gateName: string]: {
    total: number;
    passed: number;
    failed: number;
    passRate: string;
  };
}

/**
 * LLM metrics summary
 */
export interface LLMMetrics {
  totalClassifications: number;
  errorRate: string;
  fallbackRate: string;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  avgConfidence: string;
  byType: {
    [type: string]: {
      count: number;
      avgLatencyMs: number;
      totalCostUsd: number;
      fallbackRate: string;
    };
  };
}

/**
 * Flow report data structure
 */
export interface FlowReportData {
  range: {
    start: string;
    end: string;
  };
  gates: {
    passRate: string;
    total: number;
    passed: number;
    failed: number;
    p95: number;
    byName: GateMetricsByName;
  };
  wus: {
    completed: number;
    list: Array<{
      wuId: string;
      completedDate: string;
      lane: string;
      title: string;
    }>;
  };
  llm: LLMMetrics;
}

/**
 * Bottleneck analysis result
 */
export interface BottleneckResult {
  id: string;
  score: number;
  title?: string;
}

/**
 * Critical path result
 */
export interface CriticalPathResult {
  path: string[];
  length: number;
  warning?: string;
  cycleNodes?: string[];
}

/**
 * Bottleneck analysis output
 */
export interface BottleneckAnalysis {
  bottlenecks: BottleneckResult[];
  criticalPath: CriticalPathResult;
}

/**
 * Dependency graph node
 */
export interface DependencyGraphNode {
  id: string;
  title: string;
  blocks: string[];
  blockedBy: string[];
  status: string;
}

/**
 * Metrics snapshot types
 */
export type MetricsSnapshotType = 'dora' | 'lanes' | 'flow' | 'all';

/**
 * Metrics snapshot data
 */
export interface MetricsSnapshot {
  dora?: DORAMetrics;
  lanes?: {
    lanes: LaneHealth[];
    totalActive: number;
    totalBlocked: number;
    totalCompleted: number;
  };
  flow?: FlowState;
}

/**
 * Telemetry emit function type
 */
export type TelemetryEmitFn = (filePath: string, event: Record<string, unknown>) => void;

/**
 * Input for gate event emission
 */
export interface GateEventInput {
  wuId?: string | null;
  lane?: string | null;
  gateName: string;
  passed: boolean;
  durationMs: number;
}

/**
 * Input for LLM classification start
 */
export interface LLMClassificationStartInput {
  classificationType: string;
  hasContext?: boolean;
  wuId?: string;
  lane?: string;
}

/**
 * Input for LLM classification complete
 */
export interface LLMClassificationCompleteInput {
  classificationType: string;
  durationMs: number;
  tokensUsed: number;
  estimatedCostUsd: number;
  confidence: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  wuId?: string;
  lane?: string;
}

/**
 * Input for LLM classification error
 */
export interface LLMClassificationErrorInput {
  classificationType: string;
  errorType: string;
  errorMessage: string;
  durationMs?: number;
  inputTextPreview?: string;
  wuId?: string;
  lane?: string;
}

/**
 * Input for WU flow event
 */
export interface WUFlowEventInput {
  script: string;
  wuId?: string;
  lane?: string;
  step?: string;
  [key: string]: unknown;
}

/**
 * Input for flow report generation
 */
export interface FlowReportInput {
  gateEvents: GateTelemetryEvent[];
  llmEvents: LLMTelemetryEvent[];
  completedWUs: WUMetrics[];
  dateRange: { start: string; end: string };
}

/**
 * Input for metrics snapshot capture
 */
export interface MetricsSnapshotInput {
  commits: GitCommit[];
  wuMetrics: WUMetrics[];
  skipGatesEntries: SkipGatesEntry[];
  weekStart: Date;
  weekEnd: Date;
  type: MetricsSnapshotType;
}
