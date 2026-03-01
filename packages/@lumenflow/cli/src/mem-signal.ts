#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Signal CLI (WU-1473, WU-1456)
 *
 * Send coordination signals between parallel agents for sub-100ms
 * multi-agent swarm coordination without git sync latency.
 *
 * WU-1456: Uses shared schema from @lumenflow/core for CLI/MCP parity.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:signal 'message' [--wu <id>] [--lane <name>] [--quiet]
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-signal-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-signal.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createSignal } from '@lumenflow/memory/signal';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
// WU-1456: Import shared validator for CLI/MCP parity
import { validateMemSignalArgs } from '@lumenflow/core/schemas/memory-arg-validators';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:signal output
 */
const LOG_PREFIX = '[mem:signal]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:signal';

type AuditLogEntry = Record<string, unknown>;

interface MemSignalArgs {
  message?: string;
  wu?: string;
  lane?: string;
  quiet?: boolean;
}

type CreateSignalResult = Awaited<ReturnType<typeof createSignal>>;

/**
 * CLI argument options specific to mem:signal
 */
const CLI_OPTIONS = {
  message: {
    name: 'message',
    flags: '-m, --message <text>',
    description: 'Signal message (required if not positional)',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except errors (outputs signal ID only)',
  },
};

/**
 * Write audit log entry for tool execution
 *
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir: string, entry: AuditLogEntry): Promise<void> {
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
 * Flags that expect a value argument
 */
const FLAGS_WITH_VALUES = new Set(['-m', '--message', '--wu', '-l', '--lane']);

/**
 * Extract positional arguments from argv (skipping flags and their values)
 *
 * @returns {string[]} Positional arguments
 */
function extractPositionalArgs() {
  const positionalArgs: string[] = [];
  let skipNext = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg.startsWith('-')) {
      skipNext = FLAGS_WITH_VALUES.has(arg);
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

/**
 * Parse CLI arguments and extract the message
 *
 * @returns {{args: object, message: string|undefined}} Parsed args and message
 */
function parseArguments(): { args: MemSignalArgs; message: string | undefined } {
  const args = createWUParser({
    name: 'mem-signal',
    description: 'Send a coordination signal to other agents',
    options: [CLI_OPTIONS.message, WU_OPTIONS.wu, WU_OPTIONS.lane, CLI_OPTIONS.quiet],
    required: [],
    allowPositionalId: true,
  }) as MemSignalArgs;

  let message = args.message;
  if (!message && process.argv.length > 2) {
    const positionalArgs = extractPositionalArgs();
    if (positionalArgs.length > 0) {
      [message] = positionalArgs;
    }
  }

  return { args, message };
}

/**
 * Print signal details to console
 *
 * @param {object} result - Creation result with signal
 */
function printSignalDetails(result: CreateSignalResult): void {
  const { signal } = result;

  console.log(`${LOG_PREFIX} Signal sent (${signal.id})`);
  console.log('');
  console.log('Signal Details:');
  console.log(`  ID:         ${signal.id}`);
  console.log(`  Message:    ${signal.message}`);
  console.log(`  Created At: ${signal.created_at}`);

  if (signal.wu_id) {
    console.log(`  WU:         ${signal.wu_id}`);
  }
  if (signal.lane) {
    console.log(`  Lane:       ${signal.lane}`);
  }

  console.log('');
}

/**
 * Main CLI entry point
 */
export async function main() {
  const { args, message } = parseArguments();

  if (!message) {
    console.error(`${LOG_PREFIX} Error: message is required`);
    console.error('');
    console.error("Usage: pnpm mem:signal 'message' [options]");
    console.error("       pnpm mem:signal --message 'message' [options]");
    console.error('');
    console.error('Options:');
    console.error('  --wu <id>      WU ID to scope signal to (e.g., WU-1473)');
    console.error('  --lane <name>  Lane to target signal to (e.g., "Operations: Tooling")');
    console.error('  --quiet        Suppress output except errors');
    process.exit(EXIT_CODES.ERROR);
  }

  // WU-1456: Validate args using shared schema for CLI/MCP parity
  const validation = validateMemSignalArgs({ message, wu: args.wu });
  if (!validation.valid) {
    console.error(`${LOG_PREFIX} Validation error: ${validation.errors.join(', ')}`);
    process.exit(EXIT_CODES.ERROR);
  }

  const baseDir = process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: CreateSignalResult | undefined;
  let error: string | null = null;

  try {
    result = await createSignal(baseDir, {
      message,
      wuId: args.wu,
      lane: args.lane,
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
      message,
      wuId: args.wu,
      lane: args.lane,
    },
    output: result
      ? {
          success: result.success,
          signalId: result.signal?.id,
          wuId: result.signal?.wu_id,
          lane: result.signal?.lane,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (!result) {
    console.error(`${LOG_PREFIX} Error: Failed to create signal`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.quiet) {
    console.log(result.signal.id);
    process.exit(EXIT_CODES.SUCCESS);
  }

  printSignalDetails(result);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main, { commandName: 'mem:signal' });
}
