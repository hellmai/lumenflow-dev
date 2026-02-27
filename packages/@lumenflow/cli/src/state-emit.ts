#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * State Emit CLI (WU-2241)
 *
 * Emits corrective events to the state store (wu-events.jsonl) for manual
 * state reconciliation. This command provides a safe, audited alternative
 * to raw JSONL editing when the state store gets out of sync.
 *
 * Features:
 * - Emits corrective claim or release events
 * - Every event includes reason field and audit trail
 * - Writes audit log entry for each operation
 * - Used internally by state:doctor --fix for auto-repair
 *
 * Usage:
 *   pnpm state:emit --type claim --wu WU-XXX --reason "Manual correction"
 *   pnpm state:emit --type release --wu WU-XXX --reason "Release orphaned claim"
 *
 * @see {@link ./state-doctor-fix.ts} - Uses emitCorrectiveEvent for --fix
 * @see {@link @lumenflow/core/state-doctor-core.ts} - EmitEventPayload type
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/**
 * Valid event types for state:emit command.
 * Supports corrective operations: claim, release, and complete.
 * Used by both CLI and state:doctor --fix internally.
 */
export const VALID_EMIT_TYPES = ['claim', 'release', 'complete'] as const;
export type ValidEmitType = (typeof VALID_EMIT_TYPES)[number];

/**
 * WU ID validation pattern
 */
const WU_ID_PATTERN = /^WU-\d+$/;

/**
 * Log prefix for state:emit output
 */
const LOG_PREFIX = '[state:emit]';

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'state:emit';

/**
 * Options for emitting a corrective event.
 * Accepts explicit file paths for testability.
 */
export interface EmitCorrectiveEventOptions {
  type: ValidEmitType | string;
  wuId: string;
  reason: string;
  eventsFilePath: string;
  auditLogPath: string;
  lane?: string;
  title?: string;
}

/**
 * Validate emit parameters.
 *
 * @throws Error if type, wuId, or reason are invalid
 */
function validateParams(opts: EmitCorrectiveEventOptions): void {
  if (!VALID_EMIT_TYPES.includes(opts.type as ValidEmitType)) {
    throw new Error(
      `Invalid event type: '${opts.type}'. Valid types: ${VALID_EMIT_TYPES.join(', ')}`,
    );
  }

  if (!opts.reason || opts.reason.trim().length === 0) {
    throw new Error('Reason is required for corrective events');
  }

  if (!WU_ID_PATTERN.test(opts.wuId)) {
    throw new Error(`Invalid WU ID: '${opts.wuId}'. Must match pattern WU-XXX (e.g., WU-123)`);
  }
}

/**
 * Emit a corrective event to the state store.
 *
 * Appends a single event line to wu-events.jsonl with full audit trail.
 * Creates the file and parent directories if they don't exist.
 *
 * @param opts - Event options including type, wuId, reason, and file paths
 * @throws Error if validation fails
 */
export async function emitCorrectiveEvent(opts: EmitCorrectiveEventOptions): Promise<void> {
  validateParams(opts);

  const timestamp = new Date().toISOString();

  // Build event object with audit trail
  const event: Record<string, unknown> = {
    wuId: opts.wuId,
    type: opts.type,
    reason: opts.reason,
    timestamp,
    source: TOOL_NAME,
    corrective: true,
  };

  // Include lane/title for claim events
  if (opts.type === 'claim') {
    if (opts.lane) event.lane = opts.lane;
    if (opts.title) event.title = opts.title;
  }

  const eventLine = JSON.stringify(event);

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(opts.eventsFilePath), { recursive: true });

  // Append event to events file
  await fs.appendFile(opts.eventsFilePath, eventLine + '\n', 'utf-8');

  // Write audit log
  await writeAuditLog(opts.auditLogPath, {
    tool: TOOL_NAME,
    status: 'success',
    timestamp,
    input: {
      type: opts.type,
      wuId: opts.wuId,
      reason: opts.reason,
    },
  });
}

/**
 * Write an audit log entry.
 *
 * @param logPath - Path to audit log file
 * @param entry - Audit log entry
 */
async function writeAuditLog(logPath: string, entry: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Audit logging is non-fatal
  }
}

/**
 * CLI argument options for state:emit
 */
interface ParsedArgs {
  type?: string;
  wu?: string;
  reason?: string;
  baseDir?: string;
}

/**
 * Parse CLI arguments
 */
function parseArguments(): ParsedArgs {
  return createWUParser({
    name: 'state-emit',
    description: 'Emit a corrective event to the state store',
    options: [
      {
        name: 'type',
        flags: '-t, --type <type>',
        description: `Event type (${VALID_EMIT_TYPES.join(', ')})`,
      },
      {
        name: 'wu',
        flags: '--wu <wuId>',
        description: 'Work Unit ID (e.g., WU-123)',
      },
      {
        name: 'reason',
        flags: '-r, --reason <reason>',
        description: 'Reason for the corrective event (required)',
      },
      {
        name: 'baseDir',
        flags: '-b, --base-dir <path>',
        description: 'Base directory (defaults to current directory)',
      },
    ],
    required: [],
    allowPositionalId: false,
  }) as ParsedArgs;
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const args = parseArguments();

  if (!args.type) {
    console.error(`${LOG_PREFIX} Error: --type is required (${VALID_EMIT_TYPES.join(', ')})`);
    process.exit(EXIT_CODES.ERROR);
  }
  if (!args.wu) {
    console.error(`${LOG_PREFIX} Error: --wu is required (e.g., WU-123)`);
    process.exit(EXIT_CODES.ERROR);
  }
  if (!args.reason) {
    console.error(`${LOG_PREFIX} Error: --reason is required`);
    process.exit(EXIT_CODES.ERROR);
  }

  const baseDir = args.baseDir || process.cwd();
  const eventsFilePath = path.join(baseDir, LUMENFLOW_PATHS.WU_EVENTS);
  const auditLogPath = path.join(baseDir, LUMENFLOW_PATHS.AUDIT_LOG);

  try {
    await emitCorrectiveEvent({
      type: args.type,
      wuId: args.wu,
      reason: args.reason,
      eventsFilePath,
      auditLogPath,
    });

    console.log(`${LOG_PREFIX} Emitted corrective '${args.type}' event for ${args.wu}`);
    console.log(`${LOG_PREFIX} Reason: ${args.reason}`);
    console.log(`${LOG_PREFIX} Events file: ${eventsFilePath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Error: ${message}`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
