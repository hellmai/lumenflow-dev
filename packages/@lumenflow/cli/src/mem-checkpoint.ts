#!/usr/bin/env node
/**
 * Memory Checkpoint CLI (WU-1467)
 *
 * Create a checkpoint node for context snapshots.
 * Used before /clear or session handoff to preserve progress state.
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:checkpoint 'note' [--session <id>] [--wu <id>] [--progress <text>] [--next-steps <text>] [--trigger <type>] [--quiet]
 *
 * @see {@link packages/@lumenflow/cli/src/lib/mem-checkpoint-core.ts} - Core logic
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-checkpoint.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createCheckpoint } from '@lumenflow/memory/checkpoint';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for mem:checkpoint output
 */
const LOG_PREFIX = '[mem:checkpoint]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'mem:checkpoint';

/**
 * CLI argument options specific to mem:checkpoint
 */
const CLI_OPTIONS = {
  note: {
    name: 'note',
    flags: '-n, --note <text>',
    description: 'Checkpoint note (required if not positional)',
  },
  session: {
    name: 'session',
    flags: '-s, --session <id>',
    description: 'Session ID to link checkpoint to (UUID)',
  },
  progress: {
    name: 'progress',
    flags: '-p, --progress <text>',
    description: 'Progress summary',
  },
  nextSteps: {
    name: 'nextSteps',
    flags: '--next-steps <text>',
    description: 'Next steps description',
  },
  trigger: {
    name: 'trigger',
    flags: '-t, --trigger <type>',
    description: 'Handoff trigger type (e.g., clear, handoff)',
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
 * Write audit log entry for tool execution
 *
 * @param {string} baseDir - Base directory
 * @param {object} entry - Audit log entry
 */
async function writeAuditLog(baseDir, entry) {
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
 * Parse CLI arguments and extract the note
 *
 * @returns {{args: object, note: string|undefined}} Parsed args and note
 */
function parseArguments() {
  const args = createWUParser({
    name: 'mem-checkpoint',
    description: 'Create a checkpoint node for context snapshots',
    options: [
      CLI_OPTIONS.note,
      CLI_OPTIONS.session,
      WU_OPTIONS.wu,
      CLI_OPTIONS.progress,
      CLI_OPTIONS.nextSteps,
      CLI_OPTIONS.trigger,
      CLI_OPTIONS.baseDir,
      CLI_OPTIONS.quiet,
    ],
    required: [],
    allowPositionalId: true,
  });

  let note = args.note;
  if (!note && process.argv.length > 2) {
    const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
    if (positionalArgs.length > 0) {
      note = positionalArgs[0];
    }
  }

  return { args, note };
}

/**
 * Print checkpoint details to console
 *
 * @param {object} checkpoint - The checkpoint node
 */
function printCheckpointDetails(checkpoint) {
  console.log(`${LOG_PREFIX} Checkpoint created (${checkpoint.id})`);
  console.log('');
  console.log('Checkpoint Details:');
  console.log(`  ID:         ${checkpoint.id}`);
  console.log(`  Type:       ${checkpoint.type}`);
  console.log(`  Lifecycle:  ${checkpoint.lifecycle}`);
  console.log(`  Created At: ${checkpoint.created_at}`);

  if (checkpoint.wu_id) {
    console.log(`  WU:         ${checkpoint.wu_id}`);
  }
  if (checkpoint.session_id) {
    console.log(`  Session:    ${checkpoint.session_id}`);
  }

  console.log('');
  console.log('Content:');
  console.log(`  ${checkpoint.content}`);

  if (checkpoint.metadata) {
    printMetadata(checkpoint.metadata);
  }
  console.log('');
}

/**
 * Print metadata section to console
 *
 * @param {object} metadata - Checkpoint metadata
 */
function printMetadata(metadata) {
  console.log('');
  console.log('Metadata:');
  if (metadata.progress) {
    console.log(`  Progress:   ${metadata.progress}`);
  }
  if (metadata.nextSteps) {
    console.log(`  Next Steps: ${metadata.nextSteps}`);
  }
  if (metadata.trigger) {
    console.log(`  Trigger:    ${metadata.trigger}`);
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  const { args, note } = parseArguments();

  if (!note) {
    console.error(`${LOG_PREFIX} Error: note is required`);
    console.error('');
    console.error("Usage: pnpm mem:checkpoint 'note' [options]");
    console.error("       pnpm mem:checkpoint --note 'note' [options]");
    process.exit(EXIT_CODES.ERROR);
  }

  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result;
  let error = null;

  try {
    result = await createCheckpoint(baseDir, {
      note,
      sessionId: args.session,
      wuId: args.wu,
      progress: args.progress,
      nextSteps: args.nextSteps,
      trigger: args.trigger,
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
      note,
      sessionId: args.session,
      wuId: args.wu,
      progress: args.progress,
      nextSteps: args.nextSteps,
      trigger: args.trigger,
    },
    output: result
      ? {
          success: result.success,
          checkpointId: result.checkpoint?.id,
          wuId: result.checkpoint?.wu_id,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.quiet) {
    console.log(result.checkpoint.id);
    process.exit(EXIT_CODES.SUCCESS);
  }

  printCheckpointDetails(result.checkpoint);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}
