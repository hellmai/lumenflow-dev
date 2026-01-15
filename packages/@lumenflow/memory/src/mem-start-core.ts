/**
 * Memory Start Core (WU-1466)
 *
 * Core logic for creating session nodes linked to WUs.
 * Called by wu:claim enhancement for context restoration after /clear.
 *
 * Features:
 * - Creates session nodes with WU reference
 * - Stores agent type, start timestamp, context tier
 * - Idempotent: multiple starts create separate sessions
 * - Auto-initializes memory layer if not present
 *
 * @see {@link tools/mem-start.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-start.test.mjs} - Tests
 * @see {@link tools/lib/memory-schema.mjs} - Schema definitions
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateMemId } from './mem-id.js';
import { appendNode, MEMORY_FILE_NAME } from './memory-store.js';
import { MEMORY_PATTERNS } from './memory-schema.js';

/**
 * Memory directory path relative to base directory
 */
const MEMORY_DIR = '.beacon/memory';

/**
 * Default values for session metadata
 */
const DEFAULTS = {
  AGENT_TYPE: 'unknown',
  CONTEXT_TIER: 'full',
};

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  WU_ID_REQUIRED: 'wuId is required',
  WU_ID_INVALID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-123)',
};

/**
 * Session node type constant
 */
const NODE_TYPE_SESSION = 'session';

/**
 * WU lifecycle constant
 */
const LIFECYCLE_WU = 'wu';

/**
 * Validates WU ID format
 *
 * @param {string} wuId - WU ID to validate
 * @returns {boolean} True if valid
 */
function isValidWuId(wuId) {
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
 * Generates content description for session node
 *
 * @param {string} wuId - WU ID
 * @param {string} agentType - Agent type
 * @param {string} contextTier - Context tier
 * @returns {string} Content description
 */
function generateSessionContent(wuId, agentType, contextTier) {
  return `Session started for ${wuId}. Agent: ${agentType}, Context: ${contextTier}`;
}

/**
 * Session start options
 *
 * @typedef {object} StartSessionOptions
 * @property {string} wuId - Work Unit ID (required)
 * @property {string} [agentType] - Agent type (defaults to 'unknown')
 * @property {string} [contextTier] - Context tier (defaults to 'full')
 */

/**
 * Session start result
 *
 * @typedef {object} StartSessionResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {import('./memory-schema.mjs').MemoryNode} session - Created session node
 */

/**
 * Creates a new session node linked to a WU.
 *
 * Creates a session-type memory node with:
 * - Unique ID (mem-XXXX format)
 * - Link to WU via wu_id field
 * - Agent type and context tier in metadata
 * - UUID session_id for unique identification
 *
 * @param {string} baseDir - Base directory containing .beacon/memory/
 * @param {StartSessionOptions} options - Session options
 * @returns {Promise<StartSessionResult>} Result with created session node
 * @throws {Error} If wuId is missing or invalid
 *
 * @example
 * const result = await startSession('/path/to/project', {
 *   wuId: 'WU-1234',
 *   agentType: 'general-purpose',
 *   contextTier: 'core',
 * });
 * console.log(result.session.id); // 'mem-a1b2'
 */
export async function startSession(baseDir, options) {
  const { wuId, agentType = DEFAULTS.AGENT_TYPE, contextTier = DEFAULTS.CONTEXT_TIER } = options;

  // Validate required fields
  if (!wuId) {
    throw new Error(ERROR_MESSAGES.WU_ID_REQUIRED);
  }

  // Validate WU ID format
  if (!isValidWuId(wuId)) {
    throw new Error(ERROR_MESSAGES.WU_ID_INVALID);
  }

  // Ensure memory directory exists
  const memoryDir = await ensureMemoryDir(baseDir);

  // Generate session node
  const timestamp = new Date().toISOString();
  const sessionId = randomUUID();
  const content = generateSessionContent(wuId, agentType, contextTier);

  // Generate deterministic ID from content + timestamp for uniqueness
  const idContent = `${content}-${timestamp}-${sessionId}`;
  const id = generateMemId(idContent);

  /** @type {import('./memory-schema.mjs').MemoryNode} */
  const sessionNode = {
    id,
    type: NODE_TYPE_SESSION,
    lifecycle: LIFECYCLE_WU,
    content,
    created_at: timestamp,
    wu_id: wuId,
    session_id: sessionId,
    metadata: {
      agentType,
      contextTier,
    },
  };

  // Persist to memory store
  await appendNode(memoryDir, sessionNode);

  return {
    success: true,
    session: sessionNode,
  };
}
