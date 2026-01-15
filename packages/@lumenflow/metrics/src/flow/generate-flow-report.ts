/**
 * Flow Report Generator
 *
 * Generates DORA/SPACE metrics flow reports from telemetry and WU data.
 *
 * @module @lumenflow/metrics/flow
 */

import { quantile } from 'simple-statistics';
import type {
  FlowReportData,
  FlowReportInput,
  GateTelemetryEvent,
  LLMTelemetryEvent,
  LLMMetrics,
  GateMetricsByName,
} from '../types.js';
import { STATISTICS } from '../dora/constants.js';

const PERCENTAGE_PRECISION = 1;

interface GateStats {
  total: number;
  passed: number;
  failed: number;
  passRate: string;
}

interface LLMTypeStats {
  count: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  fallbackRate: string;
}

/**
 * Round to specified decimal places
 */
function round(value: number, precision: number = PERCENTAGE_PRECISION): string {
  return value.toFixed(precision);
}

/**
 * Calculate gate pass rate
 */
function calculateGatePassRate(events: GateTelemetryEvent[]): {
  passRate: string;
  total: number;
  passed: number;
  failed: number;
} {
  const total = events.length;
  const passed = events.filter((e) => e.passed).length;
  const failed = total - passed;
  const passRate =
    total > 0
      ? round((passed / total) * STATISTICS.PERCENTAGE_MULTIPLIER)
      : '0.0';

  return { passRate, total, passed, failed };
}

/**
 * Calculate gate P95 duration
 */
function calculateGateP95(events: GateTelemetryEvent[]): number {
  if (events.length === 0) return 0;

  const durations = events.map((e) => e.durationMs).sort((a, b) => a - b);
  return quantile(durations, STATISTICS.P95_PERCENTILE);
}

/**
 * Initialize gate statistics for a gate name
 */
function initGateStats(): GateStats {
  return { total: 0, passed: 0, failed: 0, passRate: '0.0' };
}

/**
 * Update gate stats with event data
 */
function updateGateStats(stats: GateStats, passed: boolean): void {
  stats.total++;
  if (passed) {
    stats.passed++;
  } else {
    stats.failed++;
  }
}

/**
 * Calculate pass rate for gate stats
 */
function calculatePassRate(stats: GateStats): void {
  if (stats.total > 0) {
    stats.passRate = round(
      (stats.passed / stats.total) * STATISTICS.PERCENTAGE_MULTIPLIER
    );
  }
}

/**
 * Convert Map to plain object (safe conversion avoiding object injection)
 */
function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of map.entries()) {
    Object.defineProperty(result, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return result;
}

/**
 * Group gates by name with statistics
 */
function groupGatesByName(events: GateTelemetryEvent[]): GateMetricsByName {
  const byNameMap = new Map<string, GateStats>();

  for (const event of events) {
    const name = event.gateName;
    if (!byNameMap.has(name)) {
      byNameMap.set(name, initGateStats());
    }
    const stats = byNameMap.get(name);
    if (stats) {
      updateGateStats(stats, event.passed);
    }
  }

  // Calculate pass rates
  for (const stats of byNameMap.values()) {
    calculatePassRate(stats);
  }

  return mapToObject(byNameMap);
}

/**
 * Calculate LLM error and fallback rates
 */
function calculateLLMRates(
  completeEvents: LLMTelemetryEvent[],
  errorCount: number
): { errorRate: string; fallbackRate: string } {
  const total = completeEvents.length + errorCount;
  const errorRate =
    total > 0
      ? round((errorCount / total) * STATISTICS.PERCENTAGE_MULTIPLIER)
      : '0.0';

  const fallbackCount = completeEvents.filter((e) => e.fallbackUsed).length;
  const fallbackRate =
    completeEvents.length > 0
      ? round(
          (fallbackCount / completeEvents.length) * STATISTICS.PERCENTAGE_MULTIPLIER
        )
      : '0.0';

  return { errorRate, fallbackRate };
}

/**
 * Calculate LLM latency percentiles
 */
function calculateLLMLatencies(completeEvents: LLMTelemetryEvent[]): {
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
} {
  const durations = completeEvents
    .map((e) => e.durationMs)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0 };
  }

  const avgLatencyMs = Math.round(
    durations.reduce((sum, d) => sum + d, 0) / durations.length
  );
  const p50LatencyMs = quantile(durations, STATISTICS.MEDIAN_PERCENTILE);
  const p95LatencyMs = quantile(durations, STATISTICS.P95_PERCENTILE);
  const p99LatencyMs = quantile(durations, STATISTICS.P99_PERCENTILE);

  return { avgLatencyMs, p50LatencyMs, p95LatencyMs, p99LatencyMs };
}

/**
 * Calculate LLM token and cost totals
 */
function calculateLLMCosts(completeEvents: LLMTelemetryEvent[]): {
  totalTokens: number;
  totalCostUsd: number;
  avgConfidence: string;
} {
  const totalTokens = completeEvents.reduce(
    (sum, e) => sum + (e.tokensUsed ?? 0),
    0
  );
  const totalCostUsd = completeEvents.reduce(
    (sum, e) => sum + (e.estimatedCostUsd ?? 0),
    0
  );

  const confidences = completeEvents
    .map((e) => e.confidence)
    .filter((c): c is number => c !== undefined);
  const avgConfidence =
    confidences.length > 0
      ? (confidences.reduce((sum, c) => sum + c, 0) / confidences.length).toFixed(2)
      : '0.00';

  return { totalTokens, totalCostUsd, avgConfidence };
}

/**
 * Initialize LLM type stats
 */
function initLLMTypeStats(): LLMTypeStats {
  return {
    count: 0,
    avgLatencyMs: 0,
    totalCostUsd: 0,
    fallbackRate: '0.0',
  };
}

/**
 * Update LLM type stats with event data
 */
function updateLLMTypeStats(stats: LLMTypeStats, event: LLMTelemetryEvent): void {
  stats.count++;
  stats.avgLatencyMs += event.durationMs ?? 0;
  stats.totalCostUsd += event.estimatedCostUsd ?? 0;
}

/**
 * Calculate averages for LLM type stats
 */
function calculateLLMTypeAverages(
  stats: LLMTypeStats,
  type: string,
  completeEvents: LLMTelemetryEvent[]
): void {
  if (stats.count > 0) {
    stats.avgLatencyMs = Math.round(stats.avgLatencyMs / stats.count);
    const typeFallbacks = completeEvents.filter(
      (e) => e.classificationType === type && e.fallbackUsed
    ).length;
    stats.fallbackRate = round(
      (typeFallbacks / stats.count) * STATISTICS.PERCENTAGE_MULTIPLIER
    );
  }
}

/**
 * Group LLM events by classification type
 */
function groupLLMByType(
  completeEvents: LLMTelemetryEvent[]
): LLMMetrics['byType'] {
  const byTypeMap = new Map<string, LLMTypeStats>();

  for (const event of completeEvents) {
    const type = event.classificationType;
    if (!byTypeMap.has(type)) {
      byTypeMap.set(type, initLLMTypeStats());
    }
    const stats = byTypeMap.get(type);
    if (stats) {
      updateLLMTypeStats(stats, event);
    }
  }

  // Calculate averages and fallback rates
  for (const [type, stats] of byTypeMap.entries()) {
    calculateLLMTypeAverages(stats, type, completeEvents);
  }

  return mapToObject(byTypeMap);
}

/**
 * Calculate LLM classification metrics
 */
function calculateLLMMetrics(events: LLMTelemetryEvent[]): LLMMetrics {
  const completeEvents = events.filter(
    (e) => e.eventType === 'llm.classification.complete'
  );
  const errorEvents = events.filter(
    (e) => e.eventType === 'llm.classification.error'
  );

  if (completeEvents.length === 0) {
    return {
      totalClassifications: 0,
      errorRate: '0.0',
      fallbackRate: '0.0',
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      avgConfidence: '0.00',
      byType: {},
    };
  }

  const { errorRate, fallbackRate } = calculateLLMRates(completeEvents, errorEvents.length);
  const latencies = calculateLLMLatencies(completeEvents);
  const costs = calculateLLMCosts(completeEvents);
  const byType = groupLLMByType(completeEvents);

  return {
    totalClassifications: completeEvents.length,
    errorRate,
    fallbackRate,
    ...latencies,
    ...costs,
    byType,
  };
}

/**
 * Generate flow report from input data
 */
export function generateFlowReport(input: FlowReportInput): FlowReportData {
  const { gateEvents, llmEvents, completedWUs, dateRange } = input;

  const gateStats = calculateGatePassRate(gateEvents);
  const gateP95 = calculateGateP95(gateEvents);
  const byName = groupGatesByName(gateEvents);

  const llmMetrics = calculateLLMMetrics(llmEvents);

  const wuList = completedWUs.map((wu) => ({
    wuId: wu.id,
    completedDate: wu.completedAt?.toISOString().split('T')[0] ?? '',
    lane: wu.lane,
    title: wu.title,
  }));

  return {
    range: dateRange,
    gates: {
      ...gateStats,
      p95: gateP95,
      byName,
    },
    wus: {
      completed: completedWUs.length,
      list: wuList,
    },
    llm: llmMetrics,
  };
}
