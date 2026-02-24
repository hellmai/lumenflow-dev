// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Context Core (WU-1234, WU-1238, WU-1281)
 *
 * Core logic for generating deterministic, formatted context injection blocks
 * for wu:spawn prompts. Produces structured markdown suitable for embedding
 * into agent spawn prompts.
 *
 * Features:
 * - Deterministic selection: filter by lifecycle, wu_id, recency
 * - Structured output with clear sections (Project Profile, Summaries, WU Context, Discoveries)
 * - Max context size configuration (default 4KB)
 * - Graceful degradation (empty block if no memories match)
 * - No LLM calls (vendor-agnostic)
 * - WU-1238: Optional decay-based ranking (sortByDecay option)
 * - WU-1238: Access tracking for nodes included in context (trackAccess option)
 * - WU-1281: Lane filtering for project memories
 * - WU-1281: Recency limits for summaries (maxRecentSummaries)
 * - WU-1281: Bounded project nodes (maxProjectNodes)
 * - WU-1281: WU-specific context prioritized over project-level
 *
 * @see {@link packages/@lumenflow/cli/src/mem-context.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-context-core.test.ts} - Tests
 */

import path from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { loadMemory } from './memory-store.js';
import { MEMORY_PATTERNS, type MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';
import { computeDecayScore, DEFAULT_HALF_LIFE_MS } from './decay/scoring.js';
import { recordAccessBatch } from './decay/access-tracking.js';

/**
 * Default maximum context size in bytes (4KB)
 */
const DEFAULT_MAX_SIZE = 4096;

/**
 * WU-1281: Default maximum number of project nodes to include
 * Prevents unbounded project memory growth from truncating WU-specific context
 */
const DEFAULT_MAX_PROJECT_NODES = 10;

/**
 * WU-1281: Default maximum number of recent summaries to include
 * Ensures only the most relevant recent summaries are included
 */
const DEFAULT_MAX_RECENT_SUMMARIES = 5;

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  WU_ID_REQUIRED: 'wuId is required',
  WU_ID_EMPTY: 'wuId cannot be empty',
  WU_ID_INVALID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-1234)',
};

/**
 * Section headers for the context block
 */
const SECTION_HEADERS = {
  PROJECT_PROFILE: '## Project Profile',
  SUMMARIES: '## Summaries',
  WU_CONTEXT: '## WU Context',
  DISCOVERIES: '## Discoveries',
} as const;

/**
 * Options for generating context
 */
export interface GenerateContextOptions {
  /** WU ID to generate context for (required) */
  wuId: string;
  /** Maximum size of context block in bytes (default: 4096) */
  maxSize?: number;
  /** WU-1238: Sort by decay score instead of recency (default: false) */
  sortByDecay?: boolean;
  /** WU-1238: Track access for included nodes (default: false) */
  trackAccess?: boolean;
  /** WU-1238: Half-life in milliseconds for decay calculation (default: 30 days) */
  halfLifeMs?: number;
  /** WU-1238: Current timestamp for decay calculation (default: Date.now()) */
  now?: number;
  /** WU-1281: Filter project memories by lane (nodes with matching metadata.lane or no lane) */
  lane?: string;
  /** WU-1281: Maximum number of recent summaries to include (default: 5) */
  maxRecentSummaries?: number;
  /** WU-1281: Maximum number of project nodes to include (default: 10) */
  maxProjectNodes?: number;
}

/**
 * Statistics about the generated context
 */
export interface ContextStats {
  /** Total number of nodes included */
  totalNodes: number;
  /** Count of nodes by type */
  byType: Record<string, number>;
  /** Whether the context was truncated */
  truncated: boolean;
  /** Size of the context block in bytes */
  size: number;
  /** WU-1238: Number of nodes with access tracked */
  accessTracked?: number;
}

/**
 * Result of generating context
 */
export interface GenerateContextResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The formatted context block */
  contextBlock: string;
  /** Statistics about the selection */
  stats: ContextStats;
}

/**
 * Validates WU ID format
 *
 * @param wuId - WU ID to validate
 * @throws If WU ID is invalid
 */
function validateWuId(wuId: string): void {
  if (wuId == null) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.WU_ID_REQUIRED);
  }

  if (wuId === '') {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.WU_ID_EMPTY);
  }

  if (!MEMORY_PATTERNS.WU_ID.test(wuId)) {
    throw createError(ErrorCodes.INVALID_WU_ID, ERROR_MESSAGES.WU_ID_INVALID);
  }
}

/**
 * Comparator for sorting nodes by recency (most recent first)
 * Uses created_at as primary sort, id as secondary for stability
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
 * WU-1238: Create comparator for sorting nodes by decay score (highest first)
 * Uses decay score as primary sort, id as secondary for stability
 */
function createCompareByDecay(
  now: number,
  halfLifeMs: number,
): (a: MemoryNode, b: MemoryNode) => number {
  return (a: MemoryNode, b: MemoryNode): number => {
    const aScore = computeDecayScore(a, { now, halfLifeMs });
    const bScore = computeDecayScore(b, { now, halfLifeMs });

    // Highest score first
    if (aScore !== bScore) {
      return bScore - aScore;
    }

    // Stable sort by ID for identical scores
    return a.id.localeCompare(b.id);
  };
}

/**
 * Filters nodes by lifecycle
 */
function filterByLifecycle(nodes: MemoryNode[], lifecycle: string): MemoryNode[] {
  return nodes.filter((node) => node.lifecycle === lifecycle);
}

/**
 * Filters nodes by WU ID
 */
function filterByWuId(nodes: MemoryNode[], wuId: string): MemoryNode[] {
  return nodes.filter((node) => node.wu_id === wuId);
}

/**
 * Filters nodes by type
 */
function filterByType(nodes: MemoryNode[], type: string): MemoryNode[] {
  return nodes.filter((node) => node.type === type);
}

/**
 * WU-1281: Filters nodes by lane
 * Includes nodes that either:
 * - Have matching metadata.lane
 * - Have no lane set (general project knowledge)
 */
function filterByLane(nodes: MemoryNode[], lane: string | undefined): MemoryNode[] {
  if (!lane) {
    // No lane filter specified, include all
    return nodes;
  }

  return nodes.filter((node) => {
    const nodeLane = node.metadata?.lane as string | undefined;
    // Include if no lane (general knowledge) or lane matches
    return !nodeLane || nodeLane === lane;
  });
}

/**
 * WU-1281: Limits array to first N items
 */
function limitNodes(nodes: MemoryNode[], limit: number | undefined): MemoryNode[] {
  if (limit === undefined || limit <= 0) {
    return nodes;
  }
  return nodes.slice(0, limit);
}

/**
 * Formats a single node for display
 */
function formatNode(node: MemoryNode): string {
  const timestamp = new Date(node.created_at).toISOString().split('T')[0];
  return `- [${node.id}] (${timestamp}): ${node.content}`;
}

/**
 * Formats a section with header and nodes
 */
function formatSection(header: string, nodes: MemoryNode[]): string {
  if (nodes.length === 0) {
    return '';
  }

  const lines = [header, ''];
  for (const node of nodes) {
    lines.push(formatNode(node));
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Builds the context block header comment
 * Note: Header does not include timestamp to ensure deterministic output
 */
function buildHeader(wuId: string): string {
  return `<!-- mem:context for ${wuId} -->\n\n`;
}

/**
 * Creates an empty context result
 */
function createEmptyResult(): GenerateContextResult {
  return {
    success: true,
    contextBlock: '',
    stats: {
      totalNodes: 0,
      byType: {},
      truncated: false,
      size: 0,
    },
  };
}

/**
 * Adds a section to the sections array if it has content
 */
function addSectionIfNotEmpty(sections: string[], header: string, nodes: MemoryNode[]): void {
  const section = formatSection(header, nodes);
  if (section) {
    sections.push(section);
  }
}

/**
 * Truncates the context block to fit within max size
 * Removes nodes from the end while keeping structure intact
 */
function truncateToSize(
  contextBlock: string,
  maxSize: number,
): { content: string; truncated: boolean } {
  if (contextBlock.length <= maxSize) {
    return { content: contextBlock, truncated: false };
  }

  // Find the last complete section that fits
  const lines = contextBlock.split('\n');
  let currentSize = 0;
  const truncatedLines: string[] = [];
  let truncated = false;

  for (const line of lines) {
    const lineSize = line.length + 1; // +1 for newline
    if (currentSize + lineSize > maxSize) {
      truncated = true;
      break;
    }
    truncatedLines.push(line);
    currentSize += lineSize;
  }

  // Add truncation marker if truncated
  if (truncated) {
    truncatedLines.push('');
    truncatedLines.push('<!-- truncated - context exceeded max size -->');
  }

  return { content: truncatedLines.join('\n'), truncated };
}

/**
 * Generates a deterministic, formatted context injection block.
 *
 * Context block includes:
 * 1. Project profile items (lifecycle=project memories)
 * 2. Recent summaries relevant to the target WU
 * 3. Current WU context (checkpoints, notes with wu_id match)
 * 4. Open discoveries for the WU
 *
 * Selection is deterministic (filter by lifecycle, WU, tags, recency).
 * No LLM calls are made (vendor-agnostic).
 *
 * @param baseDir - Base directory containing .lumenflow/memory
 * @param options - Generation options
 * @returns Result with context block and statistics
 * @throws If WU ID is invalid or memory file is malformed
 *
 * @example
 * const result = await generateContext('/path/to/project', {
 *   wuId: 'WU-1234',
 *   maxSize: 8192, // 8KB
 * });
 * console.log(result.contextBlock);
 */
export async function generateContext(
  baseDir: string,
  options: GenerateContextOptions,
): Promise<GenerateContextResult> {
  const {
    wuId,
    maxSize = DEFAULT_MAX_SIZE,
    sortByDecay = false,
    trackAccess = false,
    halfLifeMs = DEFAULT_HALF_LIFE_MS,
    now = Date.now(),
    // WU-1281: New options for lane filtering and limits
    lane,
    maxRecentSummaries = DEFAULT_MAX_RECENT_SUMMARIES,
    maxProjectNodes = DEFAULT_MAX_PROJECT_NODES,
  } = options;

  // Validate WU ID
  validateWuId(wuId);

  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
  const allNodes = await loadNodesOrEmpty(memoryDir);

  if (allNodes.length === 0) {
    return createEmptyResult();
  }

  // WU-1238: Choose comparator based on sortByDecay option
  const sortComparator = sortByDecay ? createCompareByDecay(now, halfLifeMs) : compareByRecency;

  // WU-1281: Collect WU-specific nodes FIRST (high priority)
  // These are always included before project-level content
  const summaryNodes = limitNodes(
    [...filterByWuId(filterByType(allNodes, 'summary'), wuId)].sort(sortComparator),
    maxRecentSummaries,
  );
  const wuContextNodes = [...filterByWuId(allNodes, wuId)]
    .filter((node) => node.type !== 'summary' && node.type !== 'discovery')
    .sort(sortComparator);
  const discoveryNodes = [...filterByWuId(filterByType(allNodes, 'discovery'), wuId)].sort(
    sortComparator,
  );

  // WU-1281: Collect project nodes with lane filtering and limits (lower priority)
  const projectNodes = limitNodes(
    filterByLane([...filterByLifecycle(allNodes, 'project')].sort(sortComparator), lane),
    maxProjectNodes,
  );

  // WU-1281: Build context block with WU-specific content FIRST
  // Order: WU Context -> Summaries -> Discoveries -> Project Profile
  // This ensures WU-specific content is preserved when truncation occurs
  const sections: string[] = [buildHeader(wuId)];

  // WU-specific sections first (high priority)
  addSectionIfNotEmpty(sections, SECTION_HEADERS.WU_CONTEXT, wuContextNodes);
  addSectionIfNotEmpty(sections, SECTION_HEADERS.SUMMARIES, summaryNodes);
  addSectionIfNotEmpty(sections, SECTION_HEADERS.DISCOVERIES, discoveryNodes);

  // Project-level section last (lower priority, may be truncated)
  addSectionIfNotEmpty(sections, SECTION_HEADERS.PROJECT_PROFILE, projectNodes);

  // If no sections have content (only header), return empty
  if (sections.length === 1) {
    return createEmptyResult();
  }

  const rawContextBlock = sections.join('');
  const { content: contextBlock, truncated } = truncateToSize(rawContextBlock, maxSize);

  // Calculate statistics based on the limited node sets
  const selectedNodes = [...wuContextNodes, ...summaryNodes, ...discoveryNodes, ...projectNodes];
  const byType: Record<string, number> = {};
  for (const node of selectedNodes) {
    byType[node.type] = (byType[node.type] || 0) + 1;
  }

  // WU-1238: Track access for selected nodes if requested
  const accessTracked = await trackAccessIfEnabled(
    trackAccess,
    selectedNodes,
    memoryDir,
    now,
    halfLifeMs,
  );

  return {
    success: true,
    contextBlock,
    stats: {
      totalNodes: selectedNodes.length,
      byType,
      truncated,
      size: contextBlock.length,
      ...(trackAccess ? { accessTracked } : {}),
    },
  };
}

/**
 * Loads memory nodes, returning empty array if directory doesn't exist
 */
async function loadNodesOrEmpty(memoryDir: string): Promise<MemoryNode[]> {
  try {
    const memory = await loadMemory(memoryDir);
    return memory.nodes;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Tracks access for nodes if enabled, returns count of tracked nodes
 */
async function trackAccessIfEnabled(
  trackAccess: boolean,
  nodes: MemoryNode[],
  memoryDir: string,
  now: number,
  halfLifeMs: number,
): Promise<number> {
  if (!trackAccess || nodes.length === 0) {
    return 0;
  }

  try {
    const nodeIds = nodes.map((n) => n.id);
    const tracked = await recordAccessBatch(memoryDir, nodeIds, { now, halfLifeMs });
    return tracked.length;
  } catch {
    // Access tracking is best-effort; don't fail context generation
    return 0;
  }
}
