#!/usr/bin/env node
/**
 * Memory Export CLI (WU-1137)
 *
 * Render memory.jsonl as markdown or JSON with basic filters.
 *
 * Usage:
 *   pnpm mem:export [--wu WU-1234] [--type <type>] [--lifecycle <lifecycle>] [--format <markdown|json>] [--quiet]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { exportMemory } from '@lumenflow/memory/mem-export-core';
import { MEMORY_NODE_TYPES } from '@lumenflow/memory/schema';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[mem:export]';
const TOOL_NAME = 'mem:export';

const CLI_OPTIONS = {
  type: {
    name: 'type',
    flags: '-t, --type <type>',
    description: `Filter by node type (${MEMORY_NODE_TYPES.join(', ')})`,
  },
  lifecycle: {
    name: 'lifecycle',
    flags: '-l, --lifecycle <lifecycle>',
    description: 'Filter by lifecycle (ephemeral, session, wu, project)',
  },
  format: {
    name: 'format',
    flags: '-f, --format <format>',
    description: 'Output format (markdown, json). Default: markdown',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-d, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress header/footer output',
  },
};

async function writeAuditLog(baseDir: string, entry: Record<string, unknown>) {
  try {
    const logPath = path.join(baseDir, LUMENFLOW_PATHS.AUDIT_LOG);
    const logDir = path.dirname(logPath);
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // Non-fatal
  }
}

function validateFormat(format: string): boolean {
  return format === 'markdown' || format === 'json';
}

function validateLifecycle(lifecycle: string): boolean {
  return ['ephemeral', 'session', 'wu', 'project'].includes(lifecycle);
}

async function main() {
  const args = createWUParser({
    name: 'mem-export',
    description: 'Export memory nodes as markdown or JSON',
    options: [
      WU_OPTIONS.wu,
      CLI_OPTIONS.type,
      CLI_OPTIONS.lifecycle,
      CLI_OPTIONS.format,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.quiet,
    ],
    required: [],
  });

  const baseDir = args.baseDir || process.cwd();
  const format = args.format || 'markdown';
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  if (!validateFormat(format)) {
    console.error(`${LOG_PREFIX} Error: Invalid format "${format}". Use "markdown" or "json".`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.type && !MEMORY_NODE_TYPES.includes(args.type)) {
    console.error(
      `${LOG_PREFIX} Error: Invalid type "${args.type}". Valid types: ${MEMORY_NODE_TYPES.join(', ')}`,
    );
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.lifecycle && !validateLifecycle(args.lifecycle)) {
    console.error(
      `${LOG_PREFIX} Error: Invalid lifecycle "${args.lifecycle}". Valid values: ephemeral, session, wu, project`,
    );
    process.exit(EXIT_CODES.ERROR);
  }

  let error: string | null = null;
  let output = '';

  try {
    const result = await exportMemory(baseDir, {
      wuId: args.wu,
      type: args.type,
      lifecycle: args.lifecycle,
      format,
    });
    output = result.output;
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
    input: {
      baseDir,
      wuId: args.wu ?? null,
      type: args.type ?? null,
      lifecycle: args.lifecycle ?? null,
      format,
    },
    error,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (!args.quiet) {
    console.log(`${LOG_PREFIX} Export (${format})`);
    console.log('');
  }

  process.stdout.write(output);
  if (!output.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
