#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Summarize CLI (WU-1471)
 *
 * Rollup older memory nodes into summary nodes for compaction.
 * Implements forgetting as first-class feature.
 *
 * Features:
 * - Aggregate checkpoint/note/discovery nodes into summaries
 * - Mark originals for cleanup after summary creation
 * - Respect lifecycle TTL (ephemeral, session, wu, project)
 * - Support dry-run mode for preview
 *
 * Usage:
 *   pnpm mem:summarize --wu WU-1234           # Create summary from WU nodes
 *   pnpm mem:summarize --wu WU-1234 --dry-run # Preview without changes
 *   pnpm mem:summarize --wu WU-1234 --json    # Output as JSON
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-summarize-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-summarize.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { summarizeWu } from '@lumenflow/memory/summarize';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';
import { CLEANUP_LIST_DISPLAY_LIMIT, CONTENT_PREVIEW_LENGTH, JSON_INDENT } from './constants.js';

/**
 * Summary node shape within SummarizeResult.
 * Mirrors SummaryNode from @lumenflow/memory (not exported with declarations).
 */
interface SummaryNodeDisplay {
  id: string;
  type: string;
  lifecycle: string;
  content: string;
  created_at: string;
  wu_id?: string;
  metadata: {
    source_count: number;
    summarized_at: string;
  };
}

/**
 * Summarize result shape. Mirrors SummarizeResult from @lumenflow/memory/summarize.
 * Defined locally because memory package does not emit declaration files.
 */
interface SummarizeResultDisplay {
  success: boolean;
  summary: SummaryNodeDisplay;
  markedForCleanup: string[];
  dryRun?: boolean;
  compactionRatio: number;
}

/**
 * Log prefix for mem:summarize output
 */
const LOG_PREFIX = '[mem:summarize]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:summarize';

/**
 * CLI argument options specific to mem:summarize
 */
const CLI_OPTIONS = {
  wu: {
    name: 'wu',
    flags: '--wu <id>',
    description: 'WU ID to summarize (e.g., WU-1234)',
  },
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview summary without making changes',
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
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir: string, entry: Record<string, unknown>) {
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
 *
 * @returns {object} Parsed arguments
 */
function parseArguments() {
  return createWUParser({
    name: 'mem-summarize',
    description: 'Rollup older memory nodes into summary nodes for compaction',
    options: [
      CLI_OPTIONS.wu,
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.baseDir,
    ],
    required: ['wu'],
    allowPositionalId: false,
  });
}

/**
 * Print summary result to console
 *
 * @param {object} result - Summarization result
 * @param {boolean} quiet - Suppress verbose output
 */
function printResult(result: SummarizeResultDisplay, quiet: boolean) {
  if (result.dryRun) {
    console.log(`${LOG_PREFIX} Dry-run: Would create summary with:`);
  } else {
    console.log(`${LOG_PREFIX} ✅ Summary created`);
  }

  if (quiet) {
    console.log(result.summary.id);
    return;
  }

  console.log('');
  console.log('Summary Node:');
  console.log(`  ID:          ${result.summary.id}`);
  console.log(`  Type:        ${result.summary.type}`);
  console.log(`  Lifecycle:   ${result.summary.lifecycle}`);
  console.log(`  WU:          ${result.summary.wu_id}`);
  console.log(`  Created At:  ${result.summary.created_at}`);

  console.log('');
  console.log('Metrics:');
  console.log(`  Source Nodes:     ${result.summary.metadata.source_count}`);
  console.log(`  Marked Cleanup:   ${result.markedForCleanup.length}`);
  console.log(`  Compaction Ratio: ${result.compactionRatio}:1`);

  if (result.markedForCleanup.length > 0) {
    console.log('');
    console.log('Marked for Cleanup:');
    for (const nodeId of result.markedForCleanup.slice(0, CLEANUP_LIST_DISPLAY_LIMIT)) {
      console.log(`  - ${nodeId}`);
    }
    if (result.markedForCleanup.length > CLEANUP_LIST_DISPLAY_LIMIT) {
      console.log(`  ... and ${result.markedForCleanup.length - CLEANUP_LIST_DISPLAY_LIMIT} more`);
    }
  }

  console.log('');
  console.log('Content Preview:');
  const preview = result.summary.content.slice(0, CONTENT_PREVIEW_LENGTH);
  console.log(`  ${preview}${result.summary.content.length > CONTENT_PREVIEW_LENGTH ? '...' : ''}`);

  if (result.dryRun) {
    console.log('');
    console.log('To execute, run without --dry-run');
  }
}

/**
 * Main CLI entry point
 */
export async function main() {
  const args = parseArguments();
  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result = null;
  let error = null;

  try {
    result = await summarizeWu(baseDir, {
      wuId: args.wu,
      dryRun: args.dryRun,
    });
  } catch (err) {
    error = err.message;
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
      wuId: args.wu,
      dryRun: args.dryRun,
    },
    output: result
      ? {
          success: result.success,
          summaryId: result.summary?.id,
          sourceCount: result.summary?.metadata?.source_count,
          markedForCleanup: result.markedForCleanup?.length,
          compactionRatio: result.compactionRatio,
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
    console.error(`${LOG_PREFIX} Error: summarization failed with no result`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, JSON_INDENT));
    process.exit(EXIT_CODES.SUCCESS);
  }

  printResult(result as SummarizeResultDisplay, !!args.quiet);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
