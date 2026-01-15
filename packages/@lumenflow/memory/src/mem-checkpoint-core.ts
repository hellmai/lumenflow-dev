/**
 * Memory Checkpoint Core (WU-1467, WU-1748)
 *
 * Core logic for creating checkpoint nodes for context snapshots.
 * Used before /clear or session handoff to preserve progress state.
 *
 * Features:
 * - Creates checkpoint nodes with progress summary and next steps
 * - Optional linking to sessions and WUs
 * - Supports handoff trigger detection
 * - Auto-initializes memory layer if not present
 * - WU-1748: Persists to wu-events.jsonl for cross-agent visibility
 *
 * @see {@link tools/mem-checkpoint.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-checkpoint.test.mjs} - Tests
 * @see {@link tools/lib/memory-schema.mjs} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateMemId } from './mem-id.js';
import { appendNode } from './memory-store.js';
import { MEMORY_PATTERNS } from './memory-schema.js';
import { WUStateStore } from '@lumenflow/core/dist/wu-state-store.js';

/**
 * Memory directory path relative to base directory
 */
const MEMORY_DIR = '.beacon/memory';

/**
 * WU state directory path relative to base directory (WU-1748)
 */
const STATE_DIR = '.beacon/state';

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  NOTE_REQUIRED: 'note is required',
  NOTE_EMPTY: 'note cannot be empty',
  WU_ID_INVALID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-123)',
};

/**
 * Checkpoint node type constant
 */
const NODE_TYPE_CHECKPOINT = 'checkpoint';

/**
 * Checkpoint lifecycle constant (session-scoped for handoff context)
 */
const LIFECYCLE_SESSION = 'session';

/**
 * Validates WU ID format if provided
 *
 * @param {string|undefined} wuId - WU ID to validate
 * @returns {boolean} True if valid or not provided
 */
function isValidWuId(wuId) {
  if (!wuId) return true;
  return MEMORY_PATTERNS.WU_ID.test(wuId);
}

/**
 * Ensures the memory directory exists
 *
 * @param {string} baseDir - Base directory
 * @returns {Promise<string>} Memory directory path
 */
async function ensureMemoryDir(baseDir) {
  const memoryDir = path.join(baseDir, MEMORY_DIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known directory path
  await fs.mkdir(memoryDir, { recursive: true });
  return memoryDir;
}

/**
 * Generates content description for checkpoint node
 *
 * @param {string} note - User-provided checkpoint note
 * @returns {string} Content description
 */
function generateCheckpointContent(note) {
  return `Checkpoint: ${note}`;
}

/**
 * Checkpoint creation options
 *
 * @typedef {object} CreateCheckpointOptions
 * @property {string} note - Checkpoint note/description (required)
 * @property {string} [sessionId] - Session ID to link checkpoint to
 * @property {string} [wuId] - Work Unit ID to link checkpoint to
 * @property {string} [progress] - Progress summary
 * @property {string} [nextSteps] - Next steps description
 * @property {string} [trigger] - Handoff trigger (e.g., 'clear', 'handoff')
 */

/**
 * Checkpoint creation result
 *
 * @typedef {object} CreateCheckpointResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {import('./memory-schema.mjs').MemoryNode} checkpoint - Created checkpoint node
 */

/**
 * Creates a new checkpoint node for context preservation.
 *
 * Creates a checkpoint-type memory node with:
 * - Unique ID (mem-XXXX format)
 * - User-provided note in content
 * - Optional session and WU linking
 * - Progress summary and next steps in metadata
 *
 * @param {string} baseDir - Base directory containing .beacon/memory/
 * @param {CreateCheckpointOptions} options - Checkpoint options
 * @returns {Promise<CreateCheckpointResult>} Result with created checkpoint node
 * @throws {Error} If note is missing or WU ID is invalid
 *
 * @example
 * const result = await createCheckpoint(baseDir, {
 *   note: 'Before /clear - completed TDD tests',
 *   sessionId: 'session-uuid',
 *   wuId: 'WU-1467',
 *   progress: 'TDD tests passing, core module implemented',
 *   nextSteps: 'Implement CLI wrapper, add package.json script',
 * });
 * console.log(result.checkpoint.id); // 'mem-a1b2'
 */
export async function createCheckpoint(baseDir, options) {
  const { note, sessionId, wuId, progress, nextSteps, trigger } = options;

  // Validate required fields
  if (note === undefined || note === null) {
    throw new Error(ERROR_MESSAGES.NOTE_REQUIRED);
  }

  if (note === '') {
    throw new Error(ERROR_MESSAGES.NOTE_EMPTY);
  }

  // Validate WU ID format if provided
  if (wuId && !isValidWuId(wuId)) {
    throw new Error(ERROR_MESSAGES.WU_ID_INVALID);
  }

  // Ensure memory directory exists
  const memoryDir = await ensureMemoryDir(baseDir);

  // Generate checkpoint node
  const timestamp = new Date().toISOString();
  const content = generateCheckpointContent(note);

  // Generate deterministic ID from content + timestamp for uniqueness
  const idContent = `${content}-${timestamp}`;
  const id = generateMemId(idContent);

  // Build metadata object
  const metadata = {};
  if (progress) {
    metadata.progress = progress;
  }
  if (nextSteps) {
    metadata.nextSteps = nextSteps;
  }
  if (trigger) {
    metadata.trigger = trigger;
  }

  /** @type {import('./memory-schema.mjs').MemoryNode} */
  const checkpointNode = {
    id,
    type: NODE_TYPE_CHECKPOINT,
    lifecycle: LIFECYCLE_SESSION,
    content,
    created_at: timestamp,
  };

  // Add optional fields
  if (wuId) {
    checkpointNode.wu_id = wuId;
  }
  if (sessionId) {
    checkpointNode.session_id = sessionId;
  }
  if (Object.keys(metadata).length > 0) {
    checkpointNode.metadata = metadata;
  }

  // Persist to memory store
  await appendNode(memoryDir, checkpointNode);

  // WU-1748: Also persist to wu-events.jsonl for cross-agent visibility
  if (wuId) {
    try {
      const stateDir = path.join(baseDir, STATE_DIR);
      const store = new WUStateStore(stateDir);
      await store.checkpoint(wuId, note, {
        sessionId,
        progress,
        nextSteps,
      });
    } catch {
      // Non-fatal: if state store write fails, checkpoint is still in memory store
      // This can happen if the WU hasn't been claimed yet
    }
  }

  return {
    success: true,
    checkpoint: checkpointNode,
  };
}
