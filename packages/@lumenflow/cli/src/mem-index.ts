#!/usr/bin/env node

/**
 * Memory Index CLI (WU-1235)
 *
 * Scans project conventions and creates project-lifecycle summary nodes.
 * Indexes README.md, LUMENFLOW.md, package.json, .lumenflow.config.yaml,
 * and .lumenflow/constraints.md to provide agent context awareness.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:index [--dry-run] [--quiet] [--json] [--base-dir <path>]
 *
 * @see {@link packages/@lumenflow/memory/src/mem-index-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/__tests__/mem-index.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { indexProject } from '@lumenflow/memory/index';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:index output
 */
const LOG_PREFIX = '[mem:index]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:index';

/**
 * CLI argument options specific to mem:index
 */
const CLI_OPTIONS = {
  dryRun: {
    name: 'dryRun',
    flags: '-n, --dry-run',
    description: 'Show what would be indexed without writing',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except summary',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output result as JSON',
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
 * Parse CLI arguments
 */
function parseArguments(): Record<string, unknown> {
  return createWUParser({
    name: 'mem-index',
    description: 'Index project conventions for agent context awareness',
    options: [CLI_OPTIONS.dryRun, CLI_OPTIONS.quiet, CLI_OPTIONS.json, CLI_OPTIONS.baseDir],
    required: [],
    allowPositionalId: false,
  });
}

interface IndexResultOutput {
  success: boolean;
  nodesCreated: number;
  nodesUpdated: number;
  nodesSkipped: number;
  sourcesScanned: string[];
  sourcesMissing: string[];
  error?: string;
}

/**
 * Print human-readable result
 *
 * @param result - Index result
 * @param dryRun - Whether this was a dry-run
 * @param quiet - Whether to use quiet mode
 */
function printResult(result: IndexResultOutput, dryRun: boolean, quiet: boolean): void {
  if (dryRun) {
    console.log(`${LOG_PREFIX} Dry-run mode - no changes written`);
    console.log('');
  }

  if (quiet) {
    // Minimal output
    const action = dryRun ? 'Would index' : 'Indexed';
    console.log(
      `${LOG_PREFIX} ${action}: ${result.nodesCreated} created, ${result.nodesUpdated} updated, ${result.nodesSkipped} skipped`,
    );
    return;
  }

  console.log(`${LOG_PREFIX} Project indexing complete`);
  console.log('');

  if (result.sourcesScanned.length > 0) {
    console.log('Sources scanned:');
    for (const source of result.sourcesScanned) {
      console.log(`  - ${source}`);
    }
    console.log('');
  }

  if (result.sourcesMissing.length > 0) {
    console.log('Sources not found:');
    for (const source of result.sourcesMissing) {
      console.log(`  - ${source}`);
    }
    console.log('');
  }

  console.log('Summary:');
  const createLabel = dryRun ? 'Would create' : 'Created';
  const updateLabel = dryRun ? 'Would update' : 'Updated';
  console.log(`  ${createLabel}: ${result.nodesCreated} nodes`);
  console.log(`  ${updateLabel}: ${result.nodesUpdated} nodes`);
  console.log(`  Skipped: ${result.nodesSkipped} nodes (unchanged)`);
  console.log('');
}

/**
 * Print JSON result
 *
 * @param result - Index result
 */
function printJsonResult(result: IndexResultOutput): void {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArguments();

  const baseDir = (args.baseDir as string) || process.cwd();
  const dryRun = Boolean(args.dryRun);
  const quiet = Boolean(args.quiet);
  const json = Boolean(args.json);

  // Validate base directory exists
  try {
    const stat = await fs.stat(baseDir);
    if (!stat.isDirectory()) {
      console.error(`${LOG_PREFIX} Error: ${baseDir} is not a directory`);
      process.exit(EXIT_CODES.ERROR);
    }
  } catch {
    console.error(`${LOG_PREFIX} Error: Directory not found: ${baseDir}`);
    process.exit(EXIT_CODES.ERROR);
  }

  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: IndexResultOutput;
  let error: string | null = null;

  try {
    result = await indexProject(baseDir, { dryRun });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    result = {
      success: false,
      nodesCreated: 0,
      nodesUpdated: 0,
      nodesSkipped: 0,
      sourcesScanned: [],
      sourcesMissing: [],
      error,
    };
  }

  const durationMs = Date.now() - startTime;

  // Write audit log
  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      dryRun,
    },
    output: {
      success: result.success,
      nodesCreated: result.nodesCreated,
      nodesUpdated: result.nodesUpdated,
      nodesSkipped: result.nodesSkipped,
      sourcesScanned: result.sourcesScanned.length,
    },
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (json) {
    printJsonResult(result);
  } else {
    printResult(result, dryRun, quiet);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
