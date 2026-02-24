// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Summarize Core (WU-1471)
 *
 * Rollup older memory nodes into summary nodes for compaction.
 * Implements forgetting as first-class feature.
 *
 * Features:
 * - Aggregate checkpoint/note/discovery nodes into summaries
 * - Mark originals for cleanup after summary creation
 * - Respect lifecycle TTL (ephemeral, session, wu, project)
 * - Support dry-run mode for preview
 *
 * @see {@link packages/@lumenflow/cli/src/mem-summarize.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-summarize.test.ts} - Tests
 */

import { loadMemory, appendNode } from './memory-store.js';
import { generateMemId } from './mem-id.js';
import { validateMemoryNode, type MemoryNode } from './memory-schema.js';
import path from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Node types that can be summarized
 */
const SUMMARIZABLE_TYPES = ['discovery', 'checkpoint', 'note', 'session'];

/**
 * Lifecycles that should NOT be marked for cleanup after summarization
 * Project-level nodes persist across WUs (architectural knowledge)
 */
const PROTECTED_LIFECYCLES = ['project'];

/**
 * Summarize options
 */
export interface SummarizeOptions {
  /** WU ID to summarize (e.g., 'WU-1234') */
  wuId: string;
  /** If true, preview without modifications */
  dryRun?: boolean;
}

/**
 * Summary node structure
 */
interface SummaryNode {
  id: string;
  type: 'summary';
  lifecycle: 'project';
  content: string;
  created_at: string;
  wu_id: string;
  metadata: {
    source_nodes: string[];
    source_count: number;
    summarized_at: string;
  };
}

/**
 * Summarize result
 */
export interface SummarizeResult {
  /** Whether summarization succeeded */
  success: boolean;
  /** Created summary node */
  summary: SummaryNode;
  /** Node IDs marked for cleanup */
  markedForCleanup: string[];
  /** True if in dry-run mode */
  dryRun?: boolean;
  /** Ratio of source nodes to summary */
  compactionRatio: number;
}

/**
 * Filter nodes that can be summarized for a given WU.
 *
 * Excludes:
 * - Nodes from different WUs
 * - Ephemeral lifecycle nodes (already transient)
 * - Already-summarized nodes (have summarized_into metadata)
 * - Summary nodes themselves
 *
 * @param nodes - All memory nodes
 * @param wuId - WU ID to filter by
 * @returns Summarizable nodes
 */
export function filterSummarizableNodes(nodes: MemoryNode[], wuId: string): MemoryNode[] {
  return nodes.filter((node: MemoryNode) => {
    // Must belong to the specified WU
    if (node.wu_id !== wuId) {
      return false;
    }

    // Exclude ephemeral lifecycle (already transient)
    if (node.lifecycle === 'ephemeral') {
      return false;
    }

    // Exclude already-summarized nodes
    if (node.metadata?.summarized_into) {
      return false;
    }

    // Exclude summary nodes themselves
    if (node.type === 'summary') {
      return false;
    }

    // Include all summarizable types
    return SUMMARIZABLE_TYPES.includes(node.type);
  });
}

/**
 * Calculate compaction ratio (source nodes / summary nodes).
 *
 * @param sourceCount - Number of source nodes
 * @param summaryCount - Number of summary nodes created
 * @returns Compaction ratio (0 if invalid input)
 */
export function getCompactionRatio(sourceCount: number, summaryCount: number): number {
  if (sourceCount === 0 || summaryCount === 0) {
    return 0;
  }
  return sourceCount / summaryCount;
}

/**
 * Group nodes by type for organized summary content.
 *
 * @param nodes - Nodes to group
 * @returns Nodes grouped by type
 */
function groupNodesByType(nodes: MemoryNode[]): Map<string, MemoryNode[]> {
  const groups = new Map<string, MemoryNode[]>();

  for (const node of nodes) {
    if (!groups.has(node.type)) {
      groups.set(node.type, []);
    }
    const typeGroup = groups.get(node.type);
    if (typeGroup) {
      typeGroup.push(node);
    }
  }

  return groups;
}

/**
 * Generate aggregated summary content from source nodes.
 *
 * Organizes content by node type with clear sections.
 *
 * @param nodes - Source nodes to aggregate
 * @param wuId - WU ID for the summary
 * @returns Aggregated content
 */
function generateSummaryContent(nodes: MemoryNode[], wuId: string): string {
  const groups = groupNodesByType(nodes);
  const sections = [];

  sections.push(`# Summary for ${wuId}`);
  sections.push(`Aggregated from ${nodes.length} node(s)`);

  // Process each type in order
  const typeOrder = ['discovery', 'checkpoint', 'note', 'session'];

  for (const type of typeOrder) {
    const typeNodes = groups.get(type);
    if (!typeNodes || typeNodes.length === 0) {
      continue;
    }

    sections.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}(s)`);

    for (const node of typeNodes) {
      // Bullet point with content, truncated if very long
      const content = node.content.length > 200 ? `${node.content.slice(0, 197)}...` : node.content;
      sections.push(`- ${content}`);
    }
  }

  return sections.join('\n');
}

/**
 * Filter nodes that should be marked for cleanup.
 *
 * Project-lifecycle nodes are protected from cleanup as they
 * contain architectural knowledge that should persist.
 *
 * @param nodes - Source nodes
 * @returns Nodes to mark for cleanup
 */
function filterNodesForCleanup(nodes: MemoryNode[]): MemoryNode[] {
  return nodes.filter((node: MemoryNode) => !PROTECTED_LIFECYCLES.includes(node.lifecycle));
}

/**
 * Create a summary node from source nodes.
 *
 * @param sourceNodes - Source nodes to summarize
 * @param wuId - WU ID for the summary
 * @returns Summary node (not yet persisted)
 */
function createSummaryNode(sourceNodes: MemoryNode[], wuId: string): SummaryNode {
  const timestamp = new Date().toISOString();
  const content = generateSummaryContent(sourceNodes, wuId);
  const id = generateMemId(`summary-${wuId}-${timestamp}`);

  const summary: SummaryNode = {
    id,
    type: 'summary',
    lifecycle: 'project', // Summaries persist across WUs
    content,
    created_at: timestamp,
    wu_id: wuId,
    metadata: {
      source_nodes: sourceNodes.map((n: MemoryNode) => n.id),
      source_count: sourceNodes.length,
      summarized_at: timestamp,
    },
  };

  // Validate the summary node
  const validation = validateMemoryNode(summary);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Summary node validation failed: ${issues}`);
  }

  return summary;
}

/**
 * Create cleanup marker nodes for original nodes.
 *
 * Adds summarized_into metadata to mark nodes as incorporated
 * into a summary, making them eligible for cleanup.
 *
 * @param nodes - Nodes to mark
 * @param summaryId - ID of the summary node
 * @returns Updated nodes with cleanup markers
 */
function createCleanupMarkers(nodes: MemoryNode[], summaryId: string): MemoryNode[] {
  const timestamp = new Date().toISOString();

  return nodes.map((node: MemoryNode) => ({
    ...node,
    updated_at: timestamp,
    metadata: {
      ...node.metadata,
      summarized_into: summaryId,
      summarized_at: timestamp,
    },
  }));
}

/**
 * Summarize memory nodes for a closed WU.
 *
 * Aggregates checkpoint, note, and discovery nodes into a single
 * summary node. Original nodes are marked for cleanup (unless
 * they have project lifecycle).
 *
 * @param baseDir - Base directory containing .lumenflow/memory/
 * @param options - Summarization options
 * @returns Result with summary and cleanup info
 * @throws If no summarizable nodes found for WU
 *
 * @example
 * // Summarize nodes for a completed WU
 * const result = await summarizeWu(baseDir, { wuId: 'WU-1234' });
 * console.log(`Created summary ${result.summary.id}`);
 * console.log(`Compaction ratio: ${result.compactionRatio}:1`);
 *
 * @example
 * // Preview without modifications
 * const preview = await summarizeWu(baseDir, {
 *   wuId: 'WU-1234',
 *   dryRun: true,
 * });
 */
export async function summarizeWu(
  baseDir: string,
  options: SummarizeOptions,
): Promise<SummarizeResult> {
  const { wuId, dryRun = false } = options;
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Load existing memory
  const memory = await loadMemory(memoryDir);

  // Filter summarizable nodes
  const summarizable = filterSummarizableNodes(memory.nodes, wuId);

  if (summarizable.length === 0) {
    throw createError(ErrorCodes.NODE_NOT_FOUND, `No summarizable nodes found for ${wuId}`);
  }

  // Create summary node
  const summary = createSummaryNode(summarizable, wuId);

  // Determine which nodes to mark for cleanup
  const cleanupNodes = filterNodesForCleanup(summarizable);
  const markedForCleanup = cleanupNodes.map((n: MemoryNode) => n.id);

  // Calculate compaction ratio
  const compactionRatio = getCompactionRatio(summarizable.length, 1);

  // If dry-run, return preview without modifications
  if (dryRun) {
    return {
      success: true,
      summary,
      markedForCleanup,
      dryRun: true,
      compactionRatio,
    };
  }

  // Persist summary node - cast is safe as summary conforms to MemoryNode schema
  await appendNode(memoryDir, summary as unknown as MemoryNode);

  // Mark original nodes for cleanup
  const cleanupMarkers = createCleanupMarkers(cleanupNodes, summary.id);
  for (const marker of cleanupMarkers) {
    await appendNode(memoryDir, marker as unknown as MemoryNode);
  }

  return {
    success: true,
    summary,
    markedForCleanup,
    compactionRatio,
  };
}
