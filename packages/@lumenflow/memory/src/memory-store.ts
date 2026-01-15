/**
 * Memory Store (WU-1463)
 *
 * JSONL-based memory store with load, query, and append operations.
 * Git-friendly format with one node per line for merge-safe diffs.
 *
 * Features:
 * - Append-only writes (no full file rewrite)
 * - Indexed lookups by ID and WU
 * - Deterministic queryReady() ordering by priority then createdAt
 *
 * @see {@link tools/lib/__tests__/memory-store.test.mjs} - Tests
 * @see {@link tools/lib/memory-schema.mjs} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validateMemoryNode } from './memory-schema.js';

/**
 * Memory file name constant
 */
export const MEMORY_FILE_NAME = 'memory.jsonl';

/**
 * Priority ranking for deterministic ordering.
 * Lower rank = higher priority.
 * P0 is highest priority, nodes without priority are lowest.
 */
const PRIORITY_RANK = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Default rank for nodes without priority (lowest priority) */
const DEFAULT_PRIORITY_RANK = 999;

/**
 * @typedef {import('./memory-schema.mjs').MemoryNode} MemoryNode
 */

/**
 * Indexed memory result from loadMemory
 *
 * @typedef {object} IndexedMemory
 * @property {MemoryNode[]} nodes - All loaded nodes in file order
 * @property {Map<string, MemoryNode>} byId - Nodes indexed by ID
 * @property {Map<string, MemoryNode[]>} byWu - Nodes indexed by WU ID
 */

/**
 * Gets the priority rank for a node.
 * Lower rank = higher priority.
 *
 * @param {MemoryNode} node - Memory node
 * @returns {number} Priority rank
 */
function getPriorityRank(node) {
  const priority = node.metadata?.priority;
  if (!priority) {
    return DEFAULT_PRIORITY_RANK;
  }
  return PRIORITY_RANK[priority] ?? DEFAULT_PRIORITY_RANK;
}

/**
 * Comparator for deterministic ordering: priority first, then createdAt.
 *
 * @param {MemoryNode} a - First node
 * @param {MemoryNode} b - Second node
 * @returns {number} Comparison result (-1, 0, 1)
 */
function compareNodes(a, b) {
  // Primary: sort by priority (lower rank first)
  const priorityDiff = getPriorityRank(a) - getPriorityRank(b);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  // Secondary: sort by created_at (oldest first)
  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  // Tertiary: stable sort by ID for identical priority and timestamp
  return a.id.localeCompare(b.id);
}

/**
 * Loads memory from JSONL file and returns indexed nodes.
 *
 * Handles:
 * - Missing file: returns empty result
 * - Empty file: returns empty result
 * - Empty lines: skipped gracefully
 * - Malformed JSON: throws error with line info
 * - Invalid nodes: throws validation error
 *
 * @param {string} baseDir - Directory containing memory.jsonl
 * @returns {Promise<IndexedMemory>} Indexed memory nodes
 * @throws {Error} If file contains malformed JSON or invalid nodes
 *
 * @example
 * const memory = await loadMemory('/path/to/project');
 * const node = memory.byId.get('mem-abc1');
 * const wuNodes = memory.byWu.get('WU-1463') ?? [];
 */
export async function loadMemory(baseDir) {
  const filePath = path.join(baseDir, MEMORY_FILE_NAME);
  const result = {
    nodes: [],
    byId: new Map(),
    byWu: new Map(),
  };

  // Check if file exists
  let content;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - return empty result
      return result;
    }
    throw error;
  }

  // Parse JSONL content
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      continue;
    }

    // Parse JSON line
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed JSON on line ${i + 1}: ${error.message}`);
    }

    // Validate against schema
    const validation = validateMemoryNode(parsed);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error on line ${i + 1}: ${issues}`);
    }

    const node = validation.data;

    // Add to nodes array
    result.nodes.push(node);

    // Index by ID
    result.byId.set(node.id, node);

    // Index by WU ID if present
    if (node.wu_id) {
      if (!result.byWu.has(node.wu_id)) {
        result.byWu.set(node.wu_id, []);
      }
      result.byWu.get(node.wu_id).push(node);
    }
  }

  return result;
}

/**
 * Appends a single node to the memory file.
 *
 * Uses append mode to avoid full file rewrite.
 * Creates file if it doesn't exist.
 * Validates node before appending.
 *
 * @param {string} baseDir - Directory containing memory.jsonl
 * @param {MemoryNode} node - Node to append
 * @returns {Promise<MemoryNode>} The appended node
 * @throws {Error} If node fails validation
 *
 * @example
 * const node = await appendNode('/path/to/project', {
 *   id: 'mem-abc1',
 *   type: 'discovery',
 *   lifecycle: 'wu',
 *   content: 'Found relevant file',
 *   created_at: new Date().toISOString(),
 *   wu_id: 'WU-1463',
 * });
 */
export async function appendNode(baseDir, node) {
  // Validate node before appending
  const validation = validateMemoryNode(node);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Validation error: ${issues}`);
  }

  const filePath = path.join(baseDir, MEMORY_FILE_NAME);
  const line = JSON.stringify(node) + '\n';

  // Use append flag to avoid rewriting the file
  await fs.appendFile(filePath, line, 'utf-8');

  return node;
}

/**
 * Queries nodes ready for processing by WU ID.
 *
 * Returns nodes linked to the WU in deterministic order:
 * 1. Priority (P0 first, then P1, P2, P3; nodes without priority last)
 * 2. Created timestamp (oldest first for same priority)
 * 3. ID (for stable sort when priority and timestamp match)
 *
 * @param {string} baseDir - Directory containing memory.jsonl
 * @param {string} wuId - WU ID to query (e.g., 'WU-1463')
 * @returns {Promise<MemoryNode[]>} Deterministically ordered nodes for WU
 *
 * @example
 * const ready = await queryReady('/path/to/project', 'WU-1463');
 * // Process highest priority, oldest items first
 * for (const node of ready) {
 *   await processNode(node);
 * }
 */
export async function queryReady(baseDir, wuId) {
  const memory = await loadMemory(baseDir);

  // Get nodes for this WU
  const wuNodes = memory.byWu.get(wuId) ?? [];

  // Return sorted copy (don't mutate original)
  return [...wuNodes].sort(compareNodes);
}

/**
 * Queries all nodes linked to a WU ID.
 *
 * Returns nodes in file order (insertion order).
 * Use queryReady() instead if you need deterministic priority ordering.
 *
 * @param {string} baseDir - Directory containing memory.jsonl
 * @param {string} wuId - WU ID to query (e.g., 'WU-1463')
 * @returns {Promise<MemoryNode[]>} All nodes for WU in file order
 *
 * @example
 * const nodes = await queryByWu('/path/to/project', 'WU-1463');
 * console.log(`Found ${nodes.length} nodes for WU-1463`);
 */
export async function queryByWu(baseDir, wuId) {
  const memory = await loadMemory(baseDir);
  return memory.byWu.get(wuId) ?? [];
}
