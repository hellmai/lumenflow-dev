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
 * @see {@link packages/@lumenflow/cli/src/mem-checkpoint.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-checkpoint.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/memory-schema.ts} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateMemId } from './mem-id.js';
import { appendNode } from './memory-store.js';
import { MEMORY_PATTERNS } from './memory-schema.js';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

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
const NODE_TYPE_CHECKPOINT = 'checkpoint' as const;

/**
 * Checkpoint lifecycle constant (session-scoped for handoff context)
 */
const LIFECYCLE_SESSION = 'session' as const;

/**
 * Validates WU ID format if provided
 *
 * @param wuId - WU ID to validate
 * @returns True if valid or not provided
 */
function isValidWuId(wuId: string | undefined): boolean {
  if (!wuId) return true;
  return MEMORY_PATTERNS.WU_ID.test(wuId);
}

/**
 * Ensures the memory directory exists
 *
 * @param baseDir - Base directory
 * @returns Memory directory path
 */
async function ensureMemoryDir(baseDir: string): Promise<string> {
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known directory path
  await fs.mkdir(memoryDir, { recursive: true });
  return memoryDir;
}

/**
 * Generates content description for checkpoint node
 *
 * @param note - User-provided checkpoint note
 * @returns Content description
 */
function generateCheckpointContent(note: string): string {
  return `Checkpoint: ${note}`;
}

/**
 * Checkpoint creation options
 */
export interface CreateCheckpointOptions {
  /** Checkpoint note/description (required) */
  note: string;
  /** Session ID to link checkpoint to */
  sessionId?: string;
  /** Work Unit ID to link checkpoint to */
  wuId?: string;
  /** Progress summary */
  progress?: string;
  /** Next steps description */
  nextSteps?: string;
  /** Handoff trigger (e.g., 'clear', 'handoff') */
  trigger?: string;
}

/**
 * Checkpoint metadata stored in the node
 */
interface CheckpointMetadata {
  progress?: string;
  nextSteps?: string;
  trigger?: string;
  [key: string]: unknown;
}

/**
 * Memory node structure for checkpoints
 */
interface CheckpointNode {
  id: string;
  type: 'checkpoint';
  lifecycle: 'session';
  content: string;
  created_at: string;
  wu_id?: string;
  session_id?: string;
  metadata?: CheckpointMetadata;
}

/**
 * Checkpoint creation result
 */
export interface CreateCheckpointResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Created checkpoint node */
  checkpoint: CheckpointNode;
}

/**
 * Creates a new checkpoint node for context preservation.
 *
 * Creates a checkpoint-type memory node with:
 * - Unique ID (mem-XXXX format)
 * - User-provided note in content
 * - Optional session and WU linking
 * - Progress summary and next steps in metadata
 *
 * @param baseDir - Base directory containing .lumenflow/memory/
 * @param options - Checkpoint options
 * @returns Result with created checkpoint node
 * @throws If note is missing or WU ID is invalid
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
export async function createCheckpoint(
  baseDir: string,
  options: CreateCheckpointOptions,
): Promise<CreateCheckpointResult> {
  const { note, sessionId, wuId, progress, nextSteps, trigger } = options;

  // Validate required fields
  if (note == null) {
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
  const metadata: CheckpointMetadata = {};
  if (progress) {
    metadata.progress = progress;
  }
  if (nextSteps) {
    metadata.nextSteps = nextSteps;
  }
  if (trigger) {
    metadata.trigger = trigger;
  }

  const checkpointNode: CheckpointNode = {
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
      const stateDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.STATE_DIR);
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
