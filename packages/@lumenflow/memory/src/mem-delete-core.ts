// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Delete Core (WU-1284)
 *
 * Soft delete memory nodes via metadata.status=deleted.
 * Respects append-only pattern by updating nodes in-place rather than removing.
 *
 * Features:
 * - Delete by node ID(s)
 * - Bulk delete via tag filter
 * - Bulk delete via older-than filter
 * - Dry-run preview mode
 * - Preserves all original node data
 *
 * @see {@link packages/@lumenflow/memory/__tests__/mem-delete.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { MS_PER_HOUR, MS_PER_DAY } from '@lumenflow/core/constants/duration-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import type { MemoryNode } from './memory-schema.js';
import { loadMemory, MEMORY_FILE_NAME } from './memory-store.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Duration multipliers in milliseconds
 */
const DURATION_MULTIPLIERS: Record<string, number> = {
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
  w: 7 * MS_PER_DAY,
};

/**
 * Options for deleteMemoryNodes operation
 */
export interface DeleteOptions {
  /** Specific node IDs to delete */
  nodeIds?: string[];

  /** Delete all nodes matching this tag */
  tag?: string;

  /** Delete nodes older than this duration (e.g., '7d', '24h', '2w') */
  olderThan?: string;

  /** Reference date for olderThan calculation (defaults to now) */
  referenceDate?: Date;

  /** Preview mode - don't actually modify file */
  dryRun?: boolean;
}

/**
 * Result from deleteMemoryNodes operation
 */
export interface DeleteResult {
  /** Whether operation completed successfully */
  success: boolean;

  /** Number of nodes marked as deleted */
  deletedCount: number;

  /** IDs of deleted nodes */
  deletedIds: string[];

  /** IDs of nodes that were skipped (e.g., already deleted) */
  skippedIds: string[];

  /** Whether this was a dry-run */
  dryRun: boolean;

  /** Any errors encountered */
  errors: string[];
}

/**
 * Parse a duration string (e.g., '7d', '24h', '2w') to milliseconds
 *
 * @param duration - Duration string
 * @returns Duration in milliseconds
 * @throws If duration format is invalid
 */
function parseDuration(duration: string): number {
  const durationRegex = /^(\d+)([hdw])$/;
  const match = durationRegex.exec(duration);
  if (!match || match.length < 3) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      `Invalid duration format: ${duration}. Use format like '7d', '24h', '2w'`,
    );
  }

  const valueStr = match[1];
  const unit = match[2];
  if (!valueStr || !unit) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      `Invalid duration format: ${duration}. Use format like '7d', '24h', '2w'`,
    );
  }

  const value = parseInt(valueStr, 10);
  const multiplier = DURATION_MULTIPLIERS[unit];

  if (!multiplier) {
    throw createError(ErrorCodes.INVALID_DURATION, `Unknown duration unit: ${unit}`);
  }

  return value * multiplier;
}

/**
 * Check if a node matches the tag filter
 */
function matchesTag(node: MemoryNode, tag: string): boolean {
  return Array.isArray(node.tags) && node.tags.includes(tag);
}

/**
 * Check if a node is older than the specified duration
 */
function isOlderThan(node: MemoryNode, durationMs: number, referenceDate: Date): boolean {
  const nodeDate = new Date(node.created_at);
  const cutoffDate = new Date(referenceDate.getTime() - durationMs);
  return nodeDate < cutoffDate;
}

/**
 * Check if a node is already marked as deleted
 */
function isAlreadyDeleted(node: MemoryNode): boolean {
  return node.metadata?.status === 'deleted';
}

/**
 * Mark a node as deleted by updating its metadata
 */
function markAsDeleted(node: MemoryNode): MemoryNode {
  return {
    ...node,
    metadata: {
      ...node.metadata,
      status: 'deleted',
      deleted_at: new Date().toISOString(),
    },
  };
}

/**
 * Process nodeIds filter and add matches to delete set
 */
function processNodeIdsFilter(
  nodeIds: string[],
  nodeMap: Map<string, MemoryNode>,
  toDeleteSet: Set<string>,
  errors: string[],
): void {
  for (const nodeId of nodeIds) {
    const node = nodeMap.get(nodeId);
    if (node) {
      toDeleteSet.add(nodeId);
    } else {
      errors.push(`Node not found: ${nodeId}`);
    }
  }
}

/**
 * Process tag filter and add matches to delete set
 */
function processTagFilter(nodes: MemoryNode[], tag: string, toDeleteSet: Set<string>): void {
  for (const node of nodes) {
    if (matchesTag(node, tag)) {
      toDeleteSet.add(node.id);
    }
  }
}

/**
 * Process olderThan filter, optionally intersected with tag filter
 */
function processOlderThanFilter(
  nodes: MemoryNode[],
  olderThan: string,
  referenceDate: Date,
  tag: string | undefined,
  hasNodeIds: boolean,
  toDeleteSet: Set<string>,
): void {
  const durationMs = parseDuration(olderThan);

  for (const node of nodes) {
    const nodeIsOld = isOlderThan(node, durationMs, referenceDate);

    if (tag) {
      // Intersection: node must match BOTH tag and age filters
      const shouldInclude = nodeIsOld && matchesTag(node, tag);
      if (shouldInclude) {
        toDeleteSet.add(node.id);
      } else {
        // Remove if previously added by tag filter but not matching age
        toDeleteSet.delete(node.id);
      }
    } else if (!hasNodeIds && nodeIsOld) {
      // No tag filter, no nodeIds: add all old nodes
      toDeleteSet.add(node.id);
    }
  }
}

/**
 * Find nodes to delete based on filters
 */
function findNodesToDelete(
  nodes: MemoryNode[],
  options: DeleteOptions,
): { toDelete: MemoryNode[]; errors: string[] } {
  const { nodeIds, tag, olderThan, referenceDate = new Date() } = options;
  const errors: string[] = [];
  const toDeleteSet = new Set<string>();

  // Build a map for quick lookups
  const nodeMap = new Map<string, MemoryNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Process nodeIds filter
  if (nodeIds && nodeIds.length > 0) {
    processNodeIdsFilter(nodeIds, nodeMap, toDeleteSet, errors);
  }

  // Process tag filter (before olderThan to allow intersection)
  if (tag) {
    processTagFilter(nodes, tag, toDeleteSet);
  }

  // Process olderThan filter (may intersect with tag filter)
  if (olderThan) {
    const hasNodeIds = Boolean(nodeIds && nodeIds.length > 0);
    processOlderThanFilter(nodes, olderThan, referenceDate, tag, hasNodeIds, toDeleteSet);
  }

  // Get the actual nodes to delete
  const toDelete: MemoryNode[] = [];
  for (const nodeId of toDeleteSet) {
    const node = nodeMap.get(nodeId);
    if (node) {
      toDelete.push(node);
    }
  }

  return { toDelete, errors };
}

/**
 * Write updated nodes back to the JSONL file
 * Rewrites the file to update nodes in-place (soft delete pattern)
 */
async function writeUpdatedNodes(baseDir: string, nodes: MemoryNode[]): Promise<void> {
  const filePath = path.join(baseDir, MEMORY_FILE_NAME);
  const content = nodes.map((node) => JSON.stringify(node)).join('\n') + '\n';
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path computed from known base and constant
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Delete memory nodes using soft-delete pattern (metadata.status=deleted)
 *
 * Respects the append-only pattern by updating nodes in-place rather than
 * physically removing them from the file.
 *
 * @param baseDir - Project root directory containing .lumenflow/memory/
 * @param options - Delete options (filters and dry-run)
 * @returns Result with deleted IDs and any errors
 *
 * @example
 * // Delete by ID
 * await deleteMemoryNodes('/path', { nodeIds: ['mem-abc1'] });
 *
 * @example
 * // Delete by tag (dry-run)
 * await deleteMemoryNodes('/path', { tag: 'obsolete', dryRun: true });
 *
 * @example
 * // Delete old nodes
 * await deleteMemoryNodes('/path', { olderThan: '30d' });
 */
export async function deleteMemoryNodes(
  baseDir: string,
  options: DeleteOptions,
): Promise<DeleteResult> {
  const { nodeIds, tag, olderThan, dryRun = false } = options;

  // Validate: at least one filter must be provided
  if ((!nodeIds || nodeIds.length === 0) && !tag && !olderThan) {
    return {
      success: false,
      deletedCount: 0,
      deletedIds: [],
      skippedIds: [],
      dryRun,
      errors: ['At least one filter (nodeIds, tag, or olderThan) is required'],
    };
  }

  // WU-1285: Compute the memory directory path from baseDir
  // The memory file lives at .lumenflow/memory/memory.jsonl
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Load all memory including archived/deleted nodes
  let memory;
  try {
    memory = await loadMemory(memoryDir, { includeArchived: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      deletedCount: 0,
      deletedIds: [],
      skippedIds: [],
      dryRun,
      errors: [`Failed to load memory: ${errMsg}`],
    };
  }

  // Find nodes to delete
  const { toDelete, errors } = findNodesToDelete(memory.nodes, options);

  // Separate already-deleted nodes
  const deletedIds: string[] = [];
  const skippedIds: string[] = [];
  const nodesToUpdate: MemoryNode[] = [];

  for (const node of toDelete) {
    if (isAlreadyDeleted(node)) {
      skippedIds.push(node.id);
      errors.push(`Node already deleted: ${node.id}`);
    } else {
      deletedIds.push(node.id);
      nodesToUpdate.push(node);
    }
  }

  // Apply deletion if not dry-run
  if (!dryRun && nodesToUpdate.length > 0) {
    // Build updated node list
    const deletedIdSet = new Set(deletedIds);
    const updatedNodes: MemoryNode[] = memory.nodes.map((node) => {
      if (deletedIdSet.has(node.id)) {
        return markAsDeleted(node);
      }
      return node;
    });

    // Write back to file (using memoryDir, not baseDir)
    await writeUpdatedNodes(memoryDir, updatedNodes);
  }

  // Determine success:
  // - True if any nodes were deleted
  // - True if all requested nodes were already deleted (skipped but valid)
  // - False only if requested nodes don't exist (not found errors)
  const hasNotFoundErrors = errors.some((e) => e.startsWith('Node not found:'));
  const allNodesHandled = deletedIds.length > 0 || skippedIds.length > 0;
  const success = !hasNotFoundErrors || allNodesHandled;

  return {
    success,
    deletedCount: deletedIds.length,
    deletedIds,
    skippedIds,
    dryRun,
    errors,
  };
}
