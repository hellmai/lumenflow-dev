#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Context CLI (WU-1234, WU-1292)
 *
 * Generate deterministic, formatted context injection blocks for delegation prompts.
 * Outputs structured markdown with sections for project profile, summaries,
 * WU context, and discoveries.
 *
 * Usage:
 *   pnpm mem:context --wu WU-XXXX [options]
 *
 * Options:
 *   --max-size <bytes>            Maximum context size in bytes (default: 4096)
 *   --delegation-context-max-size <bytes>  Alias for --max-size (for config parity)
 *   --spawn-context-max-size <bytes>  Deprecated: hard-fails with migration guidance
 *   --lane <lane>                 Filter project memories by lane (WU-1292)
 *   --max-recent-summaries <n>    Limit recent summaries included (WU-1292)
 *   --max-project-nodes <n>       Limit project nodes included (WU-1292)
 *   --format <json|human>         Output format (default: human)
 *   --quiet                       Suppress header/footer output
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * @see {@link packages/@lumenflow/memory/src/mem-context-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/__tests__/mem-context.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateContext } from '@lumenflow/memory/context';

/**
 * Result from generateContext
 */
interface GenerateContextResult {
  success: boolean;
  contextBlock: string;
  stats: {
    totalNodes: number;
    byType: Record<string, number>;
    truncated: boolean;
    size: number;
  };
}
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:context output
 */
const LOG_PREFIX = '[mem:context]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:context';

const MEM_CONTEXT_ERRORS = {
  DEPRECATED_SPAWN_CONTEXT_FLAG:
    'Deprecated flag --spawn-context-max-size is not supported. Use --delegation-context-max-size instead.',
} as const;

/**
 * Valid output formats
 */
const VALID_FORMATS = ['json', 'human'] as const;
type OutputFormat = (typeof VALID_FORMATS)[number];

/**
 * CLI argument options specific to mem:context
 */
const CLI_OPTIONS = {
  maxSize: {
    name: 'maxSize',
    flags: '-m, --max-size <bytes>',
    description: 'Maximum context size in bytes (default: 4096)',
  },
  delegationContextMaxSize: {
    name: 'delegationContextMaxSize',
    flags: '--delegation-context-max-size <bytes>',
    description: 'Alias for --max-size (for config parity with delegation_context_max_size)',
  },
  deprecatedSpawnContextMaxSize: {
    name: 'spawnContextMaxSize',
    flags: '--spawn-context-max-size <bytes>',
    description: '(Deprecated) Use --delegation-context-max-size instead',
  },
  lane: {
    name: 'lane',
    flags: '-l, --lane <lane>',
    description: 'Filter project memories by lane (e.g., "Framework: CLI")',
  },
  maxRecentSummaries: {
    name: 'maxRecentSummaries',
    flags: '--max-recent-summaries <count>',
    description: 'Maximum number of recent summaries to include (default: 5)',
  },
  maxProjectNodes: {
    name: 'maxProjectNodes',
    flags: '--max-project-nodes <count>',
    description: 'Maximum number of project nodes to include (default: 10)',
  },
  format: {
    name: 'format',
    flags: '-f, --format <format>',
    description: 'Output format: json or human (default: human)',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-d, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress header/footer output, only show context block',
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
 * Validate and parse a positive integer argument
 *
 * @param value - Raw argument value
 * @param optionName - Name of the option for error messages
 * @returns Parsed integer value
 * @throws If value is invalid
 */
function parsePositiveInt(value: string | undefined, optionName: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `Invalid ${optionName} value: "${value}". Must be a positive integer.`,
    );
  }

  return parsed;
}

/**
 * WU-1292: Validate lane argument
 *
 * @param lane - Lane argument
 * @returns Validated lane
 * @throws If lane is empty string
 */
function validateLane(lane: string | undefined): string | undefined {
  if (lane === undefined) {
    return undefined;
  }

  if (lane === '') {
    throw createError(ErrorCodes.INVALID_ARGUMENT, 'Invalid --lane value: lane cannot be empty.');
  }

  return lane;
}

/**
 * Validate format argument
 *
 * @param format - Format argument
 * @returns Validated format
 * @throws If format is invalid
 */
function validateFormat(format: string | undefined): OutputFormat {
  if (!format) {
    return 'human';
  }

  if (!VALID_FORMATS.includes(format as OutputFormat)) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `Invalid --format value: "${format}". Valid formats: ${VALID_FORMATS.join(', ')}`,
    );
  }

  return format as OutputFormat;
}

/**
 * Print output in human-readable format
 *
 * @param result - Generate context result
 * @param wuId - WU ID
 * @param quiet - Whether to suppress headers
 */
function printHumanFormat(result: GenerateContextResult, wuId: string, quiet: boolean): void {
  if (!quiet) {
    console.log(`${LOG_PREFIX} Context for ${wuId}:`);
    console.log('');
  }

  if (result.contextBlock === '') {
    if (!quiet) {
      console.log('  (no memories found - empty context block)');
      console.log('');
    }
    return;
  }

  console.log(result.contextBlock);

  if (!quiet) {
    console.log('');
    console.log(
      `${LOG_PREFIX} ${result.stats.totalNodes} node(s) included${result.stats.truncated ? ' (truncated)' : ''}`,
    );
  }
}

/**
 * Print output in JSON format
 *
 * @param result - Generate context result
 * @param wuId - WU ID
 */
function printJsonFormat(result: GenerateContextResult, wuId: string): void {
  const output = {
    wuId,
    contextBlock: result.contextBlock,
    stats: result.stats,
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const args = createWUParser({
    name: 'mem-context',
    description: 'Generate context injection block for delegation prompts',
    options: [
      WU_OPTIONS.wu,
      CLI_OPTIONS.maxSize,
      CLI_OPTIONS.delegationContextMaxSize,
      CLI_OPTIONS.deprecatedSpawnContextMaxSize,
      CLI_OPTIONS.lane,
      CLI_OPTIONS.maxRecentSummaries,
      CLI_OPTIONS.maxProjectNodes,
      CLI_OPTIONS.format,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.quiet,
    ],
    required: ['wu'],
  });
  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let maxSize: number | undefined;
  let lane: string | undefined;
  let maxRecentSummaries: number | undefined;
  let maxProjectNodes: number | undefined;
  let format: OutputFormat;

  // Validate arguments
  try {
    if (args.spawnContextMaxSize) {
      throw createError(
        ErrorCodes.DEPRECATED_API,
        MEM_CONTEXT_ERRORS.DEPRECATED_SPAWN_CONTEXT_FLAG,
      );
    }

    // --delegation-context-max-size is an alias for --max-size (for config parity)
    // If both are provided, --delegation-context-max-size takes precedence.
    const maxSizeArg = args.delegationContextMaxSize || args.maxSize;
    maxSize = parsePositiveInt(maxSizeArg, '--max-size');
    lane = validateLane(args.lane);
    maxRecentSummaries = parsePositiveInt(args.maxRecentSummaries, '--max-recent-summaries');
    maxProjectNodes = parsePositiveInt(args.maxProjectNodes, '--max-project-nodes');
    format = validateFormat(args.format);
  } catch (err) {
    const error = err as Error;
    console.error(`${LOG_PREFIX} Error: ${error.message}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Core returns UnsafeAny type due to loose tsconfig
  let result: UnsafeAny;
  let error: string | null = null;

  try {
    result = await generateContext(baseDir, {
      wuId: args.wu,
      maxSize,
      lane,
      maxRecentSummaries,
      maxProjectNodes,
    });
  } catch (err) {
    const e = err as Error;
    error = e.message;
    result = {
      success: false,
      contextBlock: '',
      stats: { totalNodes: 0, byType: {}, truncated: false, size: 0 },
    };
  }

  // Type assertion for type safety
  const typedResult = result as GenerateContextResult;

  const durationMs = Date.now() - startTime;

  // Write audit log entry
  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: {
      baseDir,
      wuId: args.wu,
      maxSize,
      lane,
      maxRecentSummaries,
      maxProjectNodes,
      format,
      quiet: args.quiet,
    },
    output: typedResult.success
      ? {
          contextSize: typedResult.contextBlock.length,
          stats: typedResult.stats,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Print output based on format
  if (format === 'json') {
    printJsonFormat(typedResult, args.wu);
  } else {
    printHumanFormat(typedResult, args.wu, !!args.quiet);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
