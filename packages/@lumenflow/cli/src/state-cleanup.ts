#!/usr/bin/env node

/**
 * Unified State Cleanup CLI (WU-1208)
 *
 * Single command to orchestrate all state cleanup operations:
 * - Signal cleanup (TTL-based pruning)
 * - Memory cleanup (lifecycle-based pruning)
 * - Event archival (age-based archiving)
 *
 * Cleanup order: signals -> memory -> events (dependency order)
 *
 * Features:
 * - Respects config from .lumenflow.config.yaml
 * - Supports --dry-run for preview
 * - Supports --signals-only, --memory-only, --events-only for selective cleanup
 * - Non-fatal: warns on errors but continues with other cleanups
 * - Summary output shows removed/retained counts for each type
 *
 * Usage:
 *   pnpm state:cleanup                 # Full cleanup: signals -> memory -> events
 *   pnpm state:cleanup --dry-run       # Preview without changes
 *   pnpm state:cleanup --signals-only  # Only signal cleanup
 *   pnpm state:cleanup --memory-only   # Only memory cleanup
 *   pnpm state:cleanup --events-only   # Only event archival
 *   pnpm state:cleanup --json          # Output as JSON
 *
 * @see {@link packages/@lumenflow/core/src/state-cleanup-core.ts} - Core orchestration
 * @see {@link packages/@lumenflow/core/src/__tests__/state-cleanup-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupSignals } from '@lumenflow/memory/dist/signal-cleanup-core.js';
import { cleanupMemory } from '@lumenflow/memory/dist/mem-cleanup-core.js';
import { archiveWuEvents } from '@lumenflow/core/dist/wu-events-cleanup.js';
import { cleanupState, type StateCleanupResult } from '@lumenflow/core/dist/state-cleanup-core.js';
import { createWUParser } from '@lumenflow/core/dist/arg-parser.js';
import {
  EXIT_CODES,
  LUMENFLOW_PATHS,
  PROTECTED_WU_STATUSES,
} from '@lumenflow/core/dist/wu-constants.js';
import { getConfig } from '@lumenflow/core/dist/lumenflow-config.js';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';

/**
 * Log prefix for state:cleanup output
 */
const LOG_PREFIX = '[state:cleanup]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'state:cleanup';

/**
 * Bytes per KB for formatting
 */
const BYTES_PER_KB = 1024;

/**
 * Labels for output formatting
 */
const OUTPUT_LABELS = {
  BREAKDOWN: '  Breakdown:',
} as const;

/**
 * CLI argument options specific to state:cleanup
 */
const CLI_OPTIONS = {
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview cleanup without making changes',
  },
  signalsOnly: {
    name: 'signalsOnly',
    flags: '--signals-only',
    description: 'Only execute signal cleanup',
  },
  memoryOnly: {
    name: 'memoryOnly',
    flags: '--memory-only',
    description: 'Only execute memory cleanup',
  },
  eventsOnly: {
    name: 'eventsOnly',
    flags: '--events-only',
    description: 'Only execute event archival',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except errors and summary',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-b, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
  },
};

interface ParsedArgs {
  dryRun?: boolean;
  signalsOnly?: boolean;
  memoryOnly?: boolean;
  eventsOnly?: boolean;
  json?: boolean;
  quiet?: boolean;
  baseDir?: string;
}

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

/**
 * Parse CLI arguments
 *
 * @returns Parsed arguments
 */
function parseArguments(): ParsedArgs {
  return createWUParser({
    name: 'state-cleanup',
    description: 'Orchestrate all state cleanup: signals, memory, events',
    options: [
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.signalsOnly,
      CLI_OPTIONS.memoryOnly,
      CLI_OPTIONS.eventsOnly,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.baseDir,
    ],
    required: [],
    allowPositionalId: false,
  }) as ParsedArgs;
}

/**
 * Print cleanup result to console
 *
 * @param result - State cleanup result
 * @param quiet - Suppress verbose output
 */
function printResult(result: StateCleanupResult, quiet: boolean): void {
  const mode = result.dryRun ? 'Dry-run' : 'Cleanup';
  console.log(`${LOG_PREFIX} ${mode} complete`);

  if (quiet) {
    console.log(
      `Total: ${formatBytes(result.summary.totalBytesFreed)} freed, ` +
        `executed: [${result.summary.typesExecuted.join(', ')}]`,
    );
    return;
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Total Bytes Freed: ${formatBytes(result.summary.totalBytesFreed)}`);
  console.log(`  Types Executed:    [${result.summary.typesExecuted.join(', ')}]`);
  if (result.summary.typesSkipped.length > 0) {
    console.log(`  Types Skipped:     [${result.summary.typesSkipped.join(', ')}]`);
  }

  // Signals section
  if (result.signals) {
    console.log('');
    console.log('--- Signals ---');
    console.log(`  Removed:  ${result.signals.removedCount}`);
    console.log(`  Retained: ${result.signals.retainedCount}`);
    console.log(`  Freed:    ${formatBytes(result.signals.bytesFreed)}`);
    console.log(OUTPUT_LABELS.BREAKDOWN);
    console.log(`    TTL Expired (read):    ${result.signals.breakdown.ttlExpired}`);
    console.log(`    TTL Expired (unread):  ${result.signals.breakdown.unreadTtlExpired}`);
    console.log(`    Count Limit Exceeded:  ${result.signals.breakdown.countLimitExceeded}`);
    console.log(`    Active WU Protected:   ${result.signals.breakdown.activeWuProtected}`);
  }

  // Memory section
  if (result.memory) {
    console.log('');
    console.log('--- Memory ---');
    console.log(`  Removed:  ${result.memory.removedCount}`);
    console.log(`  Retained: ${result.memory.retainedCount}`);
    console.log(`  Freed:    ${formatBytes(result.memory.bytesFreed)}`);
    console.log(OUTPUT_LABELS.BREAKDOWN);
    console.log(`    Ephemeral:              ${result.memory.breakdown.ephemeral}`);
    console.log(`    Session:                ${result.memory.breakdown.session}`);
    console.log(`    WU (summarized):        ${result.memory.breakdown.wu}`);
    console.log(`    Sensitive (retained):   ${result.memory.breakdown.sensitive}`);
    console.log(`    TTL Expired:            ${result.memory.breakdown.ttlExpired}`);
    console.log(`    Active Session:         ${result.memory.breakdown.activeSessionProtected}`);
  }

  // Events section
  if (result.events) {
    console.log('');
    console.log('--- Events ---');
    console.log(`  Archived WUs:     ${result.events.archivedWuCount}`);
    console.log(`  Retained WUs:     ${result.events.retainedWuCount}`);
    console.log(`  Archived Events:  ${result.events.archivedEventCount}`);
    console.log(`  Retained Events:  ${result.events.retainedEventCount}`);
    console.log(`  Archived:         ${formatBytes(result.events.bytesArchived)}`);
    console.log(OUTPUT_LABELS.BREAKDOWN);
    console.log(`    Older Than Threshold:  ${result.events.breakdown.archivedOlderThanThreshold}`);
    console.log(`    Active WU Protected:   ${result.events.breakdown.retainedActiveWu}`);
    console.log(`    Within Retention:      ${result.events.breakdown.retainedWithinThreshold}`);
  }

  // Errors section
  if (result.errors.length > 0) {
    console.log('');
    console.log('=== Errors ===');
    for (const error of result.errors) {
      console.log(`  [${error.type}] ${error.message}`);
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

  // Validate mutually exclusive flags
  const exclusiveFlags = [args.signalsOnly, args.memoryOnly, args.eventsOnly].filter(Boolean);
  if (exclusiveFlags.length > 1) {
    console.error(
      `${LOG_PREFIX} Error: --signals-only, --memory-only, and --events-only are mutually exclusive`,
    );
    process.exit(EXIT_CODES.ERROR);
  }

  let result: StateCleanupResult | null = null;
  let error: string | null = null;

  try {
    result = await cleanupState(baseDir, {
      dryRun: args.dryRun,
      signalsOnly: args.signalsOnly,
      memoryOnly: args.memoryOnly,
      eventsOnly: args.eventsOnly,
      // Inject real cleanup functions
      cleanupSignals: async (dir, opts) =>
        cleanupSignals(dir, {
          dryRun: opts.dryRun,
          getActiveWuIds: () => getActiveWuIds(dir),
        }),
      cleanupMemory: async (dir, opts) =>
        cleanupMemory(dir, {
          dryRun: opts.dryRun,
        }),
      archiveEvents: async (dir, opts) =>
        archiveWuEvents(dir, {
          dryRun: opts.dryRun,
        }),
    });
  } catch (err) {
    error = (err as Error).message;
  }

  const durationMs = Date.now() - startTime;

  // Determine audit log status
  let auditStatus: 'failed' | 'success' | 'partial' = 'partial';
  if (error) {
    auditStatus = 'failed';
  } else if (result?.success) {
    auditStatus = 'success';
  }

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: auditStatus,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      dryRun: args.dryRun,
      signalsOnly: args.signalsOnly,
      memoryOnly: args.memoryOnly,
      eventsOnly: args.eventsOnly,
    },
    output: result
      ? {
          success: result.success,
          totalBytesFreed: result.summary.totalBytesFreed,
          typesExecuted: result.summary.typesExecuted,
          typesSkipped: result.summary.typesSkipped,
          errorCount: result.errors.length,
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
    process.exit(result?.success ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  }

  if (result) {
    printResult(result, args.quiet ?? false);

    // Exit with error if any cleanups failed
    if (!result.success) {
      process.exit(EXIT_CODES.ERROR);
    }
  }
}

main().catch((e) => {
  console.error(`${LOG_PREFIX} ${(e as Error).message}`);
  process.exit(EXIT_CODES.ERROR);
});
