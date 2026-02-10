#!/usr/bin/env node
/**
 * Metrics Snapshot Capture CLI (WU-1018)
 *
 * Captures DORA metrics, lane health, and flow state snapshots.
 *
 * Usage:
 *   pnpm metrics:snapshot                     # All metrics, JSON output
 *   pnpm metrics:snapshot --type dora         # DORA metrics only
 *   pnpm metrics:snapshot --type lanes        # Lane health only
 *   pnpm metrics:snapshot --type flow         # Flow state only
 *   pnpm metrics:snapshot --dry-run           # Preview without writing
 *   pnpm metrics:snapshot --output metrics.json
 *
 * @module metrics-snapshot
 * @see {@link @lumenflow/metrics/flow/capture-metrics-snapshot}
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import { Command } from 'commander';
import {
  captureMetricsSnapshot,
  type MetricsSnapshotInput,
  type MetricsSnapshot,
  type MetricsSnapshotType,
  type WUMetrics,
  type GitCommit,
  type SkipGatesEntry,
} from '@lumenflow/metrics';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[metrics:snapshot]';

/** Default snapshot output path */
const DEFAULT_OUTPUT = '.lumenflow/snapshots/metrics-latest.json';

/** WU directory relative to repo root (WU-1301: uses config-based paths) */
const WU_DIR = WU_PATHS.WU_DIR();

/** Skip-gates audit file path */
const SKIP_GATES_PATH = '.lumenflow/skip-gates-audit.ndjson';

/** Snapshot type options */
const SNAPSHOT_TYPES: MetricsSnapshotType[] = ['all', 'dora', 'lanes', 'flow'];

/**
 * Parse command line arguments
 */
function parseArgs() {
  const program = new Command()
    .name('metrics-snapshot')
    .description('Capture DORA metrics, lane health, and flow state snapshot')
    .option('--type <type>', `Snapshot type: ${SNAPSHOT_TYPES.join(', ')} (default: all)`, 'all')
    .option('--days <number>', 'Days to analyze for DORA metrics (default: 7)', '7')
    .option('--output <path>', `Output file path (default: ${DEFAULT_OUTPUT})`, DEFAULT_OUTPUT)
    .option('--dry-run', 'Preview snapshot without writing to file')
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

/** Extended git log entry with date field (simple-git returns this but type is narrowed) */
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
    // simple-git log() returns an object with 'all' array containing commits
    // The actual simple-git result includes date but the adapter type is narrowed
    const logResult = await git.log({ maxCount: 500 });

    const commits: GitCommit[] = [];

    for (const entry of [...logResult.all] as GitLogEntry[]) {
      // Filter by date range
      const commitDate = new Date(entry.date);
      if (commitDate < weekStart || commitDate > weekEnd) {
        continue;
      }

      const message = entry.message;

      // Extract WU ID from commit message if present
      const wuIdMatch = message.match(/\b(WU-\d+)\b/i);
      const wuId = wuIdMatch ? wuIdMatch[1].toUpperCase() : undefined;

      // Determine commit type from conventional commit prefix
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
    console.warn(`${LOG_PREFIX} ⚠️  Could not load git commits: ${(err as Error).message}`);
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
 * Format snapshot for display
 */
function formatSnapshot(snapshot: MetricsSnapshot, type: MetricsSnapshotType): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`  METRICS SNAPSHOT (type: ${type})`);
  lines.push(`  Generated: ${new Date().toISOString()}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  if (snapshot.dora) {
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│ DORA METRICS                                                │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    const { deploymentFrequency, leadTimeForChanges, changeFailureRate, meanTimeToRecovery } =
      snapshot.dora;
    lines.push(
      `│ Deployment Frequency: ${deploymentFrequency.deploysPerWeek}/week (${deploymentFrequency.status})`,
    );
    lines.push(
      `│ Lead Time: ${leadTimeForChanges.medianHours}h median (${leadTimeForChanges.status})`,
    );
    lines.push(
      `│ Change Failure Rate: ${changeFailureRate.failurePercentage}% (${changeFailureRate.status})`,
    );
    lines.push(`│ MTTR: ${meanTimeToRecovery.averageHours}h (${meanTimeToRecovery.status})`);
    lines.push('└─────────────────────────────────────────────────────────────┘');
    lines.push('');
  }

  if (snapshot.lanes) {
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│ LANE HEALTH                                                 │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(
      `│ Total Active: ${snapshot.lanes.totalActive}  |  Blocked: ${snapshot.lanes.totalBlocked}  |  Completed: ${snapshot.lanes.totalCompleted}`,
    );
    lines.push('│');
    for (const lane of snapshot.lanes.lanes) {
      const statusIcon = lane.status === 'healthy' ? '✓' : lane.status === 'at-risk' ? '⚠' : '✗';
      lines.push(
        `│ ${statusIcon} ${lane.lane.padEnd(20)} ${lane.wusCompleted} done, ${lane.wusInProgress} active, ${lane.wusBlocked} blocked`,
      );
    }
    lines.push('└─────────────────────────────────────────────────────────────┘');
    lines.push('');
  }

  if (snapshot.flow) {
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│ FLOW STATE                                                  │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│ Ready: ${snapshot.flow.ready}  |  In Progress: ${snapshot.flow.inProgress}`);
    lines.push(`│ Blocked: ${snapshot.flow.blocked}  |  Waiting: ${snapshot.flow.waiting}`);
    lines.push(`│ Done: ${snapshot.flow.done}  |  Total Active: ${snapshot.flow.totalActive}`);
    lines.push('└─────────────────────────────────────────────────────────────┘');
  }

  return lines.join('\n');
}

/**
 * Main function
 */
async function main() {
  const opts = parseArgs();
  const baseDir = process.cwd();
  const type = opts.type as MetricsSnapshotType;
  const days = parseInt(opts.days, 10);

  // Validate snapshot type
  if (!SNAPSHOT_TYPES.includes(type)) {
    die(`Invalid snapshot type: ${type}\n\nValid types: ${SNAPSHOT_TYPES.join(', ')}`);
  }

  console.log(`${LOG_PREFIX} Capturing ${type} metrics snapshot...`);

  const { weekStart, weekEnd } = calculateWeekRange(days);
  console.log(
    `${LOG_PREFIX} Date range: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`,
  );

  // Load data
  console.log(`${LOG_PREFIX} Loading WU data...`);
  const wuMetrics = await loadWUMetrics(baseDir);
  console.log(`${LOG_PREFIX} Found ${wuMetrics.length} WUs`);

  console.log(`${LOG_PREFIX} Loading git commits...`);
  const commits = await loadGitCommits(weekStart, weekEnd);
  console.log(`${LOG_PREFIX} Found ${commits.length} commits`);

  console.log(`${LOG_PREFIX} Loading skip-gates audit entries...`);
  const skipGatesEntries = await loadSkipGatesEntries(baseDir);
  console.log(`${LOG_PREFIX} Found ${skipGatesEntries.length} skip-gates entries`);

  // Capture snapshot
  const input: MetricsSnapshotInput = {
    commits,
    wuMetrics,
    skipGatesEntries,
    weekStart,
    weekEnd,
    type,
  };

  const snapshot = captureMetricsSnapshot(input);

  // Output
  console.log('');
  console.log(formatSnapshot(snapshot, type));
  console.log('');

  // Write to file (unless dry-run)
  if (opts.dryRun) {
    console.log(`${LOG_PREFIX} Dry run - not writing to file.`);
    console.log(`${LOG_PREFIX} Would write to: ${opts.output}`);
  } else {
    const outputPath = join(baseDir, opts.output);
    const outputDir = dirname(outputPath);

    // Ensure directory exists
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    const outputData = {
      capturedAt: new Date().toISOString(),
      type,
      dateRange: {
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
      },
      snapshot,
    };

    await writeFile(outputPath, JSON.stringify(outputData, null, 2), { encoding: 'utf-8' });
    console.log(`${LOG_PREFIX} ✅ Snapshot written to: ${outputPath}`);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
