#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Inbox CLI (WU-1474)
 *
 * Read coordination signals from other agents for real-time awareness
 * of parallel agent progress. Filter by lane, WU, or time range.
 * Supports watch mode for continuous monitoring.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * WU-2202: Added dependency validation before operations to prevent silent
 * failures when node_modules is corrupted or incomplete.
 *
 * Usage:
 *   pnpm mem:inbox [--lane <name>] [--wu <id>] [--since <time>] [--watch]
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-signal-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-inbox.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import ms from 'ms';
import { watch as chokidarWatch } from 'chokidar';
import { loadSignals, markSignalsAsRead } from '@lumenflow/memory/signal';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import {
  validateInboxDependencies,
  formatDependencyError,
} from '@lumenflow/core/dependency-validator';
import { getErrorMessage } from '@lumenflow/core/error-handler';
import { runCLI } from './cli-entry-point.js';

/**
 * WU-2119: Signal shape returned by loadSignals.
 */
interface Signal {
  id: string;
  message: string;
  created_at?: string;
  wu_id?: string;
  lane?: string;
  read?: boolean;
}

/**
 * Log prefix for mem:inbox output
 */
const LOG_PREFIX = '[mem:inbox]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:inbox';

/**
 * Signals file name within the memory directory
 */
const SIGNALS_FILE_NAME = 'signals.jsonl';

/**
 * CLI argument options specific to mem:inbox
 */
const CLI_OPTIONS = {
  since: {
    name: 'since',
    flags: '-s, --since <time>',
    description: 'Filter signals since time (e.g., "1h", "30m", "2025-12-09")',
  },
  watch: {
    name: 'watch',
    flags: '-w, --watch',
    description: 'Continuously monitor for new signals',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except signal content',
  },
  noMark: {
    name: 'noMark',
    flags: '--no-mark',
    description: 'Do not mark signals as read after display',
    isNegated: true,
  },
  count: {
    name: 'count',
    flags: '-c, --count',
    description: 'Output only signal count (lightweight polling for orchestrators)',
  },
};

/**
 * Write audit log entry for tool execution
 *
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const logPath = path.join(baseDir, LUMENFLOW_PATHS.AUDIT_LOG);
    const logDir = path.dirname(logPath);

    await fs.mkdir(logDir, { recursive: true });

    const line = `${JSON.stringify(entry)}\n`;

    await fs.appendFile(logPath, line, 'utf-8');
  } catch {
    // Audit logging is non-fatal - silently ignore errors
  }
}

/**
 * Format signal count for --count flag output
 * WU-2401: Lightweight polling for orchestrators
 *
 * @param {number} count - Number of unread signals
 * @returns {string} Formatted count string
 */
export function formatCount(count: number): string {
  return `${count} unread signal(s)`;
}

/**
 * Parse relative time string to Date object
 * WU-1849: Replaced custom regex with ms package
 *
 * @param {string} timeStr - Time string like "1h", "30m", "2d", or ISO date
 * @returns {Date} Parsed date
 */
export function parseTimeString(timeStr: string): Date {
  // Try using ms package for relative time parsing (e.g., "1h", "30m", "2d", "1d")
  // Cast to ms.StringValue — runtime validation follows (typeof check + Date fallback)
  const msValue = ms(timeStr as ms.StringValue);
  if (typeof msValue === 'number') {
    return new Date(Date.now() - msValue);
  }

  // Try ISO date or other date format
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid time format: ${timeStr}. Use "1h", "30m", "2d", or ISO date.`);
  }
  return date;
}

/**
 * Format a signal for display
 *
 * @param {object} signal - Signal object
 * @returns {string} Formatted signal string
 */
function formatSignal(signal: Signal): string {
  const timestamp = new Date(signal.created_at ?? '').toLocaleString();
  const scope = [];

  if (signal.wu_id) {
    scope.push(signal.wu_id);
  }
  if (signal.lane) {
    scope.push(signal.lane);
  }

  const scopeStr = scope.length > 0 ? ` [${scope.join(' | ')}]` : '';
  const readIndicator = signal.read ? ' (read)' : '';

  return `${timestamp}${scopeStr}${readIndicator}\n  ${signal.id}: ${signal.message}`;
}

/**
 * Display signals to console
 *
 * @param {object[]} signals - Array of signal objects
 * @param {boolean} quiet - Suppress headers
 */
function displaySignals(signals: Signal[], quiet: boolean | undefined): void {
  if (signals.length === 0) {
    if (!quiet) {
      console.log(`${LOG_PREFIX} No signals found`);
    }
    return;
  }

  if (!quiet) {
    console.log(`${LOG_PREFIX} ${signals.length} signal(s)\n`);
  }

  for (const signal of signals) {
    console.log(formatSignal(signal));
    console.log('');
  }
}

/**
 * Run inbox check once and optionally mark as read
 *
 * @param {string} baseDir - Project base directory
 * @param {object} options - Filter options
 * @param {boolean} markAsRead - Whether to mark signals as read
 * @returns {Promise<object[]>} Signals found
 */
async function checkInbox(
  baseDir: string,
  options: FilterOptions,
  markAsRead: boolean,
): Promise<Signal[]> {
  const signals = await loadSignals(baseDir, options);

  if (markAsRead && signals.length > 0) {
    const signalIds = signals.map((s) => s.id);
    await markSignalsAsRead(baseDir, signalIds);
  }

  return signals;
}

/**
 * Run watch mode - use chokidar file watching for signal monitoring
 * WU-1551: Replaced setInterval polling with chokidar.watch() for
 * efficient file-change-driven monitoring instead of CPU-wasting polling.
 *
 * @param {string} baseDir - Project base directory
 * @param {object} filterOptions - Filter options
 * @param {boolean} markAsRead - Whether to mark signals as read
 * @param {boolean} quiet - Suppress headers
 */
async function runWatchMode(
  baseDir: string,
  filterOptions: FilterOptions,
  markAsRead: boolean,
  quiet: boolean | undefined,
): Promise<void> {
  if (!quiet) {
    console.log(`${LOG_PREFIX} Watch mode started (Ctrl+C to exit)\n`);
  }

  // Track the last check time to only show new signals
  let lastCheckTime = new Date();

  // Initial check with original filters
  const initialSignals = await checkInbox(baseDir, filterOptions, markAsRead);
  displaySignals(initialSignals, quiet);

  // Check for new signals on file change
  const onFileChange = async () => {
    try {
      // Check for signals since last check, combined with original filters
      const watchOptions = {
        ...filterOptions,
        since: lastCheckTime,
        unreadOnly: true,
      };

      const newSignals = await checkInbox(baseDir, watchOptions, markAsRead);

      if (newSignals.length > 0) {
        console.log(`\n${LOG_PREFIX} ${newSignals.length} new signal(s)\n`);
        displaySignals(newSignals, true);
      }

      lastCheckTime = new Date();
    } catch (error: unknown) {
      console.error(`${LOG_PREFIX} Watch error: ${getErrorMessage(error)}`);
    }
  };

  // Watch the signals file for changes using chokidar
  const signalsPath = path.join(baseDir, LUMENFLOW_PATHS.MEMORY_DIR, SIGNALS_FILE_NAME);
  const watcher = chokidarWatch(signalsPath, {
    // Watch parent directory so we detect file creation too
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('change', () => {
    onFileChange().catch((err: unknown) => {
      console.error(`${LOG_PREFIX} Watch error: ${getErrorMessage(err)}`);
    });
  });

  watcher.on('add', () => {
    onFileChange().catch((err: unknown) => {
      console.error(`${LOG_PREFIX} Watch error: ${getErrorMessage(err)}`);
    });
  });

  // Handle graceful shutdown
  const cleanup = () => {
    watcher.close().catch(() => {
      // Watcher cleanup is non-fatal
    });
    if (!quiet) {
      console.log(`\n${LOG_PREFIX} Watch mode stopped`);
    }
    process.exit(EXIT_CODES.SUCCESS);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

/**
 * Parse CLI arguments
 *
 * @returns {object} Parsed arguments
 */
function parseArguments() {
  return createWUParser({
    name: 'mem-inbox',
    description: 'Read coordination signals from other agents',
    options: [
      WU_OPTIONS.wu,
      WU_OPTIONS.lane,
      CLI_OPTIONS.since,
      CLI_OPTIONS.watch,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.noMark,
      CLI_OPTIONS.count,
    ],
    required: [],
    allowPositionalId: false,
  });
}

/**
 * Build filter options from parsed arguments
 *
 * @param {object} args - Parsed CLI arguments
 * @returns {object} Filter options for loadSignals
 */
interface FilterOptions {
  unreadOnly: boolean;
  wuId?: string;
  lane?: string;
  since?: Date;
}

interface ParsedArgs {
  wu?: string;
  lane?: string;
  since?: string;
  watch?: boolean;
  quiet?: boolean;
  count?: boolean;
  mark?: boolean;
}

function buildFilterOptions(args: ParsedArgs): FilterOptions {
  const filterOptions: FilterOptions = {
    unreadOnly: true, // Default to unread only
  };

  if (args.wu) {
    filterOptions.wuId = args.wu;
  }

  if (args.lane) {
    filterOptions.lane = args.lane;
  }

  if (args.since) {
    filterOptions.since = parseTimeString(args.since);
  }

  return filterOptions;
}

/**
 * WU-2401: Run count mode - output only signal count
 *
 * @param {string} baseDir - Project base directory
 * @param {object} filterOptions - Filter options
 * @returns {Promise<number>} Signal count
 */
async function runCountMode(baseDir: string, filterOptions: FilterOptions): Promise<number> {
  const signals = await loadSignals(baseDir, filterOptions);
  const count = signals.length;
  console.log(formatCount(count));
  return count;
}

/**
 * Run standard check mode - display signals and optionally mark as read
 *
 * @param {string} baseDir - Project base directory
 * @param {object} filterOptions - Filter options
 * @param {boolean} markAsRead - Whether to mark signals as read
 * @param {boolean} quiet - Suppress headers
 * @returns {Promise<number>} Signal count
 */
async function runStandardMode(
  baseDir: string,
  filterOptions: FilterOptions,
  markAsRead: boolean,
  quiet: boolean | undefined,
): Promise<number> {
  const signals = await checkInbox(baseDir, filterOptions, markAsRead);
  displaySignals(signals, quiet);
  return signals.length;
}

/**
 * Main CLI entry point
 */
export async function main() {
  // WU-2202: Validate dependencies BEFORE any other operation
  const depResult = await validateInboxDependencies();
  if (!depResult.valid) {
    console.error(formatDependencyError('mem:inbox', depResult.missing));
    process.exit(EXIT_CODES.ERROR);
  }

  const args = parseArguments();
  const baseDir = process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Build filter options
  let filterOptions;
  try {
    filterOptions = buildFilterOptions(args);
  } catch (error: unknown) {
    console.error(`${LOG_PREFIX} Error: ${getErrorMessage(error)}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Validate mode combinations
  if (args.count && args.watch) {
    console.error(`${LOG_PREFIX} Error: --count and --watch cannot be used together`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Handle negated --no-mark option (Commander sets mark=false when --no-mark is used)
  // In count mode, we never mark signals as read (lightweight polling)
  const markAsRead = args.count ? false : args.mark !== false;

  let signalCount = 0;
  let error = null;

  try {
    if (args.count) {
      signalCount = await runCountMode(baseDir, filterOptions);
    } else if (args.watch) {
      await runWatchMode(baseDir, filterOptions, markAsRead, args.quiet);
    } else {
      signalCount = await runStandardMode(baseDir, filterOptions, markAsRead, args.quiet);
    }
  } catch (err: unknown) {
    error = getErrorMessage(err);
  }

  const durationMs = Date.now() - startTime;

  // Log audit entry (only for non-watch mode since watch runs indefinitely)
  if (!args.watch) {
    await writeAuditLog(baseDir, {
      tool: TOOL_NAME,
      status: error ? 'failed' : 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      input: {
        wuId: args.wu,
        lane: args.lane,
        since: args.since,
        watch: args.watch,
        quiet: args.quiet,
        count: args.count,
        markAsRead,
      },
      output: {
        signalCount,
      },
      error: error ? { message: error } : null,
    });
  }

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
