// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Signal Core Logic (WU-1473)
 *
 * Core logic for creating coordination signals between parallel agents.
 * Enables sub-100ms agent communication via JSONL append operations.
 *
 * Features:
 * - Append-only writes for sub-100ms performance
 * - WU-scoped signals for focused coordination
 * - Lane-targeted signals for cross-team communication
 * - Read/unread tracking for mem:inbox integration
 *
 * @see {@link packages/@lumenflow/cli/src/mem-signal.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-signal.test.ts} - Tests
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeFsError } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Signal file name constant
 */
export const SIGNAL_FILE_NAME = 'signals.jsonl';

/**
 * Signal receipts file name constant (WU-1472)
 *
 * Append-only file that stores read receipts for signals.
 * This avoids rewriting signals.jsonl when marking signals as read,
 * enabling concurrent-safe consumption by multiple agents.
 */
export const SIGNAL_RECEIPTS_FILE_NAME = 'signal-receipts.jsonl';

/**
 * A read receipt for a signal (WU-1472)
 */
export interface SignalReceipt {
  /** ID of the signal that was read */
  signal_id: string;
  /** ISO 8601 timestamp when the signal was read */
  read_at: string;
}

/**
 * WU ID validation pattern (from memory-schema.ts)
 */
const WU_ID_PATTERN = /^WU-\d+$/;

/**
 * Signal ID prefix
 */
const SIGNAL_ID_PREFIX = 'sig-';

/**
 * Number of hex characters in signal ID suffix
 */
const SIGNAL_ID_LENGTH = 8;

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  MESSAGE_REQUIRED: 'message is required and cannot be empty',
  INVALID_WU_ID: 'Invalid WU ID format. Expected WU-XXX (e.g., WU-1473)',
};

/**
 * Signal structure
 */
export interface Signal {
  /** Unique signal identifier (sig-XXXXXXXX) */
  id: string;
  /** Signal content/message */
  message: string;
  /** ISO 8601 timestamp */
  created_at: string;
  /** Whether signal has been read */
  read: boolean;
  /** Optional WU ID scope */
  wu_id?: string;
  /** Optional target lane */
  lane?: string;
  /** Optional signal type (e.g., handoff, unblock, alert) */
  type?: string;
  /** Optional sender identifier (agent/session) */
  sender?: string;
  /** Optional target agent identifier */
  target_agent?: string;
  /** Optional origin context (e.g., cli, mcp, remote) */
  origin?: string;
  /** Optional remote signal ID for cross-system correlation */
  remote_id?: string;
}

/**
 * Result of creating a signal
 */
export interface CreateSignalResult {
  /** Whether signal was created successfully */
  success: boolean;
  /** The created signal object */
  signal: Signal;
}

/**
 * Options for creating a signal
 */
export interface CreateSignalOptions {
  /** Signal message content (required) */
  message: string;
  /** WU ID to scope signal to */
  wuId?: string;
  /** Lane to target signal to */
  lane?: string;
  /** Signal type (e.g., handoff, unblock, alert) */
  type?: string;
  /** Sender identifier (agent/session) */
  sender?: string;
  /** Target agent identifier */
  target_agent?: string;
  /** Origin context (e.g., cli, mcp, remote) */
  origin?: string;
  /** Remote signal ID for cross-system correlation */
  remote_id?: string;
}

/**
 * Options for loading signals
 */
export interface LoadSignalsOptions {
  /** Filter by WU ID */
  wuId?: string;
  /** Filter by lane */
  lane?: string;
  /** Only return unread signals */
  unreadOnly?: boolean;
  /** Only return signals created after this time */
  since?: Date | string;
}

/**
 * Result of marking signals as read
 */
export interface MarkAsReadResult {
  /** Number of signals marked as read */
  markedCount: number;
}

/**
 * Generates a unique signal ID using random bytes.
 *
 * Format: sig-[8 hex chars]
 * Uses crypto.randomBytes for uniqueness (not content-based like mem-id).
 *
 * @returns {string} Signal ID in format sig-XXXXXXXX
 */
function generateSignalId() {
  const bytes = randomBytes(4);
  const hex = bytes.toString('hex').slice(0, SIGNAL_ID_LENGTH);
  return `${SIGNAL_ID_PREFIX}${hex}`;
}

// WU-1548: NodeFsError imported from @lumenflow/core/wu-constants (consolidated)

/**
 * Gets the memory directory path for a project.
 *
 * @param baseDir - Project base directory
 * @returns Full path to memory directory
 */
function getMemoryDir(baseDir: string): string {
  return path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
}

/**
 * Gets the signals file path for a project.
 *
 * @param baseDir - Project base directory
 * @returns Full path to signals.jsonl
 */
function getSignalsPath(baseDir: string): string {
  return path.join(getMemoryDir(baseDir), SIGNAL_FILE_NAME);
}

/**
 * Gets the signal receipts file path for a project (WU-1472).
 *
 * @param baseDir - Project base directory
 * @returns Full path to signal-receipts.jsonl
 */
function getReceiptsPath(baseDir: string): string {
  return path.join(getMemoryDir(baseDir), SIGNAL_RECEIPTS_FILE_NAME);
}

/**
 * Loads read receipts from the receipts file (WU-1472).
 *
 * Returns a Set of signal IDs that have been marked as read via receipts.
 * If the file does not exist, returns an empty Set.
 *
 * @param baseDir - Project base directory
 * @returns Set of signal IDs with read receipts
 */
async function loadReceiptIds(baseDir: string): Promise<Set<string>> {
  const receiptsPath = getReceiptsPath(baseDir);
  let content: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known path
    content = await fs.readFile(receiptsPath, { encoding: 'utf-8' as BufferEncoding });
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
  const lines = content.split('\n').filter((line) => line.trim());
  const ids = new Set<string>();
  for (const line of lines) {
    const receipt = JSON.parse(line) as SignalReceipt;
    ids.add(receipt.signal_id);
  }
  return ids;
}

/**
 * Validates a WU ID format.
 *
 * @param wuId - WU ID to validate
 * @returns True if valid
 */
function isValidWuId(wuId: string): boolean {
  return WU_ID_PATTERN.test(wuId);
}

/**
 * Creates a coordination signal between parallel agents.
 *
 * Signals are appended to signals.jsonl using append-only writes
 * for sub-100ms performance. Signals can be scoped to a specific
 * WU or targeted at a specific lane.
 *
 * @param {string} baseDir - Project base directory
 * @param {CreateSignalOptions} options - Signal options
 * @returns {Promise<CreateSignalResult>} Result with created signal
 * @throws {Error} If message is missing or WU ID is invalid
 *
 * @example
 * const result = await createSignal('/project', {
 *   message: 'Starting feature implementation',
 *   wuId: 'WU-1473',
 *   lane: 'Operations: Tooling',
 * });
 */
export async function createSignal(
  baseDir: string,
  options: CreateSignalOptions,
): Promise<CreateSignalResult> {
  const { message, wuId, lane, type, sender, target_agent, origin, remote_id } = options;

  // Validate message is provided and non-empty
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.MESSAGE_REQUIRED);
  }

  // Validate WU ID format if provided
  if (wuId !== undefined && !isValidWuId(wuId)) {
    throw createError(ErrorCodes.INVALID_WU_ID, ERROR_MESSAGES.INVALID_WU_ID);
  }

  // Build signal object
  const signal: Signal = {
    id: generateSignalId(),
    message: message.trim(),
    created_at: new Date().toISOString(),
    read: false,
  };

  // Add optional fields
  if (wuId) {
    signal.wu_id = wuId;
  }
  if (lane) {
    signal.lane = lane;
  }
  if (type) {
    signal.type = type;
  }
  if (sender) {
    signal.sender = sender;
  }
  if (target_agent) {
    signal.target_agent = target_agent;
  }
  if (origin) {
    signal.origin = origin;
  }
  if (remote_id) {
    signal.remote_id = remote_id;
  }

  // Ensure memory directory exists
  const memoryDir = getMemoryDir(baseDir);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
  await fs.mkdir(memoryDir, { recursive: true });

  // Append signal to file (append-only for speed)
  const signalsPath = getSignalsPath(baseDir);
  const line = `${JSON.stringify(signal)}\n`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes signals file
  await fs.appendFile(signalsPath, line, 'utf-8');

  return {
    success: true,
    signal,
  };
}

/**
 * Loads signals from the signals file with optional filtering.
 *
 * Signals are returned in chronological order (oldest first).
 * Supports filtering by WU ID, lane, and read status.
 *
 * @param {string} baseDir - Project base directory
 * @param {LoadSignalsOptions} [options={}] - Filter options
 * @returns {Promise<Signal[]>} Array of signals matching filters
 *
 * @example
 * // Load all signals
 * const all = await loadSignals('/project');
 *
 * // Load unread signals for a specific WU
 * const unread = await loadSignals('/project', {
 *   wuId: 'WU-1473',
 *   unreadOnly: true,
 * });
 */
export async function loadSignals(
  baseDir: string,
  options: LoadSignalsOptions = {},
): Promise<Signal[]> {
  const { wuId, lane, unreadOnly, since } = options;
  const signalsPath = getSignalsPath(baseDir);

  // Read file content
  let content: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads signals file
    content = await fs.readFile(signalsPath, { encoding: 'utf-8' as BufferEncoding });
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      // File doesn't exist - return empty array
      return [];
    }
    throw error;
  }

  // Parse JSONL content
  const lines = content.split('\n').filter((line) => line.trim());
  const signals: Signal[] = lines.map((line) => JSON.parse(line));

  // Merge receipt-based read state (WU-1472)
  const receiptIds = await loadReceiptIds(baseDir);
  for (const signal of signals) {
    if (!signal.read && receiptIds.has(signal.id)) {
      signal.read = true;
    }
  }

  // Apply filters
  let filtered = signals;

  if (wuId) {
    filtered = filtered.filter((sig) => sig.wu_id === wuId);
  }

  if (lane) {
    filtered = filtered.filter((sig) => sig.lane === lane);
  }

  if (unreadOnly) {
    filtered = filtered.filter((sig) => sig.read === false);
  }

  if (since) {
    const sinceTime = since instanceof Date ? since : new Date(since);
    filtered = filtered.filter((sig) => new Date(sig.created_at) > sinceTime);
  }

  // Return in chronological order (file order is already chronological due to append-only)
  return filtered;
}

/**
 * Marks signals as read by appending receipts to signal-receipts.jsonl (WU-1472).
 *
 * Instead of rewriting signals.jsonl (which causes lost updates under
 * concurrency), this appends receipt records to a separate append-only file.
 * The loadSignals function merges these receipts to derive effective read state.
 *
 * Only signals that are currently unread (no inline read:true AND no existing
 * receipt) are counted in markedCount.
 *
 * @param baseDir - Project base directory
 * @param signalIds - Array of signal IDs to mark as read
 * @returns Result with count of signals marked
 *
 * @example
 * const result = await markSignalsAsRead('/project', ['sig-abc12345', 'sig-def67890']);
 * console.log(result.markedCount); // 2
 */
export async function markSignalsAsRead(
  baseDir: string,
  signalIds: string[],
): Promise<MarkAsReadResult> {
  const signalsPath = getSignalsPath(baseDir);
  const idSet = new Set<string>(signalIds);

  // Read signals file to determine which IDs exist and their inline read state
  let signalContent: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads signals file
    signalContent = await fs.readFile(signalsPath, { encoding: 'utf-8' as BufferEncoding });
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      // No signals file - nothing to mark
      return { markedCount: 0 };
    }
    throw error;
  }

  // Build map of existing signal read states
  const lines = signalContent.split('\n').filter((line) => line.trim());
  const inlineReadIds = new Set<string>();
  const existingIds = new Set<string>();
  for (const line of lines) {
    const signal = JSON.parse(line) as Signal;
    existingIds.add(signal.id);
    if (signal.read) {
      inlineReadIds.add(signal.id);
    }
  }

  // Load existing receipts to check for duplicates
  const existingReceiptIds = await loadReceiptIds(baseDir);

  // Determine which signals need new receipts
  const now = new Date().toISOString();
  const newReceipts: SignalReceipt[] = [];
  for (const id of idSet) {
    // Only create receipt if: signal exists, not already inline read, no existing receipt
    if (existingIds.has(id) && !inlineReadIds.has(id) && !existingReceiptIds.has(id)) {
      newReceipts.push({ signal_id: id, read_at: now });
    }
  }

  // Append receipts (append-only for concurrent safety)
  if (newReceipts.length > 0) {
    const memoryDir = getMemoryDir(baseDir);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
    await fs.mkdir(memoryDir, { recursive: true });
    const receiptsPath = getReceiptsPath(baseDir);
    const receiptLines = newReceipts.map((r) => JSON.stringify(r)).join('\n') + '\n';
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes receipts file
    await fs.appendFile(receiptsPath, receiptLines, 'utf-8');
  }

  return { markedCount: newReceipts.length };
}
