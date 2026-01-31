#!/usr/bin/env node
/* eslint-disable no-console -- CLI tool requires console output */
/**
 * Orchestrate Monitor CLI (WU-1241)
 *
 * Monitors spawned agent progress and spawn health.
 * Wires CLI to spawn-monitor APIs in @lumenflow/core.
 *
 * Features:
 * - Stuck detection: identifies pending spawns older than threshold
 * - Zombie lock detection: identifies abandoned WU locks (dead PIDs)
 * - Recovery actions: signal agent, restart spawn, escalate to human
 * - Status reporting: active spawns, stuck spawns, zombie locks, suggestions
 *
 * Usage:
 *   pnpm orchestrate:monitor                    # Show spawn status
 *   pnpm orchestrate:monitor --threshold 15    # Custom threshold (15 min)
 *   pnpm orchestrate:monitor --recover          # Run recovery actions
 *   pnpm orchestrate:monitor --recover --dry-run # Show what would be done
 *   pnpm orchestrate:monitor --since 30m        # Show signals since time
 */

import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXIT_CODES,
  LUMENFLOW_PATHS,
  SpawnRegistryStore,
  analyzeSpawns,
  detectStuckSpawns,
  checkZombieLocks,
  generateSuggestions,
  formatMonitorOutput,
  formatRecoveryResults,
  runRecovery,
  processSpawnFailureSignals,
  formatSignalHandlerOutput,
  DEFAULT_THRESHOLD_MINUTES,
} from '@lumenflow/core';
import chalk from 'chalk';
import ms from 'ms';

const LOG_PREFIX = '[orchestrate:monitor]';

/**
 * Monitor options from CLI arguments
 */
export interface MonitorOptions {
  /** Base directory (defaults to cwd) */
  baseDir?: string;
  /** Threshold in minutes for stuck detection (default 30) */
  thresholdMinutes?: number;
  /** Run recovery actions */
  recover?: boolean;
  /** Dry-run mode (show what would be done without taking action) */
  dryRun?: boolean;
  /** Time filter for signals (e.g., "30m", "1h") */
  since?: string;
  /** Filter by WU ID */
  wuId?: string;
}

/**
 * Monitor result containing analysis data
 */
export interface MonitorResult {
  /** Spawn status counts */
  analysis: {
    pending: number;
    completed: number;
    timeout: number;
    crashed: number;
    total: number;
  };
  /** Spawns detected as stuck */
  stuckSpawns: Array<{
    spawn: { id: string; targetWuId: string; lane: string; parentWuId: string };
    ageMinutes: number;
    lastCheckpoint: string | null;
  }>;
  /** Zombie locks (dead PIDs) */
  zombieLocks: Array<{
    wuId: string;
    lane: string;
    pid: number;
    timestamp: string;
  }>;
  /** Recovery suggestions */
  suggestions: Array<{
    command: string;
    reason: string;
  }>;
  /** Recovery results (if recover=true) */
  recoveryResults?: Array<{
    spawnId: string;
    targetWuId: string;
    action: string;
    recovered: boolean;
    reason: string;
    escalation?: { bugWuId: string; title: string };
  }>;
  /** Whether dry-run mode was enabled */
  dryRun?: boolean;
}

/**
 * Runs the spawn monitor.
 *
 * @param options - Monitor options
 * @returns MonitorResult with analysis data
 */
export async function runMonitor(options: MonitorOptions = {}): Promise<MonitorResult> {
  const {
    baseDir = process.cwd(),
    thresholdMinutes = DEFAULT_THRESHOLD_MINUTES,
    recover = false,
    dryRun = false,
  } = options;

  // Load spawn registry
  const stateDir = join(baseDir, LUMENFLOW_PATHS.STATE_DIR.replace('.lumenflow/', ''));
  const store = new SpawnRegistryStore(stateDir);

  let spawns: ReturnType<typeof store.getAllSpawns> = [];
  try {
    await store.load();
    spawns = store.getAllSpawns();
  } catch {
    // Registry doesn't exist or is invalid - continue with empty spawns
  }

  // Run core analysis
  const analysis = analyzeSpawns(spawns);
  const stuckSpawns = detectStuckSpawns(spawns, thresholdMinutes);
  const zombieLocks = await checkZombieLocks({ baseDir });
  const suggestions = generateSuggestions(stuckSpawns, zombieLocks);

  const result: MonitorResult = {
    analysis,
    stuckSpawns,
    zombieLocks,
    suggestions,
    dryRun,
  };

  // Run recovery if requested
  if (recover) {
    const recoveryResults = await runRecovery(stuckSpawns, { baseDir, dryRun });
    result.recoveryResults = recoveryResults;
  }

  return result;
}

/**
 * Formats monitor result for display.
 *
 * @param result - Monitor result to format
 * @returns Formatted output string
 */
export function formatOutput(result: MonitorResult): string {
  const lines: string[] = [];

  // Use core formatMonitorOutput for base formatting
  const baseOutput = formatMonitorOutput(result);
  lines.push(baseOutput);

  // Add recovery results if present
  if (result.recoveryResults && result.recoveryResults.length > 0) {
    lines.push('');
    lines.push(formatRecoveryResults(result.recoveryResults));
  }

  // Add dry-run notice if applicable
  if (result.dryRun) {
    lines.push('');
    lines.push(chalk.yellow('=== DRY RUN MODE ==='));
    lines.push(chalk.yellow('No actions were taken. Remove --dry-run to execute.'));
  }

  return lines.join('\n');
}

// Signal-related types and functions (legacy support)
interface Signal {
  timestamp: string;
  type: string;
  wuId?: string;
  message?: string;
}

function parseTimeString(timeStr: string): Date {
  const msValue = ms(timeStr);
  if (typeof msValue === 'number') {
    return new Date(Date.now() - msValue);
  }
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }
  return date;
}

function loadRecentSignals(since: Date, baseDir: string = process.cwd()): Signal[] {
  const signals: Signal[] = [];
  const memoryDir = join(baseDir, LUMENFLOW_PATHS.MEMORY_DIR.replace('.lumenflow/', ''));

  if (!existsSync(memoryDir)) {
    return signals;
  }

  const files = readdirSync(memoryDir).filter((f) => f.endsWith('.ndjson'));

  for (const file of files) {
    const filePath = join(memoryDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const signal = JSON.parse(line) as Signal;
        const signalTime = new Date(signal.timestamp);
        if (signalTime >= since) {
          signals.push(signal);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return signals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Format signal type with appropriate color
 */
function formatSignalType(signalType: string): string {
  if (signalType === 'complete') {
    return chalk.green(signalType);
  }
  if (signalType === 'error') {
    return chalk.red(signalType);
  }
  return chalk.yellow(signalType);
}

/**
 * Display signals in --signals-only mode
 */
async function displaySignals(opts: { since: string; wu?: string }): Promise<void> {
  const baseDir = process.cwd();
  const since = parseTimeString(opts.since);
  console.log(chalk.cyan(`${LOG_PREFIX} Loading signals since ${since.toISOString()}...`));

  const signals = loadRecentSignals(since, baseDir);

  if (signals.length === 0) {
    console.log(chalk.yellow(`${LOG_PREFIX} No signals found.`));
    console.log(chalk.gray('Agents may still be starting up, or memory layer not initialized.'));
    return;
  }

  const filtered = opts.wu ? signals.filter((s) => s.wuId === opts.wu) : signals;

  console.log(chalk.bold(`\nRecent Signals (${filtered.length}):\n`));

  for (const signal of filtered) {
    const time = new Date(signal.timestamp).toLocaleTimeString();
    const wu = signal.wuId ? chalk.cyan(signal.wuId) : chalk.gray('system');
    const type = formatSignalType(signal.type);
    console.log(`  ${chalk.gray(time)} [${wu}] ${type}: ${signal.message || ''}`);
  }

  console.log('');
  console.log(chalk.gray(`Use: pnpm mem:inbox --since ${opts.since} for more details`));
}

/**
 * Run main spawn monitoring mode
 */
async function runSpawnMonitoring(opts: {
  threshold: string;
  recover: boolean;
  dryRun: boolean;
}): Promise<void> {
  const baseDir = process.cwd();
  const thresholdMinutes = parseInt(opts.threshold, 10);

  if (isNaN(thresholdMinutes) || thresholdMinutes <= 0) {
    console.error(chalk.red(`${LOG_PREFIX} Invalid threshold: ${opts.threshold}`));
    process.exit(EXIT_CODES.FAILURE);
  }

  console.log(chalk.cyan(`${LOG_PREFIX} Analyzing spawn health...`));
  console.log(chalk.gray(`  Threshold: ${thresholdMinutes} minutes`));
  console.log(chalk.gray(`  Recovery: ${opts.recover ? 'enabled' : 'disabled'}`));
  console.log(chalk.gray(`  Dry-run: ${opts.dryRun ? 'yes' : 'no'}`));
  console.log('');

  const result = await runMonitor({
    baseDir,
    thresholdMinutes,
    recover: opts.recover,
    dryRun: opts.dryRun,
  });

  console.log(formatOutput(result));

  if (opts.recover) {
    console.log('');
    console.log(chalk.cyan(`${LOG_PREFIX} Processing spawn failure signals...`));
    const signalResult = await processSpawnFailureSignals({ baseDir, dryRun: opts.dryRun });
    console.log(formatSignalHandlerOutput(signalResult));
  }

  if (result.stuckSpawns.length > 0 || result.zombieLocks.length > 0) {
    process.exit(EXIT_CODES.ERROR);
  }
}

// CLI program
const program = new Command()
  .name('orchestrate:monitor')
  .description('Monitor spawned agent progress and spawn health (WU-1241)')
  .option('--threshold <minutes>', 'Stuck detection threshold in minutes (default: 30)', '30')
  .option('--recover', 'Run recovery actions for stuck spawns', false)
  .option('--dry-run', 'Show what would be done without taking action', false)
  .option('--since <time>', 'Show signals since (e.g., 30m, 1h)', '30m')
  .option('--wu <id>', 'Filter by WU ID')
  .option('--signals-only', 'Only show signals (skip spawn analysis)', false)
  .action(async (opts) => {
    try {
      if (opts.signalsOnly) {
        await displaySignals(opts);
        return;
      }
      await runSpawnMonitoring(opts);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`${LOG_PREFIX} Error: ${message}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
