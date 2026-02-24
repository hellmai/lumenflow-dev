// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
 * @see {@link packages/@lumenflow/cli/src/mem-create.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-create.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/memory-schema.ts} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { GIT_DIRECTORY_NAME, GIT_WORKTREES_SENTINEL } from '@lumenflow/core/config';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { generateMemId } from './mem-id.js';
import { appendNode } from './memory-store.js';
import {
  MEMORY_NODE_TYPES,
  MEMORY_LIFECYCLES,
  MEMORY_PATTERNS,
  validateMemoryNode,
  validateRelationship,
  type MemoryNode,
} from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';
import { ensureMemoryDir } from './fs-utils.js';

/**
 * Relationships file name
 */
const RELATIONSHIPS_FILE_NAME = 'relationships.jsonl';

/**
 * Default node type
 */
const DEFAULT_NODE_TYPE = 'discovery';

/**
 * Type alias entry for friendly CLI types
 */
interface TypeAliasEntry {
  type: string;
  tag: string;
}

/**
 * Type aliases for user-friendly CLI experience (WU-1762)
 * Maps alias names to canonical types and additional tags
 */
const TYPE_ALIASES: Record<string, TypeAliasEntry> = {
  bug: { type: 'discovery', tag: 'bug' },
  idea: { type: 'discovery', tag: 'idea' },
  question: { type: 'discovery', tag: 'question' },
  dependency: { type: 'discovery', tag: 'dependency' },
};

/**
 * Memory node types (derived from schema)
 */
type MemoryNodeType = (typeof MEMORY_NODE_TYPES)[number];

/**
 * Memory lifecycle types (derived from schema)
 */
type MemoryLifecycleType = (typeof MEMORY_LIFECYCLES)[number];

/**
 * Lifecycle mapping by node type
 * - session: Lives for WU duration (wu)
 * - discovery: Lives for WU duration (wu)
 * - checkpoint: Lives for session (session)
 * - note: Lives for session (session)
 * - summary: Persists across WUs (project)
 */
const LIFECYCLE_BY_TYPE: Record<MemoryNodeType, MemoryLifecycleType> = {
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
 * @param inputType - User-provided type (may be alias)
 * @returns Normalized type and optional tag
 */
function normalizeType(inputType: string): { type: string; aliasTag: string | null } {
  const alias = TYPE_ALIASES[inputType];
  if (alias) {
    return { type: alias.type, aliasTag: alias.tag };
  }
  return { type: inputType, aliasTag: null };
}

/**
 * Checks if a path is a git worktree (has git metadata file pointing to main)
 *
 * @param dir - Directory to check
 * @returns Path to main checkout or null if not a worktree
 */
async function getMainCheckoutFromWorktree(dir: string): Promise<string | null> {
  const gitPath = path.join(dir, GIT_DIRECTORY_NAME);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known path
    const stat = await fs.stat(gitPath);
    if (stat.isFile()) {
      // Git metadata file means we're in a worktree
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known path
      const gitContent = await fs.readFile(gitPath, { encoding: 'utf-8' as BufferEncoding });
      // Format: "gitdir: /path/to/main/.git/worktrees/name"
      const match = gitContent.match(/^gitdir:\s*(.+)/);
      if (match && match[1]) {
        const gitDir = match[1].trim();
        // Extract main checkout: /path/to/main/.git/worktrees/name → /path/to/main
        const worktreesIndex = gitDir.indexOf(GIT_WORKTREES_SENTINEL);
        if (worktreesIndex !== -1) {
          return gitDir.substring(0, worktreesIndex);
        }
      }
    }
  } catch {
    // Not a worktree or git metadata file doesn't exist
  }
  return null;
}

/**
 * Session data from session file
 */
interface SessionData {
  wu_id?: string;
  session_id?: string;
}

/**
 * Reads the current session from session file
 *
 * @param baseDir - Base directory (main checkout)
 * @returns Session data or null
 */
async function readCurrentSession(baseDir: string): Promise<SessionData | null> {
  const sessionPath = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.SESSION_CURRENT);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known session path
    const content = await fs.readFile(sessionPath, { encoding: 'utf-8' as BufferEncoding });
    return JSON.parse(content) as SessionData;
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
 * @param baseDir - Current working directory
 * @returns Session data from session file or null
 */
async function inferSessionFromSessionFile(baseDir: string): Promise<SessionData | null> {
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

function isValidSessionId(value: unknown): value is string {
  if (!value) return false;
  if (typeof value !== 'string') return false;
  // UUID v4 format (sufficient for validation here; actual schema validates uuid too)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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
 * Validates memory ID format
 *
 * @param memId - Memory ID to validate
 * @returns True if valid
 */
function isValidMemoryId(memId: string): boolean {
  return MEMORY_PATTERNS.MEMORY_ID.test(memId);
}

/**
 * Appends a relationship to the relationships.jsonl file
 *
 * @param memoryDir - Memory directory path
 * @param relationship - Relationship object
 * @returns The appended relationship
 */
async function appendRelationship(
  memoryDir: string,
  relationship: Relationship,
): Promise<Relationship> {
  // Validate relationship before appending
  const validation = validateRelationship(relationship);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Relationship validation error: ${issues}`);
  }

  const filePath = path.join(memoryDir, RELATIONSHIPS_FILE_NAME);
  const line = `${JSON.stringify(relationship)}\n`;

  // Use append flag to avoid rewriting the file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes known file
  await fs.appendFile(filePath, line, { encoding: 'utf-8' as BufferEncoding });

  return relationship;
}

/**
 * Gets the lifecycle for a node type
 *
 * @param type - Node type
 * @returns Lifecycle value
 */
function getLifecycleForType(type: MemoryNodeType): MemoryLifecycleType {
  return LIFECYCLE_BY_TYPE[type];
}

/**
 * Memory node creation options
 */
export interface CreateMemoryNodeOptions {
  /** Node title/content (required) */
  title: string;
  /** Node type (session, discovery, checkpoint, note, summary) */
  type?: string;
  /** Work Unit ID to link node to */
  wuId?: string;
  /** Session ID to link node to */
  sessionId?: string;
  /** Parent node ID for provenance tracking */
  discoveredFrom?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Priority level (P0, P1, P2, P3) */
  priority?: string;
}

/**
 * Relationship between memory nodes
 */
interface Relationship {
  from_id: string;
  to_id: string;
  type: string;
  created_at: string;
}

/**
 * Memory node creation result
 */
export interface CreateMemoryNodeResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Created memory node */
  node: MemoryNode;
  /** Created relationship (if discoveredFrom provided) */
  relationship?: Relationship;
}

/**
 * Creates a new memory node with optional discovered-from provenance.
 *
 * Creates a memory node with:
 * - Unique ID (mem-XXXX format) generated from content hash
 * - User-provided title as content
 * - Type-appropriate lifecycle
 * - Optional discovered-from relationship for provenance tracking
 *
 * @param {string} baseDir - Base directory containing .lumenflow/memory/
 * @param {CreateMemoryNodeOptions} options - Node creation options
 * @returns {Promise<CreateMemoryNodeResult>} Result with created node and optional relationship
 * @throws {Error} If title is missing, type is invalid, or IDs are malformed
 *
 * @example
 * // Create a simple discovery node
 * const result = await createMemoryNode(baseDir, {
 *   title: 'Found relevant file at src/utils.ts',
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
export async function createMemoryNode(
  baseDir: string,
  options: CreateMemoryNodeOptions,
): Promise<CreateMemoryNodeResult> {
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
  if (title == null) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.TITLE_REQUIRED);
  }

  if (title === '') {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.TITLE_EMPTY);
  }

  // Normalize type aliases (WU-1762): bug → discovery + tag, idea → discovery + tag
  const { type: normalizedType, aliasTag } = normalizeType(inputType);

  // Validate node type (after alias normalization) and narrow type
  if (!MEMORY_NODE_TYPES.includes(normalizedType as MemoryNodeType)) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.INVALID_TYPE);
  }
  // Type is now validated - safe to cast
  const type = normalizedType as MemoryNodeType;

  // Merge tags: alias tag + user-provided tags, deduplicated (WU-1762)
  let tags = inputTags ? [...inputTags] : [];
  if (aliasTag && !tags.includes(aliasTag)) {
    tags = [aliasTag, ...tags];
  }
  // Remove duplicates while preserving order
  tags = [...new Set(tags)];

  // Auto-infer WU ID and session ID from current session if not provided (WU-1762)
  const inferredSession =
    explicitWuId && explicitSessionId ? null : await inferSessionFromSessionFile(baseDir);
  const wuId = explicitWuId || inferredSession?.wu_id;
  const sessionId =
    explicitSessionId ||
    (isValidSessionId(inferredSession?.session_id) ? inferredSession.session_id : undefined);

  // Validate WU ID format if provided
  if (wuId && !isValidWuId(wuId)) {
    throw createError(ErrorCodes.INVALID_WU_ID, ERROR_MESSAGES.WU_ID_INVALID);
  }

  // Validate discovered-from ID format if provided
  if (discoveredFrom && !isValidMemoryId(discoveredFrom)) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.MEMORY_ID_INVALID);
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
  const metadata: Record<string, unknown> = {};
  if (priority) {
    metadata.priority = priority;
  }

  const node: MemoryNode = {
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
    throw createError(ErrorCodes.VALIDATION_ERROR, `Node validation error: ${issues}`);
  }

  // Persist node to memory store
  await appendNode(memoryDir, node);

  // Build result
  const result: CreateMemoryNodeResult = {
    success: true,
    node,
  };

  // Create discovered-from relationship if parent specified
  if (discoveredFrom) {
    const relationship: Relationship = {
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
