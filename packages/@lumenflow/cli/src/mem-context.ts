#!/usr/bin/env node
/* eslint-disable no-console -- CLI tool requires console output */
/**
 * Memory Context CLI (WU-1234)
 *
 * Generate deterministic, formatted context injection blocks for wu:spawn prompts.
 * Outputs structured markdown with sections for project profile, summaries,
 * WU context, and discoveries.
 *
 * Usage:
 *   pnpm mem:context --wu WU-XXXX [--max-size <bytes>] [--format <json|human>] [--quiet]
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * @see {@link packages/@lumenflow/memory/src/mem-context-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/__tests__/mem-context.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateContext } from '@lumenflow/memory/dist/mem-context-core.js';

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
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/dist/wu-constants.js';

/**
 * Log prefix for mem:context output
 */
const LOG_PREFIX = '[mem:context]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:context';

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

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
    await fs.mkdir(logDir, { recursive: true });

    const line = `${JSON.stringify(entry)}\n`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes audit log
    await fs.appendFile(logPath, line, 'utf-8');
  } catch {
    // Audit logging is non-fatal - silently ignore errors
  }
}

/**
 * Validate and parse max-size argument
 *
 * @param maxSizeArg - Raw max-size argument
 * @returns Parsed max size in bytes
 * @throws If max-size is invalid
 */
function parseMaxSize(maxSizeArg: string | undefined): number | undefined {
  if (!maxSizeArg) {
    return undefined;
  }

  const parsed = parseInt(maxSizeArg, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid --max-size value: "${maxSizeArg}". Must be a positive integer.`);
  }

  return parsed;
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
    throw new Error(
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
async function main(): Promise<void> {
  const args = createWUParser({
    name: 'mem-context',
    description: 'Generate context injection block for wu:spawn prompts',
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
    maxSize = parseMaxSize(args.maxSize);
    format = validateFormat(args.format);
  } catch (err) {
    const error = err as Error;
    console.error(`${LOG_PREFIX} Error: ${error.message}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Core returns any type due to loose tsconfig
  let result: any;
  let error: string | null = null;

  try {
    result = await generateContext(baseDir, {
      wuId: args.wu,
      maxSize,
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

main().catch((e: Error) => {
  console.error(`${LOG_PREFIX} ${e.message}`);
  process.exit(EXIT_CODES.ERROR);
});
