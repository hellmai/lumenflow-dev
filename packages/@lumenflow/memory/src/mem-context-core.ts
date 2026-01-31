/**
 * Memory Context Core (WU-1234, WU-1238)
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
 *
 * @see {@link packages/@lumenflow/cli/src/mem-context.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-context-core.test.ts} - Tests
 */

import path from 'node:path';
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
  if (wuId === undefined || wuId === null) {
    throw new Error(ERROR_MESSAGES.WU_ID_REQUIRED);
  }

  if (wuId === '') {
    throw new Error(ERROR_MESSAGES.WU_ID_EMPTY);
  }

  if (!MEMORY_PATTERNS.WU_ID.test(wuId)) {
    throw new Error(ERROR_MESSAGES.WU_ID_INVALID);
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
  } = options;

  // WU-1238: Choose comparator based on sortByDecay option
  const sortComparator = sortByDecay ? createCompareByDecay(now, halfLifeMs) : compareByRecency;

  // Validate WU ID
  validateWuId(wuId);

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
        contextBlock: '',
        stats: {
          totalNodes: 0,
          byType: {},
          truncated: false,
          size: 0,
        },
      };
    }
    throw error;
  }

  // If no nodes, return empty result
  if (allNodes.length === 0) {
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

  // Collect nodes for each section
  // WU-1238: Use sortComparator for all sections (either recency or decay-based)
  // 1. Project profile: lifecycle=project
  const projectNodes = [...filterByLifecycle(allNodes, 'project')].sort(sortComparator);

  // 2. Summaries: type=summary, wu_id match OR recent
  const allSummaries = filterByType(allNodes, 'summary');
  const wuSummaries = filterByWuId(allSummaries, wuId);
  const summaryNodes = [...wuSummaries].sort(sortComparator);

  // 3. WU context: wu_id match, not summary/discovery
  const wuNodes = filterByWuId(allNodes, wuId);
  const wuContextFiltered = wuNodes.filter(
    (node) => node.type !== 'summary' && node.type !== 'discovery',
  );
  const wuContextNodes = [...wuContextFiltered].sort(sortComparator);

  // 4. Discoveries: type=discovery, wu_id match
  const discoveryFiltered = filterByWuId(filterByType(allNodes, 'discovery'), wuId);
  const discoveryNodes = [...discoveryFiltered].sort(sortComparator);

  // Build the context block
  const sections: string[] = [];

  sections.push(buildHeader(wuId));

  const projectSection = formatSection(SECTION_HEADERS.PROJECT_PROFILE, projectNodes);
  if (projectSection) {
    sections.push(projectSection);
  }

  const summarySection = formatSection(SECTION_HEADERS.SUMMARIES, summaryNodes);
  if (summarySection) {
    sections.push(summarySection);
  }

  const wuContextSection = formatSection(SECTION_HEADERS.WU_CONTEXT, wuContextNodes);
  if (wuContextSection) {
    sections.push(wuContextSection);
  }

  const discoverySection = formatSection(SECTION_HEADERS.DISCOVERIES, discoveryNodes);
  if (discoverySection) {
    sections.push(discoverySection);
  }

  // If no sections have content, return empty
  if (sections.length === 1) {
    // Only header
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

  const rawContextBlock = sections.join('');

  // Apply size limit
  const { content: contextBlock, truncated } = truncateToSize(rawContextBlock, maxSize);

  // Calculate statistics
  const selectedNodes = [...projectNodes, ...summaryNodes, ...wuContextNodes, ...discoveryNodes];
  const byType: Record<string, number> = {};
  for (const node of selectedNodes) {
    byType[node.type] = (byType[node.type] || 0) + 1;
  }

  // WU-1238: Track access for selected nodes if requested
  let accessTracked = 0;
  if (trackAccess && selectedNodes.length > 0) {
    const nodeIds = selectedNodes.map((n) => n.id);
    try {
      const tracked = await recordAccessBatch(memoryDir, nodeIds, { now, halfLifeMs });
      accessTracked = tracked.length;
    } catch {
      // Access tracking is best-effort; don't fail context generation
    }
  }

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
