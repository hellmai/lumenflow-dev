#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Recover CLI (WU-1390)
 *
 * Generate post-compaction recovery context for agents that have lost
 * their LumenFlow instructions due to context compaction.
 *
 * Usage:
 *   pnpm mem:recover --wu WU-XXXX [options]
 *
 * Options:
 *   --max-size <bytes>     Maximum output size in bytes (default: 2048)
 *   --format <json|human>  Output format (default: human)
 *   --quiet                Suppress header/footer output
 *
 * The recovery context includes:
 * - Last checkpoint for the WU
 *
 * WU-2117: Migrated throw new Error() to createError(ErrorCodes.*)
 * - Compact constraints (7 rules)
 * - Essential CLI commands
 * - Guidance to spawn fresh agent
 *
 * @see {@link packages/@lumenflow/memory/src/mem-recover-core.ts} - Core logic
 * @see {@link packages/@lumenflow/memory/__tests__/mem-recover-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateRecoveryContext } from '@lumenflow/memory/mem-recover-core';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { runCLI } from './cli-entry-point.js';

/**
 * Result from generateRecoveryContext
 */
interface RecoverResult {
  success: boolean;
  context: string;
  size: number;
  truncated: boolean;
}

/**
 * Log prefix for mem:recover output
 */
const LOG_PREFIX = '[mem:recover]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:recover';

/**
 * Valid output formats
 */
const VALID_FORMATS = ['json', 'human'] as const;
type OutputFormat = (typeof VALID_FORMATS)[number];

/**
 * CLI argument options specific to mem:recover
 */
const CLI_OPTIONS = {
  maxSize: {
    name: 'maxSize',
    flags: '-m, --max-size <bytes>',
    description: 'Maximum output size in bytes (default: 2048)',
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
    description: 'Suppress header/footer output, only show recovery context',
  },
};

/**
 * Write audit log entry for tool execution
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
 * Validate format argument
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
 */
function printHumanFormat(result: RecoverResult, wuId: string, quiet: boolean): void {
  if (!quiet) {
    console.log(`${LOG_PREFIX} Recovery context for ${wuId}:`);
    console.log('');
  }

  console.log(result.context);

  if (!quiet) {
    console.log('');
    console.log(`${LOG_PREFIX} ${result.size} bytes${result.truncated ? ' (truncated)' : ''}`);
  }
}

/**
 * Print output in JSON format
 */
function printJsonFormat(result: RecoverResult, wuId: string): void {
  const output = {
    wuId,
    context: result.context,
    size: result.size,
    truncated: result.truncated,
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const args = createWUParser({
    name: 'mem-recover',
    description: 'Generate post-compaction recovery context for agents',
    options: [
      WU_OPTIONS.wu,
      CLI_OPTIONS.maxSize,
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
  let format: OutputFormat;

  // Validate arguments
  try {
    maxSize = parsePositiveInt(args.maxSize, '--max-size');
    format = validateFormat(args.format);
  } catch (err) {
    const error = err as Error;
    console.error(`${LOG_PREFIX} Error: ${error.message}`);
    process.exit(EXIT_CODES.ERROR);
  }

  let result: RecoverResult;
  let error: string | null = null;

  try {
    result = await generateRecoveryContext({
      wuId: args.wu,
      baseDir,
      maxSize,
    });
  } catch (err) {
    const e = err as Error;
    error = e.message;
    result = {
      success: false,
      context: '',
      size: 0,
      truncated: false,
    };
  }

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
      format,
      quiet: args.quiet,
    },
    output: result.success
      ? {
          contextSize: result.size,
          truncated: result.truncated,
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
    printJsonFormat(result, args.wu);
  } else {
    printHumanFormat(result, args.wu, !!args.quiet);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
