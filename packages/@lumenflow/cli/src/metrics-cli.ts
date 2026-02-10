#!/usr/bin/env node
/**
 * Unified Metrics CLI with subcommands (WU-1110)
 *
 * Provides lanes, dora, and flow metrics subcommands in a single CLI.
 *
 * Usage:
 *   pnpm metrics                          # All metrics, JSON output
 *   pnpm metrics lanes                    # Lane health only
 *   pnpm metrics dora                     # DORA metrics only
 *   pnpm metrics flow                     # Flow state only
 *   pnpm metrics --format table           # Table output
 *   pnpm metrics --days 30                # 30 day window
 *   pnpm metrics --output metrics.json    # Custom output file
 *   pnpm metrics --dry-run                # Preview without writing
 *
 * @module metrics-cli
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import { Command } from 'commander';
import {
  captureMetricsSnapshot,
  calculateDORAMetrics,
  calculateFlowState,
  type MetricsSnapshotInput,
  type WUMetrics,
  type GitCommit,
  type SkipGatesEntry,
  type DORAMetrics,
  type FlowState,
  type LaneHealth,
} from '@lumenflow/metrics';
import { getGitForCwd } from '@lumenflow/core/git-adapter';

import { createWuPaths } from '@lumenflow/core/wu-paths';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[metrics]';

/** Default snapshot output path */
const DEFAULT_OUTPUT = '.lumenflow/snapshots/metrics-latest.json';

const wuPaths = createWuPaths();

/** WU directory relative to repo root */
const WU_DIR = wuPaths.WU_DIR();

/** Skip-gates audit file path */
const SKIP_GATES_PATH = '.lumenflow/skip-gates-audit.ndjson';

/** Valid subcommands */
export type MetricsSubcommand = 'lanes' | 'dora' | 'flow' | 'all';

/** Output format types */
export type MetricsFormat = 'json' | 'table';

/** Parsed command result */
export interface MetricsCommandResult {
  subcommand: MetricsSubcommand;
  days: number;
  format: MetricsFormat;
  output: string;
  dryRun: boolean;
}

/** Lane health result from WUs */
export interface LaneHealthResult {
  lanes: LaneHealth[];
  totalActive: number;
  totalBlocked: number;
  totalCompleted: number;
}

/** DORA calculation input */
export interface DoraCalculationInput {
  commits: GitCommit[];
  wuMetrics: WUMetrics[];
  skipGatesEntries: SkipGatesEntry[];
  weekStart: Date;
  weekEnd: Date;
}

/**
 * Parse command line arguments
 */
export function parseCommand(argv: string[]): MetricsCommandResult {
  let subcommand: MetricsSubcommand = 'all';
  let days = 7;
  let format: MetricsFormat = 'json';
  let output = DEFAULT_OUTPUT;
  let dryRun = false;

  const program = new Command()
    .name('metrics')
    .description('LumenFlow metrics CLI - lanes, dora, flow subcommands')
    .argument('[subcommand]', 'Subcommand: lanes, dora, flow, or all (default)')
    .option('--days <number>', 'Days to analyze (default: 7)', '7')
    .option('--format <type>', 'Output format: json, table (default: json)', 'json')
    .option('--output <path>', `Output file path (default: ${DEFAULT_OUTPUT})`, DEFAULT_OUTPUT)
    .option('--dry-run', 'Preview without writing to file')
    .exitOverride();

  try {
    program.parse(argv);
    const opts = program.opts();
    const args = program.args;

    // Parse subcommand
    if (args.length > 0) {
      const cmd = args[0];
      if (cmd === 'lanes' || cmd === 'dora' || cmd === 'flow' || cmd === 'all') {
        subcommand = cmd;
      }
    }

    days = parseInt(opts.days, 10);
    format = opts.format === 'table' ? 'table' : 'json';
    output = opts.output;
    dryRun = opts.dryRun === true;
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exit(0);
    }
  }

  return { subcommand, days, format, output, dryRun };
}

/**
 * Calculate week date range
 */
function calculateWeekRange(days: number): { weekStart: Date; weekEnd: Date } {
  const weekEnd = new Date();
  weekEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - days);
  weekStart.setHours(0, 0, 0, 0);

  return { weekStart, weekEnd };
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

  return Math.round(diffHours * 10) / 10;
}

/**
 * Load WU metrics from YAML files
 */
async function loadWUMetrics(baseDir: string): Promise<WUMetrics[]> {
  const wuDir = join(baseDir, WU_DIR);
  const wuFiles = await fg('WU-*.yaml', { cwd: wuDir, absolute: true });

  const wuMetrics: WUMetrics[] = [];

  for (const file of wuFiles) {
    try {
      const content = await readFile(file, { encoding: 'utf-8' });
      const wu = parseYaml(content) as Record<string, unknown>;

      // Map WU status to valid WUMetrics status
      const rawStatus = wu.status as string;
      let status: WUMetrics['status'] = 'ready';
      if (rawStatus === 'in_progress') status = 'in_progress';
      else if (rawStatus === 'blocked') status = 'blocked';
      else if (rawStatus === 'waiting') status = 'waiting';
      else if (rawStatus === 'done') status = 'done';
      else if (rawStatus === 'ready') status = 'ready';

      wuMetrics.push({
        id: wu.id as string,
        title: wu.title as string,
        lane: wu.lane as string,
        status,
        priority: wu.priority as string | undefined,
        claimedAt: wu.claimed_at ? new Date(wu.claimed_at as string) : undefined,
        completedAt: wu.completed_at ? new Date(wu.completed_at as string) : undefined,
        cycleTimeHours: calculateCycleTime(wu),
      });
    } catch {
      // Skip invalid WU files
    }
  }

  return wuMetrics;
}

/** Extended git log entry */
interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
}

/**
 * Load git commits from repository
 */
async function loadGitCommits(weekStart: Date, weekEnd: Date): Promise<GitCommit[]> {
  try {
    const git = getGitForCwd();
    const logResult = await git.log({ maxCount: 500 });

    const commits: GitCommit[] = [];

    for (const entry of [...logResult.all] as GitLogEntry[]) {
      const commitDate = new Date(entry.date);
      if (commitDate < weekStart || commitDate > weekEnd) {
        continue;
      }

      const message = entry.message;
      const wuIdMatch = message.match(/\b(WU-\d+)\b/i);
      const wuId = wuIdMatch ? wuIdMatch[1].toUpperCase() : undefined;

      const typeMatch = message.match(/^(feat|fix|docs|chore|refactor|test|style|perf|ci)[(:]?/i);
      const type = typeMatch ? typeMatch[1].toLowerCase() : undefined;

      commits.push({
        hash: entry.hash,
        timestamp: commitDate,
        message,
        type,
        wuId,
      });
    }

    return commits;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not load git commits: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Load skip-gates audit entries
 */
async function loadSkipGatesEntries(baseDir: string): Promise<SkipGatesEntry[]> {
  const auditPath = join(baseDir, SKIP_GATES_PATH);

  if (!existsSync(auditPath)) {
    return [];
  }

  try {
    const content = await readFile(auditPath, { encoding: 'utf-8' });
    const lines = content.split('\n').filter((line) => line.trim());
    const entries: SkipGatesEntry[] = [];

    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        if (raw.timestamp && raw.wu_id && raw.reason && raw.gate) {
          entries.push({
            timestamp: new Date(raw.timestamp as string),
            wuId: raw.wu_id as string,
            reason: raw.reason as string,
            gate: raw.gate as string,
          });
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Calculate lane health from WU metrics
 */
export function calculateLaneHealthFromWUs(wuMetrics: WUMetrics[]): LaneHealthResult {
  // Use captureMetricsSnapshot with 'lanes' type
  const snapshot = captureMetricsSnapshot({
    commits: [],
    wuMetrics,
    skipGatesEntries: [],
    weekStart: new Date(),
    weekEnd: new Date(),
    type: 'lanes',
  });

  return snapshot.lanes ?? { lanes: [], totalActive: 0, totalBlocked: 0, totalCompleted: 0 };
}

/**
 * Calculate DORA metrics from data
 */
export function calculateDoraFromData(input: DoraCalculationInput): DORAMetrics {
  return calculateDORAMetrics(
    input.commits,
    input.skipGatesEntries,
    input.wuMetrics,
    input.weekStart,
    input.weekEnd,
  );
}

/**
 * Calculate flow state from WU metrics
 */
export function calculateFlowFromWUs(wuMetrics: WUMetrics[]): FlowState {
  return calculateFlowState(wuMetrics);
}

/**
 * Format lanes output
 */
export function formatLanesOutput(lanes: LaneHealthResult, format: MetricsFormat): string {
  if (format === 'table') {
    const lines: string[] = [];
    lines.push('LANE HEALTH');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(
      `Total Active: ${lanes.totalActive}  |  Blocked: ${lanes.totalBlocked}  |  Completed: ${lanes.totalCompleted}`,
    );
    lines.push('');
    for (const lane of lanes.lanes) {
      const statusIcon =
        lane.status === 'healthy' ? '[ok]' : lane.status === 'at-risk' ? '[!]' : '[x]';
      lines.push(
        `${statusIcon} ${lane.lane.padEnd(25)} ${lane.wusCompleted} done, ${lane.wusInProgress} active, ${lane.wusBlocked} blocked`,
      );
    }
    return lines.join('\n');
  }

  return JSON.stringify(lanes, null, 2);
}

/**
 * Format DORA output
 */
export function formatDoraOutput(dora: DORAMetrics, format: MetricsFormat): string {
  if (format === 'table') {
    const lines: string[] = [];
    lines.push('DORA METRICS');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(
      `Deployment Frequency: ${dora.deploymentFrequency.deploysPerWeek}/week (${dora.deploymentFrequency.status})`,
    );
    lines.push(
      `Lead Time: ${dora.leadTimeForChanges.medianHours}h median (${dora.leadTimeForChanges.status})`,
    );
    lines.push(
      `Change Failure Rate: ${dora.changeFailureRate.failurePercentage}% (${dora.changeFailureRate.status})`,
    );
    lines.push(
      `MTTR: ${dora.meanTimeToRecovery.averageHours}h (${dora.meanTimeToRecovery.status})`,
    );
    return lines.join('\n');
  }

  return JSON.stringify(dora, null, 2);
}

/**
 * Format flow output
 */
export function formatFlowOutput(flow: FlowState, format: MetricsFormat): string {
  if (format === 'table') {
    const lines: string[] = [];
    lines.push('FLOW STATE');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`Ready: ${flow.ready}  |  In Progress: ${flow.inProgress}`);
    lines.push(`Blocked: ${flow.blocked}  |  Waiting: ${flow.waiting}`);
    lines.push(`Done: ${flow.done}  |  Total Active: ${flow.totalActive}`);
    return lines.join('\n');
  }

  return JSON.stringify(flow, null, 2);
}

/**
 * Run lanes subcommand
 */
export async function runLanesSubcommand(opts: MetricsCommandResult): Promise<void> {
  const baseDir = process.cwd();
  console.log(`${LOG_PREFIX} Calculating lane health...`);

  const wuMetrics = await loadWUMetrics(baseDir);
  console.log(`${LOG_PREFIX} Found ${wuMetrics.length} WUs`);

  const lanes = calculateLaneHealthFromWUs(wuMetrics);
  const output = formatLanesOutput(lanes, opts.format);

  console.log('');
  console.log(output);

  if (!opts.dryRun) {
    await writeOutput(baseDir, opts.output, { type: 'lanes', data: lanes });
  }
}

/**
 * Run dora subcommand
 */
export async function runDoraSubcommand(opts: MetricsCommandResult): Promise<void> {
  const baseDir = process.cwd();
  const { weekStart, weekEnd } = calculateWeekRange(opts.days);

  console.log(`${LOG_PREFIX} Calculating DORA metrics...`);
  console.log(
    `${LOG_PREFIX} Date range: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`,
  );

  const [wuMetrics, commits, skipGatesEntries] = await Promise.all([
    loadWUMetrics(baseDir),
    loadGitCommits(weekStart, weekEnd),
    loadSkipGatesEntries(baseDir),
  ]);

  console.log(`${LOG_PREFIX} Found ${wuMetrics.length} WUs, ${commits.length} commits`);

  const dora = calculateDoraFromData({ commits, wuMetrics, skipGatesEntries, weekStart, weekEnd });
  const output = formatDoraOutput(dora, opts.format);

  console.log('');
  console.log(output);

  if (!opts.dryRun) {
    await writeOutput(baseDir, opts.output, { type: 'dora', data: dora });
  }
}

/**
 * Run flow subcommand
 */
export async function runFlowSubcommand(opts: MetricsCommandResult): Promise<void> {
  const baseDir = process.cwd();
  console.log(`${LOG_PREFIX} Calculating flow state...`);

  const wuMetrics = await loadWUMetrics(baseDir);
  console.log(`${LOG_PREFIX} Found ${wuMetrics.length} WUs`);

  const flow = calculateFlowFromWUs(wuMetrics);
  const output = formatFlowOutput(flow, opts.format);

  console.log('');
  console.log(output);

  if (!opts.dryRun) {
    await writeOutput(baseDir, opts.output, { type: 'flow', data: flow });
  }
}

/**
 * Run all metrics (default)
 */
export async function runAllSubcommand(opts: MetricsCommandResult): Promise<void> {
  const baseDir = process.cwd();
  const { weekStart, weekEnd } = calculateWeekRange(opts.days);

  console.log(`${LOG_PREFIX} Capturing all metrics...`);
  console.log(
    `${LOG_PREFIX} Date range: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`,
  );

  const [wuMetrics, commits, skipGatesEntries] = await Promise.all([
    loadWUMetrics(baseDir),
    loadGitCommits(weekStart, weekEnd),
    loadSkipGatesEntries(baseDir),
  ]);

  console.log(`${LOG_PREFIX} Found ${wuMetrics.length} WUs, ${commits.length} commits`);

  const input: MetricsSnapshotInput = {
    commits,
    wuMetrics,
    skipGatesEntries,
    weekStart,
    weekEnd,
    type: 'all',
  };

  const snapshot = captureMetricsSnapshot(input);

  // Format based on output preference
  if (opts.format === 'table') {
    if (snapshot.dora) {
      console.log('');
      console.log(formatDoraOutput(snapshot.dora, 'table'));
    }
    if (snapshot.lanes) {
      console.log('');
      console.log(formatLanesOutput(snapshot.lanes, 'table'));
    }
    if (snapshot.flow) {
      console.log('');
      console.log(formatFlowOutput(snapshot.flow, 'table'));
    }
  } else {
    console.log('');
    console.log(JSON.stringify(snapshot, null, 2));
  }

  if (!opts.dryRun) {
    await writeOutput(baseDir, opts.output, {
      type: 'all',
      capturedAt: new Date().toISOString(),
      dateRange: {
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
      },
      snapshot,
    });
  }
}

/**
 * Write output to file
 */
async function writeOutput(
  baseDir: string,
  outputPath: string,
  data: Record<string, unknown>,
): Promise<void> {
  const fullPath = join(baseDir, outputPath);
  const outputDir = dirname(fullPath);

  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  await writeFile(fullPath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} Output written to: ${fullPath}`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const opts = parseCommand(process.argv);

  switch (opts.subcommand) {
    case 'lanes':
      await runLanesSubcommand(opts);
      break;
    case 'dora':
      await runDoraSubcommand(opts);
      break;
    case 'flow':
      await runFlowSubcommand(opts);
      break;
    case 'all':
    default:
      await runAllSubcommand(opts);
      break;
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
