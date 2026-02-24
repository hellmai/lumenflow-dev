#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Orchestrate Monitor CLI (WU-1241)
 *
 * Monitors delegated agent progress and delegation health.
 * Wires CLI to delegation-monitor APIs in @lumenflow/core.
 * WU-1604: Registry entries can come from explicit delegation intent.
 *
 * Features:
 * - Stuck detection: identifies pending delegations older than threshold
 * - Zombie lock detection: identifies abandoned WU locks (dead PIDs)
 * - Recovery actions: signal agent, restart delegation, escalate to human
 * - Status reporting: active delegations, stuck delegations, zombie locks, suggestions
 *
 * Usage:
 *   pnpm orchestrate:monitor                    # Show delegation status
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
  DelegationRegistryStore,
  analyzeDelegations,
  detectStuckDelegations,
  checkZombieLocks,
  generateSuggestions,
  formatMonitorOutput,
  formatRecoveryResults,
  runRecovery,
  processDelegationFailureSignals,
  formatSignalHandlerOutput,
  DEFAULT_THRESHOLD_MINUTES,
  calculateBackoff,
} from '@lumenflow/core';
import { ProcessExitError, createError, ErrorCodes } from '@lumenflow/core/error-handler';
import type { DelegationEvent } from '@lumenflow/core/delegation-registry-schema';
import chalk from 'chalk';
import ms, { type StringValue } from 'ms';
import { runCLI } from './cli-entry-point.js';

// ============================================================================
// WU-1242: Watch Mode Constants
// ============================================================================

/**
 * Default watch interval (5 minutes in milliseconds)
 */
export const DEFAULT_WATCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Minimum watch interval (1 minute in milliseconds)
 */
export const MIN_WATCH_INTERVAL_MS = 60 * 1000;

/**
 * Maximum backoff interval (1 hour in milliseconds)
 */
export const MAX_BACKOFF_MS = 60 * 60 * 1000;

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
  /** Delegation status counts */
  analysis: {
    pending: number;
    completed: number;
    timeout: number;
    crashed: number;
    total: number;
  };
  /** Delegations detected as stuck */
  stuckDelegations: Array<{
    delegation: DelegationEvent;
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
    delegationId: string;
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
 * Runs the delegation monitor.
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

  // Load delegation registry
  // WU-1278: Use full LUMENFLOW_PATHS.STATE_DIR without stripping .lumenflow/ prefix
  const stateDir = join(baseDir, LUMENFLOW_PATHS.STATE_DIR);
  const store = new DelegationRegistryStore(stateDir);

  let delegations: ReturnType<typeof store.getAllDelegations> = [];
  try {
    await store.load();
    delegations = store.getAllDelegations();
  } catch {
    // Registry doesn't exist or is invalid - continue with empty delegations
  }

  // Run core analysis
  const analysis = analyzeDelegations(delegations);
  const stuckDelegations = detectStuckDelegations(delegations, thresholdMinutes);
  const zombieLocks = await checkZombieLocks({ baseDir });
  const suggestions = generateSuggestions(stuckDelegations, zombieLocks);

  const result: MonitorResult = {
    analysis,
    stuckDelegations,
    zombieLocks,
    suggestions,
    dryRun,
  };

  // Run recovery if requested
  if (recover) {
    const recoveryResults = await runRecovery(stuckDelegations, { baseDir, dryRun });
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
  const msValue = ms(timeStr as StringValue);
  if (typeof msValue === 'number') {
    return new Date(Date.now() - msValue);
  }
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) {
    throw createError(ErrorCodes.INVALID_DURATION, `Invalid time format: ${timeStr}`);
  }
  return date;
}

function loadRecentSignals(since: Date, baseDir: string = process.cwd()): Signal[] {
  const signals: Signal[] = [];
  // WU-1278: Use full LUMENFLOW_PATHS.MEMORY_DIR without stripping .lumenflow/ prefix
  const memoryDir = join(baseDir, LUMENFLOW_PATHS.MEMORY_DIR);

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
 * Run main delegation monitoring mode
 */
async function runDelegationMonitoring(opts: {
  threshold: string;
  recover: boolean;
  dryRun: boolean;
}): Promise<void> {
  const baseDir = process.cwd();
  const thresholdMinutes = parseInt(opts.threshold, 10);

  if (isNaN(thresholdMinutes) || thresholdMinutes <= 0) {
    const message = `${LOG_PREFIX} Invalid threshold: ${opts.threshold}`;
    console.error(chalk.red(message));
    throw new ProcessExitError(message, EXIT_CODES.FAILURE);
  }

  console.log(chalk.cyan(`${LOG_PREFIX} Analyzing delegation health...`));
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
    console.log(chalk.cyan(`${LOG_PREFIX} Processing delegation failure signals...`));
    const signalResult = await processDelegationFailureSignals({ baseDir, dryRun: opts.dryRun });
    console.log(formatSignalHandlerOutput(signalResult));
  }

  if (result.stuckDelegations.length > 0 || result.zombieLocks.length > 0) {
    throw new ProcessExitError(
      `${LOG_PREFIX} Delegation monitor detected stuck delegations or zombie locks.`,
      EXIT_CODES.ERROR,
    );
  }
}

// ============================================================================
// WU-1242: Watch Mode Implementation
// ============================================================================

/**
 * Options for watch mode parsed from CLI args
 */
export interface WatchModeOptions {
  /** Patrol interval in milliseconds */
  intervalMs: number;
}

/**
 * Parses CLI arguments into watch mode options.
 *
 * @param opts - Raw CLI options
 * @returns Parsed watch mode options
 */
export function parseWatchOptions(opts: { interval?: string }): WatchModeOptions {
  let intervalMs = DEFAULT_WATCH_INTERVAL_MS;

  if (opts.interval) {
    // Check if it's a plain number (no unit suffix) - treat as minutes
    if (/^\d+$/.test(opts.interval)) {
      const minutes = parseInt(opts.interval, 10);
      intervalMs = minutes * 60 * 1000;
    } else {
      // Parse with ms library (handles units like "5m", "1h", "30s")
      const parsed = ms(opts.interval as StringValue);
      if (typeof parsed === 'number') {
        intervalMs = parsed;
      }
    }
  }

  // Enforce minimum interval
  if (intervalMs < MIN_WATCH_INTERVAL_MS) {
    intervalMs = MIN_WATCH_INTERVAL_MS;
  }

  return { intervalMs };
}

/**
 * Options for creating a watch mode runner
 */
export interface CreateWatchModeRunnerOptions {
  /** Function to check delegation health */
  checkFn: () => Promise<MonitorResult>;
  /** Patrol interval in milliseconds */
  intervalMs: number;
  /** Optional callback for output */
  onOutput?: (line: string) => void;
}

/**
 * Watch mode runner for continuous delegation monitoring
 */
export interface WatchModeRunner {
  /** Start the patrol loop */
  start(): void;
  /** Stop the patrol loop */
  stop(): void;
  /** Whether the runner is currently running */
  isRunning: boolean;
  /** Current interval (may be increased due to backoff) */
  currentIntervalMs: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
}

/**
 * Formats watch cycle output for display.
 *
 * @param result - Monitor result from the cycle
 * @param cycleNumber - The cycle number (1-indexed)
 * @param timestamp - Timestamp of the cycle
 * @returns Formatted output string
 */
export function formatWatchCycleOutput(
  result: MonitorResult,
  cycleNumber: number,
  timestamp: Date,
): string {
  const lines: string[] = [];

  // Cycle header with timestamp
  const timeStr = timestamp.toISOString().replace('T', ' ').substring(0, 19);
  lines.push(chalk.cyan(`=== Patrol Cycle #${cycleNumber} [${timeStr}] ===`));
  lines.push('');

  // Quick summary
  const { analysis, stuckDelegations, zombieLocks } = result;
  const statusLine = [
    `Pending: ${analysis.pending}`,
    `Completed: ${analysis.completed}`,
    `Stuck: ${stuckDelegations.length}`,
    `Zombies: ${zombieLocks.length}`,
  ].join(' | ');

  if (stuckDelegations.length === 0 && zombieLocks.length === 0) {
    lines.push(chalk.green(`  ${statusLine}`));
    lines.push(chalk.green('  All delegations healthy.'));
  } else {
    lines.push(chalk.yellow(`  ${statusLine}`));

    // Show stuck delegations
    if (stuckDelegations.length > 0) {
      lines.push('');
      lines.push(chalk.yellow('  Stuck delegations:'));
      for (const info of stuckDelegations) {
        lines.push(chalk.yellow(`    - ${info.delegation.targetWuId} (${info.ageMinutes}min)`));
      }
    }

    // Show zombie locks
    if (zombieLocks.length > 0) {
      lines.push('');
      lines.push(chalk.yellow('  Zombie locks:'));
      for (const lock of zombieLocks) {
        lines.push(chalk.yellow(`    - ${lock.lane} (PID ${lock.pid})`));
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Creates a watch mode runner for continuous delegation monitoring.
 *
 * @param options - Configuration options
 * @returns WatchModeRunner instance
 */
export function createWatchModeRunner(options: CreateWatchModeRunnerOptions): WatchModeRunner {
  const { checkFn, intervalMs, onOutput = console.log } = options;

  let currentIntervalMs = intervalMs;
  let consecutiveFailures = 0;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cycleCount = 0;

  function scheduleNext(): void {
    if (!running) return;

    timer = setTimeout(() => {
      // WU-1551: Add .catch() to prevent unhandled promise rejections
      void runCycle()
        .then(() => scheduleNext())
        .catch(() => {
          // Error already handled in runCycle's try/catch.
          // This .catch() is a safety net for unhandled rejections.
          scheduleNext();
        });
    }, currentIntervalMs);
  }

  async function runCycle(): Promise<void> {
    if (!running) return;

    cycleCount++;
    const cycleNumber = cycleCount;

    try {
      const result = await checkFn();

      // Success - reset backoff
      consecutiveFailures = 0;
      currentIntervalMs = intervalMs;

      // Output cycle result
      const output = formatWatchCycleOutput(result, cycleNumber, new Date());
      onOutput(output);
    } catch (error) {
      // Failure - apply backoff
      consecutiveFailures++;
      currentIntervalMs = calculateBackoff(consecutiveFailures, intervalMs);
      if (currentIntervalMs > MAX_BACKOFF_MS) {
        currentIntervalMs = MAX_BACKOFF_MS;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      onOutput(chalk.red(`=== Patrol Cycle #${cycleNumber} ERROR ===`));
      onOutput(chalk.red(`  ${errorMsg}`));
      onOutput(chalk.yellow(`  Next check in ${Math.round(currentIntervalMs / 1000)}s (backoff)`));
      onOutput('');
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      onOutput(chalk.cyan(`${LOG_PREFIX} Starting watch mode (interval: ${intervalMs / 1000}s)`));
      onOutput('');
      scheduleNext();
    },

    stop(): void {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      onOutput(chalk.cyan(`${LOG_PREFIX} Stopping watch mode. Exiting gracefully.`));
    },

    get isRunning(): boolean {
      return running;
    },

    get currentIntervalMs(): number {
      return currentIntervalMs;
    },

    get consecutiveFailures(): number {
      return consecutiveFailures;
    },
  };
}

/**
 * Run watch mode (continuous patrol)
 */
async function runWatchMode(opts: {
  threshold: string;
  interval: string;
  recover: boolean;
  dryRun: boolean;
}): Promise<void> {
  const baseDir = process.cwd();
  const thresholdMinutes = parseInt(opts.threshold, 10);

  if (isNaN(thresholdMinutes) || thresholdMinutes <= 0) {
    const message = `${LOG_PREFIX} Invalid threshold: ${opts.threshold}`;
    console.error(chalk.red(message));
    throw new ProcessExitError(message, EXIT_CODES.FAILURE);
  }

  const watchOptions = parseWatchOptions(opts);

  console.log(chalk.cyan(`${LOG_PREFIX} Starting continuous patrol mode...`));
  console.log(chalk.gray(`  Threshold: ${thresholdMinutes} minutes`));
  console.log(chalk.gray(`  Interval: ${watchOptions.intervalMs / 1000} seconds`));
  console.log(chalk.gray(`  Recovery: ${opts.recover ? 'enabled' : 'disabled'}`));
  console.log(chalk.gray(`  Press Ctrl+C to stop`));
  console.log('');

  const checkFn = async (): Promise<MonitorResult> => {
    return runMonitor({
      baseDir,
      thresholdMinutes,
      recover: opts.recover,
      dryRun: opts.dryRun,
    });
  };

  const runner = createWatchModeRunner({
    checkFn,
    intervalMs: watchOptions.intervalMs,
  });

  // Handle graceful shutdown
  const shutdown = (): void => {
    runner.stop();
    process.exitCode = EXIT_CODES.SUCCESS;
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  runner.start();

  // Keep process alive
  await new Promise(() => {
    // Never resolves - waits for signal
  });
}

// CLI program
const program = new Command()
  .name('orchestrate:monitor')
  .description('Monitor delegated agent progress and delegation health (WU-1241, WU-1242)')
  .option('--threshold <minutes>', 'Stuck detection threshold in minutes (default: 30)', '30')
  .option('--recover', 'Run recovery actions for stuck delegations', false)
  .option('--dry-run', 'Show what would be done without taking action', false)
  .option('--since <time>', 'Show signals since (e.g., 30m, 1h)', '30m')
  .option('--wu <id>', 'Filter by WU ID')
  .option('--signals-only', 'Only show signals (skip delegation analysis)', false)
  .option('--watch', 'Continuous patrol mode (WU-1242)', false)
  .option('--interval <time>', 'Patrol interval for watch mode (e.g., 5m, 10m, 1h)', '5m')
  .action(async (opts) => {
    try {
      if (opts.signalsOnly) {
        await displaySignals(opts);
        return;
      }
      if (opts.watch) {
        await runWatchMode(opts);
        return;
      }
      await runDelegationMonitoring(opts);
    } catch (err: unknown) {
      if (err instanceof ProcessExitError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`${LOG_PREFIX} Error: ${message}`));
      throw new ProcessExitError(message, EXIT_CODES.ERROR);
    }
  });

export async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  void runCLI(main);
}
