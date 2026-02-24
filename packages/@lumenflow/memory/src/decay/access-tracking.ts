// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Access Tracking (WU-1238)
 *
 * Track access patterns for memory nodes to inform decay scoring.
 * Access is recorded when nodes are returned by mem:search or mem:context.
 *
 * Tracks:
 * - metadata.access.count: Number of times node was accessed
 * - metadata.access.last_accessed_at: ISO timestamp of last access
 * - metadata.decay.score: Computed decay score (updated on access)
 *
 * @see {@link packages/@lumenflow/memory/__tests__/access-tracking.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { loadMemory, MEMORY_FILE_NAME } from '../memory-store.js';
import type { MemoryNode } from '../memory-schema.js';
import { computeDecayScore, DEFAULT_HALF_LIFE_MS } from './scoring.js';

/**
 * Access statistics for a memory node
 */
export interface AccessStats {
  /** Number of times the node has been accessed */
  count: number;
  /** ISO timestamp of last access */
  last_accessed_at: string;
}

/**
 * Access metadata structure within a node
 */
interface AccessMetadata {
  count: number;
  last_accessed_at: string;
}

/**
 * Decay metadata structure within a node
 */
interface DecayMetadata {
  score: number;
  computed_at: string;
}

/**
 * Write nodes back to memory file.
 * Rewrites the entire file to update existing nodes.
 *
 * @param baseDir - Base directory containing memory.jsonl
 * @param nodes - All nodes to write
 */
async function writeMemoryFile(baseDir: string, nodes: MemoryNode[]): Promise<void> {
  const filePath = path.join(baseDir, MEMORY_FILE_NAME);
  const content = nodes.map((n) => JSON.stringify(n)).join('\n') + (nodes.length > 0 ? '\n' : '');
  await fs.writeFile(filePath, content, { encoding: 'utf-8' as BufferEncoding });
}

/**
 * Update a node's access metadata.
 *
 * @param node - Node to update
 * @param now - Current timestamp
 * @param halfLifeMs - Half-life for decay scoring
 * @returns Updated node with new access metadata
 */
function updateNodeAccess(
  node: MemoryNode,
  now: number = Date.now(),
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): MemoryNode {
  const timestamp = new Date(now).toISOString();

  // Get existing access metadata
  const existingAccess = node.metadata?.access as AccessMetadata | undefined;
  const currentCount = existingAccess?.count ?? 0;

  // Create updated access metadata
  const newAccess: AccessMetadata = {
    count: currentCount + 1,
    last_accessed_at: timestamp,
  };

  // Compute decay score
  const updatedNodeForScoring: MemoryNode = {
    ...node,
    metadata: {
      ...node.metadata,
      access: newAccess,
    },
  };

  const decayScore = computeDecayScore(updatedNodeForScoring, { now, halfLifeMs });

  const newDecay: DecayMetadata = {
    score: decayScore,
    computed_at: timestamp,
  };

  // Return updated node
  return {
    ...node,
    metadata: {
      ...node.metadata,
      access: newAccess,
      decay: newDecay,
    },
  };
}

/**
 * Record access for a single memory node.
 *
 * Increments access count and updates last_accessed_at timestamp.
 * Also recomputes the decay score.
 *
 * @param baseDir - Base directory containing memory.jsonl
 * @param nodeId - ID of the node to record access for
 * @param options - Optional configuration
 * @returns Updated node with new access metadata
 * @throws If node is not found
 *
 * @example
 * const updatedNode = await recordAccess(baseDir, 'mem-abc1');
 * console.log(updatedNode.metadata.access.count); // Incremented
 */
export async function recordAccess(
  baseDir: string,
  nodeId: string,
  options: { now?: number; halfLifeMs?: number } = {},
): Promise<MemoryNode> {
  const { now = Date.now(), halfLifeMs = DEFAULT_HALF_LIFE_MS } = options;

  // Load all nodes
  const memory = await loadMemory(baseDir);

  // Find the target node
  const targetNode = memory.byId.get(nodeId);
  if (!targetNode) {
    throw createError(ErrorCodes.NODE_NOT_FOUND, `Node not found: ${nodeId}`);
  }

  // Update the node
  const updatedNode = updateNodeAccess(targetNode, now, halfLifeMs);

  // Replace the node in the nodes array
  const updatedNodes = memory.nodes.map((n) => (n.id === nodeId ? updatedNode : n));

  // Write back to file
  await writeMemoryFile(baseDir, updatedNodes);

  return updatedNode;
}

/**
 * Record access for multiple memory nodes in a batch.
 *
 * More efficient than calling recordAccess individually because
 * it only reads and writes the file once.
 *
 * @param baseDir - Base directory containing memory.jsonl
 * @param nodeIds - IDs of nodes to record access for
 * @param options - Optional configuration
 * @returns Array of updated nodes (skips non-existent nodes)
 *
 * @example
 * const updated = await recordAccessBatch(baseDir, ['mem-abc1', 'mem-def2']);
 * console.log(`Updated ${updated.length} nodes`);
 */
export async function recordAccessBatch(
  baseDir: string,
  nodeIds: string[],
  options: { now?: number; halfLifeMs?: number } = {},
): Promise<MemoryNode[]> {
  const { now = Date.now(), halfLifeMs = DEFAULT_HALF_LIFE_MS } = options;

  // Load all nodes
  const memory = await loadMemory(baseDir);

  // Track which nodes were updated
  const updatedNodes: MemoryNode[] = [];
  const nodeIdSet = new Set(nodeIds);

  // Update matching nodes
  const allNodes = memory.nodes.map((node) => {
    if (nodeIdSet.has(node.id)) {
      const updated = updateNodeAccess(node, now, halfLifeMs);
      updatedNodes.push(updated);
      return updated;
    }
    return node;
  });

  // Write back to file if any nodes were updated
  if (updatedNodes.length > 0) {
    await writeMemoryFile(baseDir, allNodes);
  }

  return updatedNodes;
}

/**
 * Get access statistics for a memory node.
 *
 * @param baseDir - Base directory containing memory.jsonl
 * @param nodeId - ID of the node to get stats for
 * @returns Access stats or null if node has no access data or doesn't exist
 *
 * @example
 * const stats = await getAccessStats(baseDir, 'mem-abc1');
 * if (stats) {
 *   console.log(`Accessed ${stats.count} times`);
 * }
 */
export async function getAccessStats(baseDir: string, nodeId: string): Promise<AccessStats | null> {
  // Load all nodes
  const memory = await loadMemory(baseDir);

  // Find the target node
  const node = memory.byId.get(nodeId);
  if (!node) {
    return null;
  }

  // Get access metadata
  const access = node.metadata?.access as AccessMetadata | undefined;
  if (!access || typeof access.count !== 'number') {
    return null;
  }

  return {
    count: access.count,
    last_accessed_at: access.last_accessed_at,
  };
}
