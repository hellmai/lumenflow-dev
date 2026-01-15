/**
 * Memory Create Core (WU-1469)
 *
 * Core logic for creating memory nodes with discovered-from provenance.
 * KEY DIFFERENTIATOR: supports discovered-from relationship for scope-creep
 * forensics. Creates audit trail of WHY work expanded, not just WHAT changed.
 *
 * Features:
 * - Creates all 5 node types: session, discovery, checkpoint, note, summary
 * - Auto-generates hash-based ID using mem-id
 * - Validates node against memory-schema
 * - Supports discovered-from relationship for provenance tracking
 *
 * @see {@link tools/mem-create.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-create.test.mjs} - Tests
 * @see {@link tools/lib/memory-schema.mjs} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { generateMemId } from './mem-id.js';
import { appendNode } from './memory-store.js';
import {
  MEMORY_NODE_TYPES,
  MEMORY_PATTERNS,
  validateMemoryNode,
  validateRelationship,
} from './memory-schema.js';

/**
 * Memory directory path relative to base directory
 */
const MEMORY_DIR = '.beacon/memory';

/**
 * Relationships file name
 */
const RELATIONSHIPS_FILE_NAME = 'relationships.jsonl';

/**
 * Default node type
 */
const DEFAULT_NODE_TYPE = 'discovery';

/**
 * Session file path relative to main checkout
 */
const SESSION_FILE_PATH = '.beacon/sessions/current.json';

/**
 * Type aliases for user-friendly CLI experience (WU-1762)
 * Maps alias names to canonical types and additional tags
 *
 * @type {Record<string, { type: string, tag: string }>}
 */
const TYPE_ALIASES = {
  bug: { type: 'discovery', tag: 'bug' },
  idea: { type: 'discovery', tag: 'idea' },
  question: { type: 'discovery', tag: 'question' },
  dependency: { type: 'discovery', tag: 'dependency' },
};

/**
 * Lifecycle mapping by node type
 * - session: Lives for WU duration (wu)
 * - discovery: Lives for WU duration (wu)
 * - checkpoint: Lives for session (session)
 * - note: Lives for session (session)
 * - summary: Persists across WUs (project)
 */
const LIFECYCLE_BY_TYPE = {
  session: 'wu',
  discovery: 'wu',
  checkpoint: 'session',
  note: 'session',
  summary: 'project',
};

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  TITLE_REQUIRED: 'title is required',
  TITLE_EMPTY: 'title cannot be empty',
  INVALID_TYPE: `Invalid node type. Must be one of: ${MEMORY_NODE_TYPES.join(', ')}`,
  WU_ID_INVALID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-123)',
  MEMORY_ID_INVALID: 'Invalid memory ID format. Expected pattern: mem-XXXX (e.g., mem-a1b2)',
};

/**
 * Normalizes type aliases to canonical types (WU-1762)
 *
 * Converts user-friendly type aliases (bug, idea) to canonical types (discovery)
 * and returns the tag to be added.
 *
 * @param {string} inputType - User-provided type (may be alias)
 * @returns {{ type: string, aliasTag: string | null }} Normalized type and optional tag
 */
function normalizeType(inputType) {
  // eslint-disable-next-line security/detect-object-injection -- inputType validated against TYPE_ALIASES
  const alias = TYPE_ALIASES[inputType];
  if (alias) {
    return { type: alias.type, aliasTag: alias.tag };
  }
  return { type: inputType, aliasTag: null };
}

/**
 * Checks if a path is a git worktree (has .git file pointing to main)
 *
 * @param {string} dir - Directory to check
 * @returns {Promise<string | null>} Path to main checkout or null if not a worktree
 */
async function getMainCheckoutFromWorktree(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known path
    const stat = await fs.stat(gitPath);
    if (stat.isFile()) {
      // .git is a file = we're in a worktree
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known path
      const gitContent = await fs.readFile(gitPath, 'utf-8');
      // Format: "gitdir: /path/to/main/.git/worktrees/name"
      const match = gitContent.match(/^gitdir:\s*(.+)/);
      if (match) {
        const gitDir = match[1].trim();
        // Extract main checkout: /path/to/main/.git/worktrees/name → /path/to/main
        const worktreesIndex = gitDir.indexOf('/.git/worktrees/');
        if (worktreesIndex !== -1) {
          return gitDir.substring(0, worktreesIndex);
        }
      }
    }
  } catch {
    // Not a worktree or .git doesn't exist
  }
  return null;
}

/**
 * Reads the current session from session file
 *
 * @param {string} baseDir - Base directory (main checkout)
 * @returns {Promise<{ wu_id?: string, session_id?: string } | null>} Session data or null
 */
async function readCurrentSession(baseDir) {
  const sessionPath = path.join(baseDir, SESSION_FILE_PATH);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known session path
    const content = await fs.readFile(sessionPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Auto-infers WU ID from current session (WU-1762)
 *
 * Checks for session file in:
 * 1. Current baseDir (if running in main checkout)
 * 2. Main checkout (if running in worktree)
 *
 * @param {string} baseDir - Current working directory
 * @returns {Promise<string | undefined>} WU ID from session or undefined
 */
async function inferSessionFromSessionFile(baseDir) {
  // First, try to read session from current directory
  let session = await readCurrentSession(baseDir);
  if (session) {
    return session;
  }

  // If not found, check if we're in a worktree and look in main checkout
  const mainCheckout = await getMainCheckoutFromWorktree(baseDir);
  if (mainCheckout) {
    session = await readCurrentSession(mainCheckout);
    if (session) {
      return session;
    }
  }

  return null;
}

function isValidSessionId(value) {
  if (!value) return false;
  if (typeof value !== 'string') return false;
  // UUID v4 format (sufficient for validation here; actual schema validates uuid too)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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
 * Validates memory ID format
 *
 * @param {string} memId - Memory ID to validate
 * @returns {boolean} True if valid
 */
function isValidMemoryId(memId) {
  return MEMORY_PATTERNS.MEMORY_ID.test(memId);
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
 * Appends a relationship to the relationships.jsonl file
 *
 * @param {string} memoryDir - Memory directory path
 * @param {object} relationship - Relationship object
 * @returns {Promise<object>} The appended relationship
 */
async function appendRelationship(memoryDir, relationship) {
  // Validate relationship before appending
  const validation = validateRelationship(relationship);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Relationship validation error: ${issues}`);
  }

  const filePath = path.join(memoryDir, RELATIONSHIPS_FILE_NAME);
  const line = `${JSON.stringify(relationship)}\n`;

  // Use append flag to avoid rewriting the file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes known file
  await fs.appendFile(filePath, line, 'utf-8');

  return relationship;
}

/**
 * Gets the lifecycle for a node type
 *
 * @param {string} type - Node type
 * @returns {string} Lifecycle value
 */
function getLifecycleForType(type) {
  // eslint-disable-next-line security/detect-object-injection -- type is validated against MEMORY_NODE_TYPES
  return LIFECYCLE_BY_TYPE[type] || 'wu';
}

/**
 * Memory node creation options
 *
 * @typedef {object} CreateMemoryNodeOptions
 * @property {string} title - Node title/content (required)
 * @property {string} [type='discovery'] - Node type (session, discovery, checkpoint, note, summary)
 * @property {string} [wuId] - Work Unit ID to link node to
 * @property {string} [sessionId] - Session ID to link node to
 * @property {string} [discoveredFrom] - Parent node ID for provenance tracking
 * @property {string[]} [tags] - Tags for categorization
 * @property {string} [priority] - Priority level (P0, P1, P2, P3)
 */

/**
 * Memory node creation result
 *
 * @typedef {object} CreateMemoryNodeResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {import('./memory-schema.mjs').MemoryNode} node - Created memory node
 * @property {import('./memory-schema.mjs').Relationship} [relationship] - Created relationship (if discoveredFrom provided)
 */

/**
 * Creates a new memory node with optional discovered-from provenance.
 *
 * Creates a memory node with:
 * - Unique ID (mem-XXXX format) generated from content hash
 * - User-provided title as content
 * - Type-appropriate lifecycle
 * - Optional discovered-from relationship for provenance tracking
 *
 * @param {string} baseDir - Base directory containing .beacon/memory/
 * @param {CreateMemoryNodeOptions} options - Node creation options
 * @returns {Promise<CreateMemoryNodeResult>} Result with created node and optional relationship
 * @throws {Error} If title is missing, type is invalid, or IDs are malformed
 *
 * @example
 * // Create a simple discovery node
 * const result = await createMemoryNode(baseDir, {
 *   title: 'Found relevant file at src/utils.mjs',
 *   type: 'discovery',
 *   wuId: 'WU-1469',
 * });
 *
 * @example
 * // Create a node with provenance (scope-creep tracking)
 * const parent = await createMemoryNode(baseDir, {
 *   title: 'Found src/components/',
 *   type: 'discovery',
 * });
 * const child = await createMemoryNode(baseDir, {
 *   title: 'Found src/components/Button.tsx',
 *   type: 'discovery',
 *   discoveredFrom: parent.node.id, // Track where this came from
 * });
 */
export async function createMemoryNode(baseDir, options) {
  const {
    title,
    type: inputType = DEFAULT_NODE_TYPE,
    wuId: explicitWuId,
    sessionId: explicitSessionId,
    discoveredFrom,
    tags: inputTags,
    priority,
  } = options;

  // Validate required fields
  if (title === undefined || title === null) {
    throw new Error(ERROR_MESSAGES.TITLE_REQUIRED);
  }

  if (title === '') {
    throw new Error(ERROR_MESSAGES.TITLE_EMPTY);
  }

  // Normalize type aliases (WU-1762): bug → discovery + tag, idea → discovery + tag
  const { type, aliasTag } = normalizeType(inputType);

  // Validate node type (after alias normalization)
  if (!MEMORY_NODE_TYPES.includes(type)) {
    throw new Error(ERROR_MESSAGES.INVALID_TYPE);
  }

  // Merge tags: alias tag + user-provided tags, deduplicated (WU-1762)
  let tags = inputTags ? [...inputTags] : [];
  if (aliasTag && !tags.includes(aliasTag)) {
    tags = [aliasTag, ...tags];
  }
  // Remove duplicates while preserving order
  tags = [...new Set(tags)];

  // Auto-infer WU ID and session ID from current session if not provided (WU-1762)
  const inferredSession = explicitWuId && explicitSessionId ? null : await inferSessionFromSessionFile(baseDir);
  const wuId = explicitWuId || inferredSession?.wu_id;
  const sessionId =
    explicitSessionId || (isValidSessionId(inferredSession?.session_id) ? inferredSession.session_id : undefined);

  // Validate WU ID format if provided
  if (wuId && !isValidWuId(wuId)) {
    throw new Error(ERROR_MESSAGES.WU_ID_INVALID);
  }

  // Validate discovered-from ID format if provided
  if (discoveredFrom && !isValidMemoryId(discoveredFrom)) {
    throw new Error(ERROR_MESSAGES.MEMORY_ID_INVALID);
  }

  // Ensure memory directory exists
  const memoryDir = await ensureMemoryDir(baseDir);

  // Generate node
  const timestamp = new Date().toISOString();

  // Generate deterministic ID from content + timestamp for uniqueness
  const idContent = `${title}-${timestamp}`;
  const id = generateMemId(idContent);

  // Get lifecycle for this type
  const lifecycle = getLifecycleForType(type);

  // Build metadata object
  const metadata = {};
  if (priority) {
    metadata.priority = priority;
  }

  /** @type {import('./memory-schema.mjs').MemoryNode} */
  const node = {
    id,
    type,
    lifecycle,
    content: title,
    created_at: timestamp,
  };

  // Add optional fields
  if (wuId) {
    node.wu_id = wuId;
  }
  if (sessionId) {
    node.session_id = sessionId;
  }
  if (Object.keys(metadata).length > 0) {
    node.metadata = metadata;
  }
  if (tags && tags.length > 0) {
    node.tags = tags;
  }

  // Validate node against schema
  const nodeValidation = validateMemoryNode(node);
  if (!nodeValidation.success) {
    const issues = nodeValidation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Node validation error: ${issues}`);
  }

  // Persist node to memory store
  await appendNode(memoryDir, node);

  // Build result
  const result = {
    success: true,
    node,
  };

  // Create discovered-from relationship if parent specified
  if (discoveredFrom) {
    const relationship = {
      from_id: node.id,
      to_id: discoveredFrom,
      type: 'discovered_from',
      created_at: timestamp,
    };

    await appendRelationship(memoryDir, relationship);
    result.relationship = relationship;
  }

  return result;
}
