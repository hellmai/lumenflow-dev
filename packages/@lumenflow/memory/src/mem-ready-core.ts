// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Ready Core (WU-1468)
 *
 * Deterministic ready-work query for "what next?" oracle.
 * Returns open nodes with no blockers, ordered by priority then createdAt.
 *
 * Ordering algorithm:
 * 1. Priority ASC (P0 first, then P1, P2, P3; nodes without priority last)
 * 2. CreatedAt ASC (oldest first for same priority)
 * 3. ID ASC (stable sort for identical priority and timestamp)
 *
 * A node is "ready" if:
 * - Linked to the specified WU
 * - Not blocked by another node (no `blocks` relationship pointing to it)
 * - No `metadata.blocked_by` array set
 * - Lifecycle is not `ephemeral`
 * - Status is not `closed` (metadata.status !== 'closed')
 *
 * @see {@link packages/@lumenflow/cli/src/mem-ready.ts} - CLI implementation
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-ready.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMemory } from './memory-store.js';
import { MEMORY_PATTERNS, type MemoryNode } from './memory-schema.js';
import type { NodeFsError } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Relationships file name
 */
const RELATIONSHIPS_FILE_NAME = 'relationships.jsonl';

/**
 * Priority level types
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

/**
 * Relationship between memory nodes
 */
interface ReadyRelationship {
  from_id: string;
  to_id: string;
  type: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

// WU-1548: NodeFsError imported from @lumenflow/core/wu-constants (consolidated)

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
 * Comparator for deterministic ordering: priority first, then createdAt, then ID.
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
 * Load relationships from relationships.jsonl
 *
 * @param memoryDir - Memory directory path
 * @returns Array of relationship objects
 */
async function loadRelationships(memoryDir: string): Promise<ReadyRelationship[]> {
  const filePath = path.join(memoryDir, RELATIONSHIPS_FILE_NAME);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known file path
    const content = await fs.readFile(filePath, { encoding: 'utf-8' as BufferEncoding });
    const lines = content.split('\n');
    const relationships: ReadyRelationship[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        relationships.push(JSON.parse(trimmed) as ReadyRelationship);
      } catch {
        // Skip malformed lines in relationships file
        continue;
      }
    }

    return relationships;
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      // File doesn't exist - no relationships
      return [];
    }
    throw error;
  }
}

/**
 * Build a set of node IDs that are blocked by relationships
 *
 * @param relationships - Relationship objects
 * @returns Set of blocked node IDs
 */
function buildBlockedSet(relationships: ReadyRelationship[]): Set<string> {
  const blocked = new Set<string>();

  for (const rel of relationships) {
    if (rel.type === 'blocks') {
      // The `to_id` is the blocked node
      blocked.add(rel.to_id);
    }
  }

  return blocked;
}

/**
 * Check if a node is blocked
 *
 * @param node - Memory node
 * @param blockedByRelationships - Set of IDs blocked by relationships
 * @returns True if node is blocked
 */
function isBlocked(node: MemoryNode, blockedByRelationships: Set<string>): boolean {
  // Check if blocked by relationship
  if (blockedByRelationships.has(node.id)) {
    return true;
  }

  // Check if blocked by metadata
  const blockedBy = node.metadata?.blocked_by;
  if (Array.isArray(blockedBy) && blockedBy.length > 0) {
    return true;
  }

  return false;
}

/**
 * Check if a node is closed (not open for processing)
 *
 * @param node - Memory node
 * @returns True if node is closed
 */
function isClosed(node: MemoryNode): boolean {
  // Ephemeral nodes are considered closed (discarded after use)
  if (node.lifecycle === 'ephemeral') {
    return true;
  }

  // Check explicit closed status in metadata
  if (node.metadata?.status === 'closed') {
    return true;
  }

  return false;
}

/**
 * Validate WU ID format
 *
 * @param wuId - WU ID to validate
 * @throws If WU ID format is invalid
 */
function validateWuId(wuId: string): void {
  if (!MEMORY_PATTERNS.WU_ID.test(wuId)) {
    throw createError(
      ErrorCodes.INVALID_WU_ID,
      `Invalid WU ID format: ${wuId}. Expected format: WU-XXX (e.g., WU-1234)`,
    );
  }
}

/**
 * Query options for ready nodes
 */
export interface QueryOptions {
  /** WU ID to query (required) */
  wuId: string;
  /** Filter by node type (optional) */
  type?: string;
}

/**
 * Query ready nodes for a WU.
 *
 * Returns unblocked, open nodes linked to the WU in deterministic order:
 * 1. Priority (P0 first, then P1, P2, P3; nodes without priority last)
 * 2. CreatedAt (oldest first for same priority)
 * 3. ID (alphabetical for stable sort)
 *
 * @param baseDir - Base directory containing .lumenflow/memory
 * @param options - Query options
 * @returns Deterministically ordered ready nodes
 * @throws If WU ID format is invalid or file contains malformed JSON
 *
 * @example
 * const ready = await queryReadyNodes('/path/to/project', { wuId: 'WU-1234' });
 * console.log(`${ready.length} nodes ready for processing`);
 *
 * @example
 * // Filter by type
 * const discoveries = await queryReadyNodes('/path/to/project', {
 *   wuId: 'WU-1234',
 *   type: 'discovery',
 * });
 */
export async function queryReadyNodes(
  baseDir: string,
  options: QueryOptions,
): Promise<MemoryNode[]> {
  const { wuId, type } = options;

  // Validate WU ID
  validateWuId(wuId);

  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Load memory and relationships
  const memory = await loadMemory(memoryDir);
  const relationships = await loadRelationships(memoryDir);

  // Build set of blocked node IDs from relationships
  const blockedByRelationships = buildBlockedSet(relationships);

  // Get nodes for this WU
  const wuNodes = memory.byWu.get(wuId) ?? [];

  // Filter to ready nodes only
  const readyNodes = wuNodes.filter((node) => {
    // Exclude blocked nodes
    if (isBlocked(node, blockedByRelationships)) {
      return false;
    }

    // Exclude closed nodes
    if (isClosed(node)) {
      return false;
    }

    // Apply type filter if specified
    if (type && node.type !== type) {
      return false;
    }

    return true;
  });

  // Sort deterministically
  return readyNodes.sort(compareNodes);
}
