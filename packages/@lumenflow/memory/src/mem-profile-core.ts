/**
 * Memory Profile Core (WU-1237)
 *
 * Generates project knowledge profiles for agent context injection.
 *
 * Features:
 * - Filters to lifecycle=project nodes only
 * - Configurable limit (default N=20)
 * - Tag-based filtering
 * - Output format compatible with mem:context
 * - Deterministic ordering by recency
 *
 * @see {@link packages/@lumenflow/cli/src/mem-profile.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-profile-core.test.ts} - Tests
 */

import path from 'node:path';
import { loadMemory } from './memory-store.js';
import type { MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Default maximum number of nodes to include in profile
 */
export const DEFAULT_PROFILE_LIMIT = 20;

/**
 * Section header for profile output
 */
const PROFILE_SECTION_HEADER = '## Project Profile';

/**
 * Options for generating a profile
 */
export interface GenerateProfileOptions {
  /** Maximum number of nodes to include (default: 20) */
  limit?: number;
  /** Filter by specific tag */
  tag?: string;
}

/**
 * Statistics about the generated profile
 */
export interface ProfileStats {
  /** Total number of project-level nodes in memory */
  totalProjectNodes: number;
  /** Number of nodes included in the profile */
  includedNodes: number;
  /** Count by tag */
  byTag: Record<string, number>;
}

/**
 * Result of generating a profile
 */
export interface GenerateProfileResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Nodes included in the profile */
  nodes: MemoryNode[];
  /** Formatted profile block for context injection */
  profileBlock: string;
  /** Statistics about the profile */
  stats: ProfileStats;
}

/**
 * Comparator for sorting nodes by recency (most recent first).
 * Uses created_at as primary sort, id as secondary for stability.
 *
 * @param a - First node
 * @param b - Second node
 * @returns Comparison result
 */
function compareByRecency(a: MemoryNode, b: MemoryNode): number {
  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();

  // Most recent first
  if (aTime !== bTime) {
    return bTime - aTime;
  }

  // Stable sort by ID for identical timestamps
  return a.id.localeCompare(b.id);
}

/**
 * Filters nodes by lifecycle=project
 *
 * @param nodes - All nodes
 * @returns Only project-level nodes
 */
function filterProjectNodes(nodes: MemoryNode[]): MemoryNode[] {
  return nodes.filter((node) => node.lifecycle === 'project');
}

/**
 * Filters nodes by tag
 *
 * @param nodes - Nodes to filter
 * @param tag - Tag to filter by
 * @returns Nodes with the specified tag
 */
function filterByTag(nodes: MemoryNode[], tag: string): MemoryNode[] {
  return nodes.filter((node) => node.tags?.includes(tag));
}

/**
 * Formats a single node for profile output
 *
 * @param node - Node to format
 * @returns Formatted line
 */
function formatNode(node: MemoryNode): string {
  const timestamp = new Date(node.created_at).toISOString().split('T')[0];
  return `- [${node.id}] (${timestamp}): ${node.content}`;
}

/**
 * Formats all nodes into a profile block
 *
 * @param nodes - Nodes to format
 * @returns Formatted profile block
 */
function formatProfileBlock(nodes: MemoryNode[]): string {
  if (nodes.length === 0) {
    return '';
  }

  const lines = [PROFILE_SECTION_HEADER, ''];
  for (const node of nodes) {
    lines.push(formatNode(node));
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Calculates tag statistics for nodes
 *
 * @param nodes - Nodes to analyze
 * @returns Tag counts
 */
function calculateTagStats(nodes: MemoryNode[]): Record<string, number> {
  const tagCounts: Record<string, number> = {};

  for (const node of nodes) {
    if (node.tags) {
      for (const tag of node.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  return tagCounts;
}

/**
 * Generates a project knowledge profile for context injection.
 *
 * Filters to project-level nodes, applies tag filter if specified,
 * sorts by recency, and limits to the configured maximum.
 *
 * Output is formatted for integration with mem:context.
 *
 * @param baseDir - Base directory containing .lumenflow/memory
 * @param options - Profile generation options
 * @returns Result with nodes and formatted profile block
 *
 * @example
 * // Get top 20 project memories
 * const result = await generateProfile('/path/to/project');
 * console.log(result.profileBlock);
 *
 * @example
 * // Get top 10 decisions
 * const result = await generateProfile('/path/to/project', {
 *   limit: 10,
 *   tag: 'decision',
 * });
 */
export async function generateProfile(
  baseDir: string,
  options: GenerateProfileOptions = {},
): Promise<GenerateProfileResult> {
  const { limit = DEFAULT_PROFILE_LIMIT, tag } = options;

  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Load all memory nodes
  let allNodes: MemoryNode[] = [];
  try {
    const memory = await loadMemory(memoryDir);
    allNodes = memory.nodes;
  } catch (error) {
    // If memory directory doesn't exist or is empty, return empty result
    const err = error as { code?: string };
    if (err.code === 'ENOENT') {
      return {
        success: true,
        nodes: [],
        profileBlock: '',
        stats: {
          totalProjectNodes: 0,
          includedNodes: 0,
          byTag: {},
        },
      };
    }
    throw error;
  }

  // Filter to project lifecycle only
  let projectNodes = filterProjectNodes(allNodes);

  // Store total before any additional filtering
  const totalProjectNodes = projectNodes.length;

  // Apply tag filter if specified
  if (tag) {
    projectNodes = filterByTag(projectNodes, tag);
  }

  // Sort by recency (most recent first)
  const sortedNodes = [...projectNodes].sort(compareByRecency);

  // Apply limit
  const limitedNodes = sortedNodes.slice(0, limit);

  // Calculate statistics
  const stats: ProfileStats = {
    totalProjectNodes,
    includedNodes: limitedNodes.length,
    byTag: calculateTagStats(limitedNodes),
  };

  // Format the profile block
  const profileBlock = formatProfileBlock(limitedNodes);

  return {
    success: true,
    nodes: limitedNodes,
    profileBlock,
    stats,
  };
}
