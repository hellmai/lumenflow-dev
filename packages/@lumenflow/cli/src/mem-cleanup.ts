#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Cleanup CLI (WU-1472, WU-1554, WU-1474)
 *
 * Prune closed memory nodes based on lifecycle policy and TTL.
 * Implements compaction to prevent memory bloat.
 *
 * Features:
 * - Remove ephemeral nodes (always discarded)
 * - Remove session nodes when session is closed
 * - Archive summarized nodes (marked with summarized_into)
 * - Respect sensitive:true flag for stricter retention
 * - Support dry-run mode for preview
 * - Report compaction metrics (ratio, bytes freed)
 * - WU-1554: TTL-based expiration (e.g., --ttl 30d)
 * - WU-1554: Active session protection (never removed)
 * - WU-1474: Decay-based archival (archive nodes below decay threshold)
 *
 * Usage:
 *   pnpm mem:cleanup                          # Cleanup based on lifecycle policy
 *   pnpm mem:cleanup --dry-run                # Preview without changes
 *   pnpm mem:cleanup --ttl 30d                # Remove nodes older than 30 days
 *   pnpm mem:cleanup --ttl 7d --dry-run       # Preview TTL cleanup
 *   pnpm mem:cleanup --session-id <uuid>      # Close specific session
 *   pnpm mem:cleanup --decay                  # Run decay-based archival
 *   pnpm mem:cleanup --decay --dry-run        # Preview decay archival
 *   pnpm mem:cleanup --json                   # Output as JSON
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-cleanup-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-cleanup.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupMemory } from '@lumenflow/memory/cleanup';
// WU-1474: Import decay archival for manual --decay mode
import { archiveByDecay } from '@lumenflow/memory/decay/archival';
import { getConfig } from '@lumenflow/core/config';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { formatBytes, MS_PER_DAY } from './constants.js';
import { runCLI } from './cli-entry-point.js';

/** Cleanup result shape from @lumenflow/memory/cleanup */
interface CleanupResult {
  success: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  dryRun?: boolean;
  ttlMs?: number;
  breakdown: {
    ephemeral: number;
    session: number;
    wu: number;
    sensitive: number;
    ttlExpired: number;
    activeSessionProtected: number;
  };
}

/** Decay archive result shape from @lumenflow/memory/decay/archival */
interface DecayArchiveResult {
  archivedIds: string[];
  retainedIds: string[];
  skippedIds: string[];
  totalProcessed: number;
  dryRun?: boolean;
}

/** Audit log entry for tool execution tracking */
interface AuditLogEntry {
  tool: string;
  status: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: { message: string } | null;
}

/**
 * Log prefix for mem:cleanup output
 */
const LOG_PREFIX = '[mem:cleanup]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:cleanup';

// WU-2044: BYTES_PER_KB imported from ./constants.js

/**
 * CLI argument options specific to mem:cleanup
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
    description:
      'Remove nodes older than duration (e.g., 30d, 7d, 24h). Active sessions are protected.',
  },
  sessionId: {
    name: 'sessionId',
    flags: '--session-id <uuid>',
    description: 'Session ID to consider closed (removes session lifecycle nodes)',
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
  decay: {
    name: 'decay',
    flags: '--decay',
    description:
      'Run decay-based archival (archive stale nodes below threshold). Uses config from workspace.yaml software_delivery or defaults.',
  },
};

/**
 * Write audit log entry for tool execution
 *
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir: string, entry: AuditLogEntry) {
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

// WU-2044: formatBytes imported from ./constants.js

/**
 * Format compaction ratio as percentage
 *
 * @param {number} ratio - Compaction ratio (0-1)
 * @returns {string} Formatted percentage
 */
function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Parse CLI arguments
 *
 * @returns {object} Parsed arguments
 */
function parseArguments() {
  return createWUParser({
    name: 'mem-cleanup',
    description: 'Prune closed memory nodes based on lifecycle policy and TTL',
    options: [
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.ttl,
      CLI_OPTIONS.sessionId,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.decay,
    ],
    required: [],
    allowPositionalId: false,
  });
}

/**
 * Print cleanup result to console
 *
 * @param {object} result - Cleanup result
 * @param {boolean} quiet - Suppress verbose output
 * @param {string} [ttl] - TTL string if provided
 */
function printResult(result: CleanupResult, quiet: boolean | undefined, ttl: string | undefined) {
  if (result.dryRun) {
    console.log(`${LOG_PREFIX} Dry-run: Would remove ${result.removedIds.length} node(s)`);
  } else {
    console.log(`${LOG_PREFIX} Cleanup complete`);
  }

  if (quiet) {
    console.log(`${result.removedIds.length} removed, ${result.retainedIds.length} retained`);
    return;
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Removed:          ${result.removedIds.length} node(s)`);
  console.log(`  Retained:         ${result.retainedIds.length} node(s)`);
  console.log(`  Bytes Freed:      ${formatBytes(result.bytesFreed)}`);
  console.log(`  Compaction Ratio: ${formatRatio(result.compactionRatio)}`);

  // WU-1554: Show TTL if provided
  if (ttl) {
    console.log(`  TTL:              ${ttl}`);
  }

  console.log('');
  console.log('Breakdown by Lifecycle:');
  console.log(`  Ephemeral:        ${result.breakdown.ephemeral} removed`);
  console.log(`  Session:          ${result.breakdown.session} removed`);
  console.log(`  WU (summarized):  ${result.breakdown.wu} removed`);
  console.log(`  Sensitive:        ${result.breakdown.sensitive} retained (stricter policy)`);

  // WU-1554: Show TTL breakdown
  if (result.breakdown.ttlExpired > 0 || result.breakdown.activeSessionProtected > 0) {
    console.log('');
    console.log('TTL Breakdown:');
    console.log(`  TTL Expired:      ${result.breakdown.ttlExpired} removed`);
    console.log(`  Active Sessions:  ${result.breakdown.activeSessionProtected} protected`);
  }

  if (result.removedIds.length > 0 && !result.dryRun) {
    console.log('');
    console.log('Removed Node IDs:');
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

// WU-2044: MS_PER_DAY imported from ./constants.js (local to avoid cross-package subpath export)

// WU-1548: Using LUMENFLOW_PATHS.MEMORY_DIR from wu-constants (consolidated)

/**
 * WU-1474: Print decay archival result to console
 *
 * @param {object} decayResult - Result from archiveByDecay
 * @param {boolean} quiet - Suppress verbose output
 */
function printDecayResult(decayResult: DecayArchiveResult, quiet: boolean | undefined) {
  if (decayResult.dryRun) {
    console.log(
      `${LOG_PREFIX} Dry-run: Would archive ${decayResult.archivedIds.length} node(s) by decay`,
    );
  } else {
    console.log(`${LOG_PREFIX} Decay archival complete`);
  }

  if (quiet) {
    console.log(
      `${decayResult.archivedIds.length} archived, ${decayResult.retainedIds.length} retained, ${decayResult.skippedIds.length} skipped`,
    );
    return;
  }

  console.log('');
  console.log('Decay Summary:');
  console.log(`  Archived:         ${decayResult.archivedIds.length} node(s)`);
  console.log(`  Retained:         ${decayResult.retainedIds.length} node(s)`);
  console.log(`  Skipped:          ${decayResult.skippedIds.length} node(s)`);
  console.log(`  Total Processed:  ${decayResult.totalProcessed} node(s)`);

  if (decayResult.dryRun) {
    console.log('');
    console.log('To execute, run without --dry-run');
  }
}

/**
 * WU-1474: Run decay-based archival mode
 *
 * @param {string} baseDir - Base directory
 * @param {boolean} dryRun - Preview without changes
 * @param {boolean} json - Output as JSON
 * @param {boolean} quiet - Suppress verbose output
 */
async function runDecayMode(
  baseDir: string,
  dryRun: boolean | undefined,
  json: boolean | undefined,
  quiet: boolean | undefined,
) {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let decayResult: DecayArchiveResult | null = null;
  let error: string | null = null;

  try {
    // Read config for threshold and half_life_days; fall back to defaults
    const config = getConfig();
    const decayConfig = config.memory?.decay;
    const threshold = decayConfig?.threshold ?? 0.1;
    const halfLifeDays = decayConfig?.half_life_days ?? 30;
    const halfLifeMs = halfLifeDays * MS_PER_DAY;

    const memoryDir = path.join(baseDir, LUMENFLOW_PATHS.MEMORY_DIR);
    decayResult = await archiveByDecay(memoryDir, {
      threshold,
      halfLifeMs,
      dryRun: dryRun || false,
    });
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startTime;

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: { baseDir, dryRun, mode: 'decay' },
    output: decayResult
      ? {
          archivedCount: decayResult.archivedIds.length,
          retainedCount: decayResult.retainedIds.length,
          skippedCount: decayResult.skippedIds.length,
          totalProcessed: decayResult.totalProcessed,
          dryRun: decayResult.dryRun,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (json) {
    console.log(JSON.stringify(decayResult, null, 2));
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (decayResult) {
    printDecayResult(decayResult, quiet);
  }
}

/**
 * Main CLI entry point
 */
export async function main() {
  const args = parseArguments();
  const baseDir = args.baseDir || process.cwd();

  // WU-1474: Decay mode - separate execution path
  if (args.decay) {
    await runDecayMode(baseDir, args.dryRun, args.json, args.quiet);
    return;
  }

  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: CleanupResult | null = null;
  let error: string | null = null;

  try {
    result = await cleanupMemory(baseDir, {
      dryRun: args.dryRun,
      sessionId: args.sessionId,
      ttl: args.ttl,
    });
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
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
      sessionId: args.sessionId,
      ttl: args.ttl,
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
          ttlMs: result.ttlMs,
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
    printResult(result, args.quiet, args.ttl);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
