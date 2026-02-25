#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Start CLI (WU-1466)
 *
 * Create a session node linked to a WU.
 * Called by wu:claim enhancement for context restoration after /clear.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:start --wu WU-1234 [--agent-type <type>] [--context-tier <tier>] [--quiet]
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-start-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-start.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { startSession } from '@lumenflow/memory/start';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:start output
 */
const LOG_PREFIX = '[mem:start]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:start';

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
 * CLI argument options specific to mem:start
 */
const CLI_OPTIONS = {
  agentType: {
    name: 'agentType',
    flags: '-a, --agent-type <type>',
    description: 'Agent type (e.g., general-purpose, explore, test-engineer)',
  },
  contextTier: {
    name: 'contextTier',
    flags: '-c, --context-tier <tier>',
    description: 'Context tier (core, full, minimal)',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-d, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
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
    name: 'mem-start',
    description: 'Create a session node linked to a WU',
    options: [
      WU_OPTIONS.wu,
      CLI_OPTIONS.agentType,
      CLI_OPTIONS.contextTier,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.quiet,
    ],
    required: ['wu'],
  });

  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: Awaited<ReturnType<typeof startSession>> | null = null;
  let error: string | null = null;

  try {
    result = await startSession(baseDir, {
      wuId: args.wu,
      agentType: args.agentType,
      contextTier: args.contextTier,
    });
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
    input: {
      baseDir,
      wuId: args.wu,
      agentType: args.agentType,
      contextTier: args.contextTier,
    },
    output: result
      ? {
          success: result.success,
          sessionId: result.session?.id,
          wuId: result.session?.wu_id,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (!result) {
    console.error(`${LOG_PREFIX} Error: session start failed with no result`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.quiet) {
    // In quiet mode, just output the session ID for piping
    console.log(result.session.id);
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Output results
  console.log(`${LOG_PREFIX} Session started (${result.session.id})`);
  console.log('');
  console.log('Session Details:');
  console.log(`  ID:           ${result.session.id}`);
  console.log(`  WU:           ${result.session.wu_id}`);
  console.log(`  Session UUID: ${result.session.session_id}`);
  console.log(`  Agent Type:   ${result.session.metadata.agentType}`);
  console.log(`  Context Tier: ${result.session.metadata.contextTier}`);
  console.log(`  Created At:   ${result.session.created_at}`);
  console.log('');
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
