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
 * @see {@link tools/mem-summarize.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-summarize.test.mjs} - Tests
 */

import { loadMemory, appendNode } from './memory-store.js';
import { generateMemId } from './mem-id.js';
import { validateMemoryNode } from './memory-schema.js';
import path from 'node:path';

/**
 * Memory directory path relative to base directory
 */
const MEMORY_DIR = '.beacon/memory';

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
 * @typedef {import('./memory-schema.mjs').MemoryNode} MemoryNode
 */

/**
 * @typedef {object} SummarizeOptions
 * @property {string} wuId - WU ID to summarize (e.g., 'WU-1234')
 * @property {boolean} [dryRun=false] - If true, preview without modifications
 */

/**
 * @typedef {object} SummarizeResult
 * @property {boolean} success - Whether summarization succeeded
 * @property {MemoryNode} summary - Created summary node
 * @property {string[]} markedForCleanup - Node IDs marked for cleanup
 * @property {boolean} [dryRun] - True if in dry-run mode
 * @property {number} compactionRatio - Ratio of source nodes to summary
 */

/**
 * Filter nodes that can be summarized for a given WU.
 *
 * Excludes:
 * - Nodes from different WUs
 * - Ephemeral lifecycle nodes (already transient)
 * - Already-summarized nodes (have summarized_into metadata)
 * - Summary nodes themselves
 *
 * @param {MemoryNode[]} nodes - All memory nodes
 * @param {string} wuId - WU ID to filter by
 * @returns {MemoryNode[]} Summarizable nodes
 */
export function filterSummarizableNodes(nodes, wuId) {
  return nodes.filter((node) => {
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
 * @param {number} sourceCount - Number of source nodes
 * @param {number} summaryCount - Number of summary nodes created
 * @returns {number} Compaction ratio (0 if invalid input)
 */
export function getCompactionRatio(sourceCount, summaryCount) {
  if (sourceCount === 0 || summaryCount === 0) {
    return 0;
  }
  return sourceCount / summaryCount;
}

/**
 * Group nodes by type for organized summary content.
 *
 * @param {MemoryNode[]} nodes - Nodes to group
 * @returns {Map<string, MemoryNode[]>} Nodes grouped by type
 */
function groupNodesByType(nodes) {
  const groups = new Map();

  for (const node of nodes) {
    if (!groups.has(node.type)) {
      groups.set(node.type, []);
    }
    groups.get(node.type).push(node);
  }

  return groups;
}

/**
 * Generate aggregated summary content from source nodes.
 *
 * Organizes content by node type with clear sections.
 *
 * @param {MemoryNode[]} nodes - Source nodes to aggregate
 * @param {string} wuId - WU ID for the summary
 * @returns {string} Aggregated content
 */
function generateSummaryContent(nodes, wuId) {
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
 * @param {MemoryNode[]} nodes - Source nodes
 * @returns {MemoryNode[]} Nodes to mark for cleanup
 */
function filterNodesForCleanup(nodes) {
  return nodes.filter((node) => !PROTECTED_LIFECYCLES.includes(node.lifecycle));
}

/**
 * Create a summary node from source nodes.
 *
 * @param {MemoryNode[]} sourceNodes - Source nodes to summarize
 * @param {string} wuId - WU ID for the summary
 * @returns {MemoryNode} Summary node (not yet persisted)
 */
function createSummaryNode(sourceNodes, wuId) {
  const timestamp = new Date().toISOString();
  const content = generateSummaryContent(sourceNodes, wuId);
  const id = generateMemId(`summary-${wuId}-${timestamp}`);

  const summary = {
    id,
    type: 'summary',
    lifecycle: 'project', // Summaries persist across WUs
    content,
    created_at: timestamp,
    wu_id: wuId,
    metadata: {
      source_nodes: sourceNodes.map((n) => n.id),
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
    throw new Error(`Summary node validation failed: ${issues}`);
  }

  return summary;
}

/**
 * Create cleanup marker nodes for original nodes.
 *
 * Adds summarized_into metadata to mark nodes as incorporated
 * into a summary, making them eligible for cleanup.
 *
 * @param {MemoryNode[]} nodes - Nodes to mark
 * @param {string} summaryId - ID of the summary node
 * @returns {MemoryNode[]} Updated nodes with cleanup markers
 */
function createCleanupMarkers(nodes, summaryId) {
  const timestamp = new Date().toISOString();

  return nodes.map((node) => ({
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
 * @param {string} baseDir - Base directory containing .beacon/memory/
 * @param {SummarizeOptions} options - Summarization options
 * @returns {Promise<SummarizeResult>} Result with summary and cleanup info
 * @throws {Error} If no summarizable nodes found for WU
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
export async function summarizeWu(baseDir, options) {
  const { wuId, dryRun = false } = options;
  const memoryDir = path.join(baseDir, MEMORY_DIR);

  // Load existing memory
  const memory = await loadMemory(memoryDir);

  // Filter summarizable nodes
  const summarizable = filterSummarizableNodes(memory.nodes, wuId);

  if (summarizable.length === 0) {
    throw new Error(`No summarizable nodes found for ${wuId}`);
  }

  // Create summary node
  const summary = createSummaryNode(summarizable, wuId);

  // Determine which nodes to mark for cleanup
  const cleanupNodes = filterNodesForCleanup(summarizable);
  const markedForCleanup = cleanupNodes.map((n) => n.id);

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

  // Persist summary node
  await appendNode(memoryDir, summary);

  // Mark original nodes for cleanup
  const cleanupMarkers = createCleanupMarkers(cleanupNodes, summary.id);
  for (const marker of cleanupMarkers) {
    await appendNode(memoryDir, marker);
  }

  return {
    success: true,
    summary,
    markedForCleanup,
    compactionRatio,
  };
}
