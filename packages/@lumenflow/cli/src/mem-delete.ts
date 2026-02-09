#!/usr/bin/env node

/**
 * Memory Delete CLI (WU-1284)
 *
 * Delete or archive memory nodes using soft-delete pattern.
 * Respects append-only pattern by marking nodes with metadata.status=deleted.
 *
 * Features:
 * - Delete by node ID(s)
 * - Bulk delete via --tag filter
 * - Bulk delete via --older-than filter
 * - Dry-run preview mode
 *
 * Usage:
 *   pnpm mem:delete <node-id>                 # Delete single node
 *   pnpm mem:delete <id1> <id2>               # Delete multiple nodes
 *   pnpm mem:delete --tag obsolete            # Delete by tag
 *   pnpm mem:delete --older-than 30d          # Delete old nodes
 *   pnpm mem:delete --tag old --older-than 7d # Combined filters
 *   pnpm mem:delete <id> --dry-run            # Preview only
 *
 * @see {@link packages/@lumenflow/memory/src/mem-delete-core.ts} - Core logic
 * @see {@link packages/@lumenflow/memory/__tests__/mem-delete.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { deleteMemoryNodes } from '@lumenflow/memory/mem-delete-core';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:delete output
 */
const LOG_PREFIX = '[mem:delete]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:delete';

/**
 * CLI argument options specific to mem:delete
 */
const CLI_OPTIONS = {
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview deletion without making changes',
  },
  tag: {
    name: 'tag',
    flags: '--tag <tag>',
    description: 'Delete all nodes matching this tag',
  },
  olderThan: {
    name: 'olderThan',
    flags: '--older-than <duration>',
    description: 'Delete nodes older than duration (e.g., 30d, 7d, 24h, 2w)',
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
 * Parse CLI arguments and extract node IDs from positional args
 *
 * @returns Parsed args and node IDs
 */
function parseArguments(): { args: Record<string, unknown>; nodeIds: string[] } {
  const args = createWUParser({
    name: 'mem-delete',
    description: 'Delete memory nodes (soft delete via metadata.status=deleted)',
    options: [
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.tag,
      CLI_OPTIONS.olderThan,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.baseDir,
    ],
    required: [],
    allowPositionalId: true,
  });

  // Extract positional arguments as node IDs
  const nodeIds: string[] = [];
  const argv = process.argv.slice(2).filter((arg) => arg !== '--');

  for (const arg of argv) {
    // Skip flags and their values
    if (arg.startsWith('-')) {
      continue;
    }
    // Check if this arg is a value for a flag (by checking previous arg)
    const prevArg = argv[argv.indexOf(arg) - 1];
    if (
      prevArg &&
      prevArg.startsWith('-') &&
      !prevArg.startsWith('--dry-run') &&
      !prevArg.startsWith('--json') &&
      !prevArg.startsWith('-q')
    ) {
      continue;
    }
    // Node IDs start with 'mem-'
    if (arg.startsWith('mem-')) {
      nodeIds.push(arg);
    }
  }

  return { args, nodeIds };
}

/**
 * Display limit for ID lists
 */
const DISPLAY_LIMITS = {
  DELETED_IDS: 10,
  SKIPPED_IDS: 5,
};

/**
 * Print a list of IDs with limit
 */
function printIdList(ids: string[], limit: number, label: string): void {
  console.log('');
  console.log(label);
  const displayIds = ids.slice(0, limit);
  for (const id of displayIds) {
    console.log(`  - ${id}`);
  }
  if (ids.length > limit) {
    console.log(`  ... and ${ids.length - limit} more`);
  }
}

/**
 * Print errors list
 */
function printErrors(errors: string[]): void {
  if (errors.length === 0) return;
  console.log('');
  console.log('Errors:');
  for (const error of errors) {
    console.log(`  - ${error}`);
  }
}

/**
 * Print deletion result to console
 *
 * @param result - Deletion result
 * @param quiet - Suppress verbose output
 */
function printResult(
  result: {
    success: boolean;
    deletedCount: number;
    deletedIds: string[];
    skippedIds: string[];
    dryRun: boolean;
    errors: string[];
  },
  quiet: boolean,
): void {
  const statusMsg = result.dryRun
    ? `${LOG_PREFIX} Dry-run: Would delete ${result.deletedCount} node(s)`
    : `${LOG_PREFIX} Deletion complete`;
  console.log(statusMsg);

  if (quiet) {
    console.log(`${result.deletedCount} deleted, ${result.skippedIds.length} skipped`);
    return;
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Deleted:  ${result.deletedCount} node(s)`);
  console.log(`  Skipped:  ${result.skippedIds.length} node(s)`);

  if (result.deletedIds.length > 0) {
    const label = result.dryRun ? 'Would Delete:' : 'Deleted:';
    printIdList(result.deletedIds, DISPLAY_LIMITS.DELETED_IDS, label);
  }

  if (result.skippedIds.length > 0) {
    printIdList(result.skippedIds, DISPLAY_LIMITS.SKIPPED_IDS, 'Skipped (already deleted):');
  }

  printErrors(result.errors);

  if (result.dryRun) {
    console.log('');
    console.log('To execute, run without --dry-run');
  }
}

/**
 * Build delete options from CLI arguments
 */
function buildDeleteOptions(
  args: Record<string, unknown>,
  nodeIds: string[],
): { nodeIds?: string[]; tag?: string; olderThan?: string; dryRun?: boolean } {
  const options: { nodeIds?: string[]; tag?: string; olderThan?: string; dryRun?: boolean } = {
    dryRun: args.dryRun as boolean | undefined,
  };

  if (nodeIds.length > 0) {
    options.nodeIds = nodeIds;
  }
  if (args.tag) {
    options.tag = args.tag as string;
  }
  if (args.olderThan) {
    options.olderThan = args.olderThan as string;
  }

  return options;
}

/**
 * Print usage help and exit with error
 */
function printUsageAndExit(): never {
  console.error(`${LOG_PREFIX} Error: At least one filter is required`);
  console.error('');
  console.error('Usage:');
  console.error('  pnpm mem:delete <node-id>        Delete single node by ID');
  console.error('  pnpm mem:delete <id1> <id2>      Delete multiple nodes');
  console.error('  pnpm mem:delete --tag <tag>      Delete all nodes with tag');
  console.error('  pnpm mem:delete --older-than 30d Delete nodes older than 30 days');
  console.error('  pnpm mem:delete --dry-run        Preview deletion');
  process.exit(EXIT_CODES.ERROR);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const { args, nodeIds } = parseArguments();
  const baseDir = (args.baseDir as string) || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const deleteOptions = buildDeleteOptions(args, nodeIds);

  // Check if any filter is provided
  if (!deleteOptions.nodeIds && !deleteOptions.tag && !deleteOptions.olderThan) {
    printUsageAndExit();
  }

  let result = null;
  let error = null;

  try {
    result = await deleteMemoryNodes(baseDir, deleteOptions);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startTime;

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: { baseDir, nodeIds, tag: args.tag, olderThan: args.olderThan, dryRun: args.dryRun },
    output: result
      ? {
          success: result.success,
          deletedCount: result.deletedCount,
          deletedIds: result.deletedIds,
          skippedCount: result.skippedIds.length,
          dryRun: result.dryRun,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (!result) {
    console.error(`${LOG_PREFIX} Error: No result from delete operation`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  }

  printResult(result, args.quiet as boolean);

  process.exit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}
