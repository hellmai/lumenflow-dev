#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Memory Checkpoint CLI (WU-1467, WU-1909)
 *
 * Create a checkpoint node for context snapshots.
 * Used before /clear or session handoff to preserve progress state.
 *
 * WU-1909: State-store propagation (wu-events.jsonl) is now handled here
 * in the CLI wrapper, guarded by resolveLocation() to only write when
 * running from a worktree (prevents dirtying main checkout).
 *
 * Includes audit logging to .lumenflow/telemetry/tools.ndjson.
 *
 * Usage:
 *   pnpm mem:checkpoint 'note' [--session <id>] [--wu <id>] [--progress <text>] [--next-steps <text>] [--trigger <type>] [--quiet]
 *
 * @see {@link packages/@lumenflow/memory/src/mem-checkpoint-core.ts} - Core logic (memory store only)
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-checkpoint.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createCheckpoint } from '@lumenflow/memory/checkpoint';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS, CONTEXT_VALIDATION } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';
import { resolveLocation } from '@lumenflow/core/context/location-resolver';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
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
  gitDiffStat: {
    name: 'gitDiffStat',
    flags: '--git-diff-stat <text>',
    description: 'Git diff --stat output to include in checkpoint metadata (WU-2157)',
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
 * Options for state-store propagation
 */
export interface PropagateOptions {
  /** Work Unit ID (required for propagation) */
  wuId?: string;
  /** Checkpoint note */
  note: string;
  /** Session ID */
  sessionId?: string;
  /** Progress summary */
  progress?: string;
  /** Next steps */
  nextSteps?: string;
}

/**
 * Result of state-store propagation attempt
 */
export interface PropagateResult {
  /** Whether the checkpoint was propagated to wu-events.jsonl */
  propagated: boolean;
  /** Reason propagation was skipped or failed */
  reason?: string;
}

/**
 * Propagate checkpoint to wu-events.jsonl state store (WU-1909).
 *
 * Only writes when running from a worktree context, preventing dirty
 * state on main checkout. Uses CONTEXT_VALIDATION.LOCATION_TYPES.WORKTREE
 * constant (no magic strings).
 *
 * @param baseDir - Base directory for state store
 * @param options - Propagation options
 * @returns Result indicating whether propagation occurred
 */
export async function propagateCheckpointToStateStore(
  baseDir: string,
  options: PropagateOptions,
): Promise<PropagateResult> {
  const { wuId, note, sessionId, progress, nextSteps } = options;

  // Guard: no WU ID means nothing to propagate
  if (!wuId) {
    return { propagated: false, reason: 'no_wu_id' };
  }

  // Guard: resolve location to determine if we're in a worktree
  let locationType: string;
  try {
    const location = await resolveLocation(baseDir);
    locationType = location.type;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} Warning: Could not resolve location: ${message}`);
    return { propagated: false, reason: 'location_resolve_failed' };
  }

  // Guard: only write to state store from worktree context
  if (locationType !== CONTEXT_VALIDATION.LOCATION_TYPES.WORKTREE) {
    return { propagated: false, reason: 'not_in_worktree' };
  }

  // Propagate to wu-events.jsonl
  try {
    const config = getConfig({ projectRoot: baseDir });
    const stateDir = path.join(baseDir, config.state.stateDir);
    const store = new WUStateStore(stateDir);
    await store.checkpoint(wuId, note, {
      sessionId,
      progress,
      nextSteps,
    });
    return { propagated: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} Warning: State store write failed: ${message}`);
    return { propagated: false, reason: 'write_failed' };
  }
}

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
      CLI_OPTIONS.gitDiffStat,
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
 * Shape of a checkpoint node for display purposes.
 * Matches CheckpointNode from @lumenflow/memory (not exported).
 */
interface CheckpointDisplay {
  id: string;
  type: string;
  lifecycle: string;
  content: string;
  created_at: string;
  wu_id?: string;
  session_id?: string;
  metadata?: CheckpointMetadataDisplay;
}

interface CheckpointMetadataDisplay {
  progress?: string;
  nextSteps?: string;
  trigger?: string;
}

/**
 * Print checkpoint details to console
 *
 * @param {CheckpointDisplay} checkpoint - The checkpoint node
 */
function printCheckpointDetails(checkpoint: CheckpointDisplay) {
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
function printMetadata(metadata: CheckpointMetadataDisplay) {
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
export async function main() {
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

  let result: Awaited<ReturnType<typeof createCheckpoint>> | null = null;
  let error: string | null = null;

  try {
    result = await createCheckpoint(baseDir, {
      note,
      sessionId: args.session,
      wuId: args.wu,
      progress: args.progress,
      nextSteps: args.nextSteps,
      trigger: args.trigger,
      gitDiffStat: args.gitDiffStat,
    });

    // WU-1909: Propagate to wu-events.jsonl only from worktree context
    await propagateCheckpointToStateStore(baseDir, {
      wuId: args.wu,
      note,
      sessionId: args.session,
      progress: args.progress,
      nextSteps: args.nextSteps,
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
      baseDir,
      note,
      sessionId: args.session,
      wuId: args.wu,
      progress: args.progress,
      nextSteps: args.nextSteps,
      trigger: args.trigger,
      gitDiffStat: args.gitDiffStat,
    },
    output: result
      ? {
          success: result.success,
          checkpointId: result.checkpoint?.id,
          wuId: args.wu,
        }
      : null,
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (!result) {
    console.error(`${LOG_PREFIX} Error: checkpoint creation failed with no result`);
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
  void runCLI(main);
}
