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
 * @see {@link tools/mem-signal.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-signal.test.mjs} - Tests
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Signal file name constant
 */
export const SIGNAL_FILE_NAME = 'signals.jsonl';

/**
 * Memory directory path within project
 */
const MEMORY_DIR = '._legacy/memory';

/**
 * WU ID validation pattern (from memory-schema.mjs)
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
 * @typedef {object} Signal
 * @property {string} id - Unique signal identifier (sig-XXXXXXXX)
 * @property {string} message - Signal content/message
 * @property {string} created_at - ISO 8601 timestamp
 * @property {boolean} read - Whether signal has been read
 * @property {string} [wu_id] - Optional WU ID scope
 * @property {string} [lane] - Optional target lane
 */

/**
 * @typedef {object} CreateSignalResult
 * @property {boolean} success - Whether signal was created successfully
 * @property {Signal} signal - The created signal object
 */

/**
 * @typedef {object} CreateSignalOptions
 * @property {string} message - Signal message content (required)
 * @property {string} [wuId] - WU ID to scope signal to
 * @property {string} [lane] - Lane to target signal to
 */

/**
 * @typedef {object} LoadSignalsOptions
 * @property {string} [wuId] - Filter by WU ID
 * @property {string} [lane] - Filter by lane
 * @property {boolean} [unreadOnly] - Only return unread signals
 * @property {Date} [since] - Only return signals created after this time
 */

/**
 * @typedef {object} MarkAsReadResult
 * @property {number} markedCount - Number of signals marked as read
 */

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

/**
 * Gets the memory directory path for a project.
 *
 * @param {string} baseDir - Project base directory
 * @returns {string} Full path to memory directory
 */
function getMemoryDir(baseDir) {
  return path.join(baseDir, MEMORY_DIR);
}

/**
 * Gets the signals file path for a project.
 *
 * @param {string} baseDir - Project base directory
 * @returns {string} Full path to signals.jsonl
 */
function getSignalsPath(baseDir) {
  return path.join(getMemoryDir(baseDir), SIGNAL_FILE_NAME);
}

/**
 * Validates a WU ID format.
 *
 * @param {string} wuId - WU ID to validate
 * @returns {boolean} True if valid
 */
function isValidWuId(wuId) {
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
export async function createSignal(baseDir, options) {
  const { message, wuId, lane } = options;

  // Validate message is provided and non-empty
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error(ERROR_MESSAGES.MESSAGE_REQUIRED);
  }

  // Validate WU ID format if provided
  if (wuId !== undefined && !isValidWuId(wuId)) {
    throw new Error(ERROR_MESSAGES.INVALID_WU_ID);
  }

  // Build signal object
  const signal = {
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
export async function loadSignals(baseDir, options = {}) {
  const { wuId, lane, unreadOnly, since } = options;
  const signalsPath = getSignalsPath(baseDir);

  // Read file content
  let content;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads signals file
    content = await fs.readFile(signalsPath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - return empty array
      return [];
    }
    throw error;
  }

  // Parse JSONL content
  const lines = content.split('\n').filter((line) => line.trim());
  const signals = lines.map((line) => JSON.parse(line));

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
 * Marks signals as read by updating the signals file.
 *
 * Reads the entire file, updates the read status for matching IDs,
 * and writes back. Only signals that were previously unread are counted.
 *
 * @param {string} baseDir - Project base directory
 * @param {string[]} signalIds - Array of signal IDs to mark as read
 * @returns {Promise<MarkAsReadResult>} Result with count of signals marked
 *
 * @example
 * const result = await markSignalsAsRead('/project', ['sig-abc12345', 'sig-def67890']);
 * console.log(result.markedCount); // 2
 */
export async function markSignalsAsRead(baseDir, signalIds) {
  const signalsPath = getSignalsPath(baseDir);
  const idSet = new Set(signalIds);
  let markedCount = 0;

  // Read file content
  let content;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads signals file
    content = await fs.readFile(signalsPath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // No signals file - nothing to mark
      return { markedCount: 0 };
    }
    throw error;
  }

  // Parse JSONL content
  const lines = content.split('\n').filter((line) => line.trim());
  const updatedLines = lines.map((line) => {
    const signal = JSON.parse(line);
    if (idSet.has(signal.id) && signal.read === false) {
      signal.read = true;
      markedCount++;
    }
    return JSON.stringify(signal);
  });

  // Write back updated content
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes signals file
  await fs.writeFile(signalsPath, `${updatedLines.join('\n')}\n`, 'utf-8');

  return { markedCount };
}
