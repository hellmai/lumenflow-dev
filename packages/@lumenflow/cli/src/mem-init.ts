#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Init CLI (WU-1464)
 *
 * Initialize memory layer in the repository.
 * Creates .lumenflow/memory/ directory with memory.jsonl and config.yaml.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:init [--base-dir <path>] [--quiet]
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-init-core.ts} - Core logic
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { initMemory } from '@lumenflow/memory/init';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, STRING_LITERALS, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:init output
 */
const LOG_PREFIX = '[mem:init]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:init';

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

    // Ensure telemetry directory exists

    await fs.mkdir(logDir, { recursive: true });

    // Append NDJSON entry
    const line = `${JSON.stringify(entry)}\n`;

    await fs.appendFile(logPath, line, 'utf-8');
  } catch {
    // Audit logging is non-fatal - silently ignore errors
  }
}

/**
 * CLI argument options
 */
const CLI_OPTIONS = {
  baseDir: {
    name: 'baseDir',
    flags: '-d, --base-dir <path>',
    description: 'Base directory to initialize (defaults to current directory)',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except errors',
  },
};

/**
 * Main CLI entry point
 */
export async function main() {
  const args = createWUParser({
    name: 'mem-init',
    description: 'Initialize memory layer in repository',
    options: [CLI_OPTIONS.baseDir, CLI_OPTIONS.quiet],
  });

  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: Awaited<ReturnType<typeof initMemory>> | null = null;
  let error: string | null = null;

  try {
    result = await initMemory(baseDir);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startTime;

  // Write audit log entry
  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: error ? 'failed' : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: { baseDir },
    output: result
      ? {
          initialized: result.success,
          alreadyInitialized: result.alreadyInitialized,
          created: result.created,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (!result) {
    console.error(`${LOG_PREFIX} Error: memory initialization failed with no result`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.quiet) {
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Output results
  console.log(`${STRING_LITERALS.NEWLINE}${LOG_PREFIX} Memory layer initialization complete`);
  console.log('');

  if (result.alreadyInitialized) {
    console.log('Status: Already initialized (no changes made)');
  } else {
    console.log('Status: Initialized');
  }

  console.log('');
  console.log('Paths:');
  console.log(`  Directory:    ${result.paths.memoryDir}`);
  console.log(`  Memory file:  ${result.paths.memoryJsonl}`);
  console.log(`  Config file:  ${result.paths.configYaml}`);

  if (!result.alreadyInitialized) {
    console.log('');
    console.log('Created:');
    if (result.created.directory) {
      console.log('  - .lumenflow/memory/ directory');
    }
    if (result.created.memoryJsonl) {
      console.log('  - memory.jsonl (empty)');
    }
    if (result.created.configYaml) {
      console.log('  - config.yaml (default settings)');
    }
  }

  console.log('');
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
