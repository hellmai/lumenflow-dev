#!/usr/bin/env node
/**
 * Flow Report Generator CLI (WU-1018)
 *
 * Generates DORA/SPACE flow reports from telemetry and WU data.
 *
 * Usage:
 *   pnpm flow:report                         # Default: last 7 days, JSON output
 *   pnpm flow:report --days 30               # Last 30 days
 *   pnpm flow:report --format table          # Table output
 *   pnpm flow:report --start 2026-01-01 --end 2026-01-15
 *
 * @module flow-report
 * @see {@link @lumenflow/metrics/flow/generate-flow-report}
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import { Command } from 'commander';
import {
  generateFlowReport,
  TELEMETRY_PATHS,
  type FlowReportInput,
  type FlowReportData,
  type GateTelemetryEvent,
  type LLMTelemetryEvent,
  type WUMetrics,
} from '@lumenflow/metrics';

import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[flow:report]';

/** Default report window in days */
const DEFAULT_DAYS = 7;

/** Output format options */
const OUTPUT_FORMATS = {
  JSON: 'json',
  TABLE: 'table',
} as const;

/** WU directory relative to repo root (WU-1301: uses config-based paths) */
const WU_DIR = WU_PATHS.WU_DIR();

/**
 * Parse command line arguments
 */
function parseArgs() {
  const program = new Command()
    .name('flow-report')
    .description('Generate DORA/SPACE flow report from telemetry and WU data')
    .option('--start <date>', 'Start date (YYYY-MM-DD)')
    .option('--end <date>', 'End date (YYYY-MM-DD), defaults to today')
    .option('--days <number>', `Days to report (default: ${DEFAULT_DAYS})`, String(DEFAULT_DAYS))
    .option('--format <type>', `Output format: json, table (default: json)`, OUTPUT_FORMATS.JSON)
    .exitOverride();

  try {
    program.parse(process.argv);
    return program.opts();
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exit(0);
    }
    throw err;
  }
}

/**
 * Calculate date range from options
 */
function calculateDateRange(opts: { start?: string; end?: string; days?: string }): {
  start: Date;
  end: Date;
} {
  const end = opts.end ? new Date(opts.end) : new Date();
  end.setHours(23, 59, 59, 999);

  let start: Date;
  if (opts.start) {
    start = new Date(opts.start);
    start.setHours(0, 0, 0, 0);
  } else {
    const days = parseInt(opts.days ?? String(DEFAULT_DAYS), 10);
    start = new Date(end);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
  }

  return { start, end };
}

/**
 * Read NDJSON file and parse events
 */
async function readNDJSON<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = await readFile(filePath, { encoding: 'utf-8' });
  const lines = content.split('\n').filter((line) => line.trim());
  const events: T[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as T);
    } catch {
      // Skip invalid JSON lines
    }
  }

  return events;
}

/**
 * Transform raw gate event to GateTelemetryEvent type
 */
function transformGateEvent(raw: Record<string, unknown>): GateTelemetryEvent | null {
  if (
    typeof raw.timestamp !== 'string' ||
    typeof raw.gate_name !== 'string' ||
    typeof raw.passed !== 'boolean' ||
    typeof raw.duration_ms !== 'number'
  ) {
    return null;
  }

  return {
    timestamp: raw.timestamp,
    wuId: (raw.wu_id as string) ?? null,
    lane: (raw.lane as string) ?? null,
    gateName: raw.gate_name,
    passed: raw.passed,
    durationMs: raw.duration_ms,
  };
}

/**
 * Transform raw LLM event to LLMTelemetryEvent type
 */
function transformLLMEvent(raw: Record<string, unknown>): LLMTelemetryEvent | null {
  if (
    typeof raw.timestamp !== 'string' ||
    typeof raw.event_type !== 'string' ||
    typeof raw.classification_type !== 'string'
  ) {
    return null;
  }

  const eventType = raw.event_type as LLMTelemetryEvent['eventType'];
  if (
    eventType !== 'llm.classification.start' &&
    eventType !== 'llm.classification.complete' &&
    eventType !== 'llm.classification.error'
  ) {
    return null;
  }

  return {
    timestamp: raw.timestamp,
    eventType,
    classificationType: raw.classification_type,
    durationMs: raw.duration_ms as number | undefined,
    tokensUsed: raw.tokens_used as number | undefined,
    estimatedCostUsd: raw.estimated_cost_usd as number | undefined,
    confidence: raw.confidence as number | undefined,
    fallbackUsed: raw.fallback_used as boolean | undefined,
    fallbackReason: raw.fallback_reason as string | undefined,
    errorType: raw.error_type as string | undefined,
    errorMessage: raw.error_message as string | undefined,
  };
}

/**
 * Load gate telemetry events from file
 */
async function loadGateEvents(baseDir: string): Promise<GateTelemetryEvent[]> {
  const gatesPath = join(baseDir, TELEMETRY_PATHS.GATES);
  const rawEvents = await readNDJSON<Record<string, unknown>>(gatesPath);

  return rawEvents.map(transformGateEvent).filter((e): e is GateTelemetryEvent => e !== null);
}

/**
 * Load LLM telemetry events from file
 */
async function loadLLMEvents(baseDir: string): Promise<LLMTelemetryEvent[]> {
  const llmPath = join(baseDir, TELEMETRY_PATHS.LLM_CLASSIFICATION);
  const rawEvents = await readNDJSON<Record<string, unknown>>(llmPath);

  return rawEvents.map(transformLLMEvent).filter((e): e is LLMTelemetryEvent => e !== null);
}

/**
 * Load completed WUs from YAML files
 */
async function loadCompletedWUs(baseDir: string, start: Date, end: Date): Promise<WUMetrics[]> {
  const wuDir = join(baseDir, WU_DIR);
  const wuFiles = await fg('WU-*.yaml', { cwd: wuDir, absolute: true });

  const completedWUs: WUMetrics[] = [];

  for (const file of wuFiles) {
    try {
      const content = await readFile(file, { encoding: 'utf-8' });
      const wu = parseYaml(content) as Record<string, unknown>;

      if (wu.status !== 'done' || !wu.completed_at) {
        continue;
      }

      const completedAt = new Date(wu.completed_at as string);
      if (completedAt < start || completedAt > end) {
        continue;
      }

      completedWUs.push({
        id: wu.id as string,
        title: wu.title as string,
        lane: wu.lane as string,
        status: 'done',
        claimedAt: wu.claimed_at ? new Date(wu.claimed_at as string) : undefined,
        completedAt,
        cycleTimeHours: calculateCycleTime(wu),
      });
    } catch {
      // Skip invalid WU files
    }
  }

  return completedWUs;
}

/**
 * Calculate cycle time in hours from WU data
 */
function calculateCycleTime(wu: Record<string, unknown>): number | undefined {
  if (!wu.claimed_at || !wu.completed_at) {
    return undefined;
  }

  const claimed = new Date(wu.claimed_at as string);
  const completed = new Date(wu.completed_at as string);
  const diffMs = completed.getTime() - claimed.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  return Math.round(diffHours * 10) / 10; // Round to 1 decimal
}

/**
 * Filter events by date range
 */
function filterByDateRange<T extends { timestamp: string }>(
  events: T[],
  start: Date,
  end: Date,
): T[] {
  return events.filter((event) => {
    const eventDate = new Date(event.timestamp);
    return eventDate >= start && eventDate <= end;
  });
}

/**
 * Format report as table output
 */
function formatAsTable(report: FlowReportData): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`  FLOW REPORT: ${report.range.start} to ${report.range.end}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Gates section
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│ GATES                                                       │');
  lines.push('├─────────────────────────────────────────────────────────────┤');
  lines.push(
    `│ Pass Rate: ${report.gates.passRate}%  |  Total: ${report.gates.total}  |  P95: ${report.gates.p95}ms │`,
  );
  lines.push(`│ Passed: ${report.gates.passed}  |  Failed: ${report.gates.failed}`);
  lines.push('├─────────────────────────────────────────────────────────────┤');
  lines.push('│ By Name:                                                    │');
  for (const [name, stats] of Object.entries(report.gates.byName)) {
    lines.push(`│   ${name.padEnd(20)} ${stats.passRate}% (${stats.passed}/${stats.total})`);
  }
  lines.push('└─────────────────────────────────────────────────────────────┘');
  lines.push('');

  // WUs section
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│ WORK UNITS                                                  │');
  lines.push('├─────────────────────────────────────────────────────────────┤');
  lines.push(`│ Completed: ${report.wus.completed}`);
  lines.push('├─────────────────────────────────────────────────────────────┤');
  for (const wu of report.wus.list.slice(0, 10)) {
    lines.push(
      `│ ${wu.wuId.padEnd(8)} ${wu.completedDate}  ${wu.lane.padEnd(15)} ${wu.title.slice(0, 25)}`,
    );
  }
  if (report.wus.list.length > 10) {
    lines.push(`│ ... and ${report.wus.list.length - 10} more`);
  }
  lines.push('└─────────────────────────────────────────────────────────────┘');
  lines.push('');

  // LLM section
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│ LLM CLASSIFICATION                                          │');
  lines.push('├─────────────────────────────────────────────────────────────┤');
  lines.push(
    `│ Total: ${report.llm.totalClassifications}  |  Error Rate: ${report.llm.errorRate}%`,
  );
  lines.push(`│ Avg Latency: ${report.llm.avgLatencyMs}ms  |  P95: ${report.llm.p95LatencyMs}ms`);
  lines.push(
    `│ Tokens: ${report.llm.totalTokens}  |  Cost: $${report.llm.totalCostUsd.toFixed(4)}`,
  );
  lines.push('└─────────────────────────────────────────────────────────────┘');

  return lines.join('\n');
}

/**
 * Main function
 */
async function main() {
  const opts = parseArgs();
  const baseDir = process.cwd();

  console.log(`${LOG_PREFIX} Generating flow report...`);

  const { start, end } = calculateDateRange(opts);
  console.log(
    `${LOG_PREFIX} Date range: ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
  );

  // Load telemetry and WU data
  const [gateEvents, llmEvents, completedWUs] = await Promise.all([
    loadGateEvents(baseDir),
    loadLLMEvents(baseDir),
    loadCompletedWUs(baseDir, start, end),
  ]);

  // Filter events by date range
  const filteredGateEvents = filterByDateRange(gateEvents, start, end);
  const filteredLLMEvents = filterByDateRange(llmEvents, start, end);

  console.log(`${LOG_PREFIX} Found ${filteredGateEvents.length} gate events`);
  console.log(`${LOG_PREFIX} Found ${filteredLLMEvents.length} LLM events`);
  console.log(`${LOG_PREFIX} Found ${completedWUs.length} completed WUs`);

  // Generate report
  const input: FlowReportInput = {
    gateEvents: filteredGateEvents,
    llmEvents: filteredLLMEvents,
    completedWUs,
    dateRange: {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    },
  };

  const report = generateFlowReport(input);

  // Output report
  console.log('');
  if (opts.format === OUTPUT_FORMATS.TABLE) {
    console.log(formatAsTable(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
