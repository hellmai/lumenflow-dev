// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Store (WU-1463, WU-1238)
 *
 * JSONL-based memory store with load, query, and append operations.
 * Git-friendly format with one node per line for merge-safe diffs.
 *
 * Features:
 * - Append-only writes (no full file rewrite)
 * - Indexed lookups by ID and WU
 * - Deterministic queryReady() ordering by priority then createdAt
 * - WU-1238: Support for archived node filtering
 * - WU-1238: Decay score-based sorting option
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/memory-store.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/memory-schema.ts} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeFsError } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { validateMemoryNode, type MemoryNode } from './memory-schema.js';

/**
 * Memory file name constant
 */
export const MEMORY_FILE_NAME = 'memory.jsonl';

/**
 * Priority levels for memory nodes
 */
type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Priority ranking for deterministic ordering.
 * Lower rank = higher priority.
 * P0 is highest priority, nodes without priority are lowest.
 */
const PRIORITY_RANK: Record<PriorityLevel, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Default rank for nodes without priority (lowest priority) */
const DEFAULT_PRIORITY_RANK = 999;

// WU-1548: NodeFsError imported from @lumenflow/core/wu-constants (consolidated)

/**
 * Indexed memory result from loadMemory
 */
/**
 * Options for loading memory
 */
export interface LoadMemoryOptions {
  /** If true, include archived nodes (default: false) */
  includeArchived?: boolean;
}

/**
 * Indexed memory result from loadMemory
 */
export interface IndexedMemory {
  /** All loaded nodes in file order */
  nodes: MemoryNode[];
  /** Nodes indexed by ID */
  byId: Map<string, MemoryNode>;
  /** Nodes indexed by WU ID */
  byWu: Map<string, MemoryNode[]>;
}

/**
 * Options for memory store query functions
 */
export interface MemoryQueryOptions {
  /** If true, include archived nodes (default: false) */
  includeArchived?: boolean;
}

/**
 * Gets the priority rank for a node.
 * Lower rank = higher priority.
 *
 * @param node - Memory node
 * @returns Priority rank
 */
function getPriorityRank(node: MemoryNode): number {
  const priority = node.metadata?.priority as PriorityLevel | undefined;
  if (!priority) {
    return DEFAULT_PRIORITY_RANK;
  }
  return PRIORITY_RANK[priority] ?? DEFAULT_PRIORITY_RANK;
}

/**
 * Comparator for deterministic ordering: priority first, then createdAt.
 *
 * @param a - First node
 * @param b - Second node
 * @returns Comparison result (-1, 0, 1)
 */
function compareNodes(a: MemoryNode, b: MemoryNode): number {
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
 * Check if a node is archived (WU-1238).
 *
 * @param node - Memory node to check
 * @returns True if node has metadata.status = 'archived'
 */
function isNodeArchived(node: MemoryNode): boolean {
  return node.metadata?.status === 'archived';
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
 * @param baseDir - Directory containing memory.jsonl
 * @returns Indexed memory nodes
 * @throws If file contains malformed JSON or invalid nodes
 *
 * @example
 * const memory = await loadMemory('/path/to/project');
 * const node = memory.byId.get('mem-abc1');
 * const wuNodes = memory.byWu.get('WU-1463') ?? [];
 *
 * @example
 * // WU-1238: Include archived nodes
 * const allMemory = await loadMemory('/path/to/project', { includeArchived: true });
 */
export async function loadMemory(
  baseDir: string,
  options: LoadMemoryOptions = {},
): Promise<IndexedMemory> {
  const { includeArchived = false } = options;
  const filePath = path.join(baseDir, MEMORY_FILE_NAME);

  const content = await readMemoryFileOrEmpty(filePath);
  if (content === null) {
    return createEmptyIndexedMemory();
  }

  return parseAndIndexMemory(content, includeArchived);
}

/**
 * Reads memory file content, returning null if file doesn't exist
 */
async function readMemoryFileOrEmpty(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, { encoding: 'utf-8' as BufferEncoding });
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Creates an empty indexed memory result
 */
function createEmptyIndexedMemory(): IndexedMemory {
  return {
    nodes: [],
    byId: new Map<string, MemoryNode>(),
    byWu: new Map<string, MemoryNode[]>(),
  };
}

/**
 * Parses a single JSONL line and validates it
 */
function parseAndValidateLine(line: string, lineNumber: number): MemoryNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw createError(ErrorCodes.PARSE_ERROR, `Malformed JSON on line ${lineNumber}: ${errMsg}`, {
      cause: err,
    });
  }

  const validation = validateMemoryNode(parsed);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Validation error on line ${lineNumber}: ${issues}`,
    );
  }

  return validation.data;
}

/**
 * Adds a node to the WU index
 */
function indexNodeByWu(result: IndexedMemory, node: MemoryNode): void {
  if (!node.wu_id) return;

  if (!result.byWu.has(node.wu_id)) {
    result.byWu.set(node.wu_id, []);
  }
  const wuNodes = result.byWu.get(node.wu_id);
  if (wuNodes) {
    wuNodes.push(node);
  }
}

/**
 * Parses JSONL content and builds indexed memory.
 *
 * WU-1910: Two-phase approach for correct deduplication:
 * Phase 1: Parse ALL lines and build byId with last-write-wins (always set, never skip).
 *          This ensures archived entries overwrite their original non-archived versions.
 * Phase 2: Build nodes[] and byWu from deduplicated byId values, applying archive filter.
 */
function parseAndIndexMemory(content: string, includeArchived: boolean): IndexedMemory {
  const result = createEmptyIndexedMemory();
  const lines = content.split('\n');

  // Phase 1: Parse all lines and build byId with last-write-wins deduplication.
  // Order of insertion is preserved via a separate array to maintain file order
  // for the final nodes[] output.
  const allParsed: MemoryNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (!line) continue;

    const node = parseAndValidateLine(line, i + 1);
    allParsed.push(node);
    // Always overwrite: last-write-wins ensures archived entries suppress originals
    result.byId.set(node.id, node);
  }

  // Phase 2: Build nodes[] and byWu from deduplicated byId values.
  // Only include each node once (the latest version from byId), applying archive filter.
  const seen = new Set<string>();
  for (const node of allParsed) {
    // Skip if we already emitted this ID (only the last-write-wins version matters)
    if (seen.has(node.id)) continue;

    const latestVersion = result.byId.get(node.id);
    /* istanbul ignore next -- byId is always populated in Phase 1 */
    if (!latestVersion) continue;
    seen.add(node.id);

    // WU-1238: Filter archived nodes unless includeArchived is true
    if (!includeArchived && isNodeArchived(latestVersion)) {
      // Remove from byId so callers see a consistent view
      result.byId.delete(node.id);
      continue;
    }

    result.nodes.push(latestVersion);
    // Update byId to point at the version we actually emitted (should already match)
    result.byId.set(node.id, latestVersion);
    indexNodeByWu(result, latestVersion);
  }

  return result;
}

/**
 * Loads all memory including archived nodes.
 * Convenience function for operations that need to see all nodes.
 *
 * @param baseDir - Directory containing memory.jsonl
 * @returns Indexed memory nodes including archived
 */
export async function loadMemoryAll(baseDir: string): Promise<IndexedMemory> {
  return loadMemory(baseDir, { includeArchived: true });
}

/**
 * Appends a single node to the memory file.
 *
 * Uses append mode to avoid full file rewrite.
 * Creates file if it doesn't exist.
 * Validates node before appending.
 *
 * @param baseDir - Directory containing memory.jsonl
 * @param node - Node to append
 * @returns The appended node
 * @throws If node fails validation
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
export async function appendNode(baseDir: string, node: MemoryNode): Promise<MemoryNode> {
  // Validate node before appending
  const validation = validateMemoryNode(node);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Validation error: ${issues}`);
  }

  const filePath = path.join(baseDir, MEMORY_FILE_NAME);
  const line = JSON.stringify(node) + '\n';

  // Use append flag to avoid rewriting the file
  await fs.appendFile(filePath, line, { encoding: 'utf-8' as BufferEncoding });

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
 * @param baseDir - Directory containing memory.jsonl
 * @param wuId - WU ID to query (e.g., 'WU-1463')
 * @returns Deterministically ordered nodes for WU
 *
 * @example
 * const ready = await queryReady('/path/to/project', 'WU-1463');
 * // Process highest priority, oldest items first
 * for (const node of ready) {
 *   await processNode(node);
 * }
 *
 * @example
 * // WU-1238: Include archived nodes
 * const all = await queryReady('/path/to/project', 'WU-1463', { includeArchived: true });
 */
export async function queryReady(
  baseDir: string,
  wuId: string,
  options: MemoryQueryOptions = {},
): Promise<MemoryNode[]> {
  const { includeArchived = false } = options;
  const memory = await loadMemory(baseDir, { includeArchived });

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
 * @param baseDir - Directory containing memory.jsonl
 * @param wuId - WU ID to query (e.g., 'WU-1463')
 * @returns All nodes for WU in file order
 *
 * @example
 * const nodes = await queryByWu('/path/to/project', 'WU-1463');
 * console.log(`Found ${nodes.length} nodes for WU-1463`);
 *
 * @example
 * // WU-1238: Include archived nodes
 * const all = await queryByWu('/path/to/project', 'WU-1463', { includeArchived: true });
 */
export async function queryByWu(
  baseDir: string,
  wuId: string,
  options: MemoryQueryOptions = {},
): Promise<MemoryNode[]> {
  const { includeArchived = false } = options;
  const memory = await loadMemory(baseDir, { includeArchived });
  return memory.byWu.get(wuId) ?? [];
}
