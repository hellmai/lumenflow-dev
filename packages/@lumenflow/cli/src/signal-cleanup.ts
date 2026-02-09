#!/usr/bin/env node

/**
 * Signal Cleanup CLI (WU-1204)
 *
 * Prune old signals based on TTL policy to prevent unbounded growth.
 * Implements configurable retention:
 * - Read signals: 7 days default TTL
 * - Unread signals: 30 days default TTL
 * - Max entries: 500 default
 * - Active WU protection: signals linked to in_progress/blocked WUs are never removed
 *
 * Usage:
 *   pnpm signal:cleanup                      # Cleanup based on TTL policy
 *   pnpm signal:cleanup --dry-run            # Preview without changes
 *   pnpm signal:cleanup --ttl 3d             # Override read signal TTL
 *   pnpm signal:cleanup --max-entries 100    # Override max entries
 *   pnpm signal:cleanup --json               # Output as JSON
 *
 * @see {@link packages/@lumenflow/memory/src/signal-cleanup-core.ts} - Core logic
 * @see {@link packages/@lumenflow/memory/__tests__/signal-cleanup-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import { cleanupSignals } from '@lumenflow/memory/signal-cleanup-core';
import { createWUParser } from '@lumenflow/core/arg-parser';
import {
  EXIT_CODES,
  LUMENFLOW_PATHS,
  PROTECTED_WU_STATUSES,
} from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for signal:cleanup output
 */
const LOG_PREFIX = '[signal:cleanup]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'signal:cleanup';

/**
 * Bytes per KB for formatting
 */
const BYTES_PER_KB = 1024;

/**
 * CLI argument options specific to signal:cleanup
 */
const CLI_OPTIONS = {
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview cleanup without making changes',
  },
  ttl: {
    name: 'ttl',
    flags: '--ttl <duration>',
    description: 'TTL for read signals (e.g., 7d, 24h). Default: 7d',
  },
  unreadTtl: {
    name: 'unreadTtl',
    flags: '--unread-ttl <duration>',
    description: 'TTL for unread signals (e.g., 30d). Default: 30d',
  },
  maxEntries: {
    name: 'maxEntries',
    flags: '--max-entries <count>',
    description: 'Maximum signals to retain. Default: 500',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except errors',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-b, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
  },
};

/**
 * Write audit log entry for tool execution
 *
 * @param baseDir - Base directory
 * @param entry - Audit log entry
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
 * Format bytes as human-readable string
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 KB")
 */
function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return `${bytes} B`;
  }
  const kb = (bytes / BYTES_PER_KB).toFixed(1);
  return `${kb} KB`;
}

/**
 * Format compaction ratio as percentage
 *
 * @param ratio - Compaction ratio (0-1)
 * @returns Formatted percentage
 */
function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Get active WU IDs (in_progress or blocked) by scanning WU YAML files.
 *
 * @param baseDir - Base directory
 * @returns Set of active WU IDs
 */
async function getActiveWuIds(baseDir: string): Promise<Set<string>> {
  const activeIds = new Set<string>();

  try {
    const config = getConfig({ projectRoot: baseDir });
    const wuDir = path.join(baseDir, config.directories.wuDir);

    // Find all WU YAML files
    const wuFiles = await fg('WU-*.yaml', { cwd: wuDir });

    for (const file of wuFiles) {
      try {
        const filePath = path.join(wuDir, file);

        const content = await fs.readFile(filePath, 'utf-8');
        const wu = parseYaml(content) as { id?: string; status?: string };

        if (wu.id && wu.status && PROTECTED_WU_STATUSES.includes(wu.status)) {
          activeIds.add(wu.id);
        }
      } catch {
        // Skip files that fail to parse
        continue;
      }
    }
  } catch {
    // If we can't read WU files, return empty set (safer to remove nothing)
  }

  return activeIds;
}

interface ParsedArgs {
  dryRun?: boolean;
  ttl?: string;
  unreadTtl?: string;
  maxEntries?: string;
  json?: boolean;
  quiet?: boolean;
  baseDir?: string;
}

/**
 * Parse CLI arguments
 *
 * @returns Parsed arguments
 */
function parseArguments(): ParsedArgs {
  return createWUParser({
    name: 'signal-cleanup',
    description: 'Prune old signals based on TTL policy to prevent unbounded growth',
    options: [
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.ttl,
      CLI_OPTIONS.unreadTtl,
      CLI_OPTIONS.maxEntries,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.baseDir,
    ],
    required: [],
    allowPositionalId: false,
  }) as ParsedArgs;
}

interface CleanupResult {
  success: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  dryRun?: boolean;
  breakdown: {
    ttlExpired: number;
    unreadTtlExpired: number;
    countLimitExceeded: number;
    activeWuProtected: number;
  };
}

/**
 * Print cleanup result to console
 *
 * @param result - Cleanup result
 * @param quiet - Suppress verbose output
 */
function printResult(result: CleanupResult, quiet: boolean): void {
  if (result.dryRun) {
    console.log(`${LOG_PREFIX} Dry-run: Would remove ${result.removedIds.length} signal(s)`);
  } else {
    console.log(`${LOG_PREFIX} Cleanup complete`);
  }

  if (quiet) {
    console.log(`${result.removedIds.length} removed, ${result.retainedIds.length} retained`);
    return;
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Removed:          ${result.removedIds.length} signal(s)`);
  console.log(`  Retained:         ${result.retainedIds.length} signal(s)`);
  console.log(`  Bytes Freed:      ${formatBytes(result.bytesFreed)}`);
  console.log(`  Compaction Ratio: ${formatRatio(result.compactionRatio)}`);

  console.log('');
  console.log('Breakdown:');
  console.log(`  TTL Expired (read):    ${result.breakdown.ttlExpired} removed`);
  console.log(`  TTL Expired (unread):  ${result.breakdown.unreadTtlExpired} removed`);
  console.log(`  Count Limit Exceeded:  ${result.breakdown.countLimitExceeded} removed`);
  console.log(`  Active WU Protected:   ${result.breakdown.activeWuProtected} retained`);

  if (result.removedIds.length > 0 && !result.dryRun) {
    console.log('');
    console.log('Removed Signal IDs:');
    // Show first 10, then "and X more" if needed
    const displayLimit = 10;
    const displayIds = result.removedIds.slice(0, displayLimit);
    for (const id of displayIds) {
      console.log(`  - ${id}`);
    }
    if (result.removedIds.length > displayLimit) {
      console.log(`  ... and ${result.removedIds.length - displayLimit} more`);
    }
  }

  if (result.dryRun) {
    console.log('');
    console.log('To execute, run without --dry-run');
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArguments();
  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: CleanupResult | null = null;
  let error: string | null = null;

  try {
    result = await cleanupSignals(baseDir, {
      dryRun: args.dryRun,
      ttl: args.ttl,
      unreadTtl: args.unreadTtl,
      maxEntries: args.maxEntries ? parseInt(args.maxEntries, 10) : undefined,
      getActiveWuIds: () => getActiveWuIds(baseDir),
    });
  } catch (err) {
    error = (err as Error).message;
  }

  const durationMs = Date.now() - startTime;

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      dryRun: args.dryRun,
      ttl: args.ttl,
      unreadTtl: args.unreadTtl,
      maxEntries: args.maxEntries,
    },
    output: result
      ? {
          success: result.success,
          removedCount: result.removedIds.length,
          retainedCount: result.retainedIds.length,
          bytesFreed: result.bytesFreed,
          compactionRatio: result.compactionRatio,
          breakdown: result.breakdown,
          dryRun: result.dryRun,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (result) {
    printResult(result, args.quiet ?? false);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}
