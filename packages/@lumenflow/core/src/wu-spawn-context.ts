/**
 * Memory Context Integration for wu:spawn (WU-1240)
 *
 * Integrates mem:context functionality into wu:spawn prompts.
 * When memory.jsonl exists and contains relevant context, the spawn
 * prompt automatically includes a Memory Context section.
 *
 * Features:
 * - Detects memory layer initialization (memory.jsonl existence)
 * - Generates Memory Context section from memory nodes
 * - Configurable max context size (default 4KB)
 * - Graceful skip when memory not initialized
 * - No LLM calls (vendor-agnostic)
 *
 * @see {@link packages/@lumenflow/memory/src/mem-context-core.ts} - Core context generation
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LumenFlowConfig } from './lumenflow-config-schema.js';

/**
 * Default maximum context size in bytes (4KB)
 */
const DEFAULT_MAX_SIZE = 4096;

/**
 * Memory layer paths
 */
const MEMORY_PATHS = {
  MEMORY_DIR: '.lumenflow/memory',
  MEMORY_FILE: 'memory.jsonl',
} as const;

/**
 * Section header for memory context in spawn prompts
 */
export const MEMORY_CONTEXT_SECTION_HEADER = '## Memory Context';

/**
 * Options for generating memory context
 */
export interface GenerateMemoryContextOptions {
  /** WU ID to filter context for */
  wuId: string;
  /** Lane to filter context for */
  lane?: string;
  /** Maximum size of context block in bytes (default: 4096) */
  maxSize?: number;
}

/**
 * Memory node structure (simplified from @lumenflow/memory)
 */
interface MemoryNode {
  id: string;
  type: string;
  lifecycle: string;
  content: string;
  created_at: string;
  wu_id?: string;
  tags?: string[];
}

/**
 * Checks if the memory layer is initialized.
 *
 * The memory layer is considered initialized when:
 * 1. The .lumenflow/memory directory exists
 * 2. memory.jsonl file exists and is non-empty
 *
 * @param baseDir - Project root directory
 * @returns true if memory layer is initialized, false otherwise
 */
export async function checkMemoryLayerInitialized(baseDir: string): Promise<boolean> {
  const memoryFilePath = path.join(baseDir, MEMORY_PATHS.MEMORY_DIR, MEMORY_PATHS.MEMORY_FILE);

  if (!existsSync(memoryFilePath)) {
    return false;
  }

  try {
    const stats = statSync(memoryFilePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Gets the maximum context size from config or returns default.
 *
 * Reads from config.memory.spawn_context_max_size, defaulting to 4KB.
 *
 * @param config - LumenFlow configuration object
 * @returns Maximum context size in bytes
 */
export function getMemoryContextMaxSize(config: Partial<LumenFlowConfig>): number {
  const memoryConfig = config as { memory?: { spawn_context_max_size?: number } };
  return memoryConfig?.memory?.spawn_context_max_size ?? DEFAULT_MAX_SIZE;
}

/**
 * Loads memory nodes from memory.jsonl file.
 *
 * @param memoryFilePath - Path to memory.jsonl
 * @returns Array of memory nodes
 */
function loadMemoryNodes(memoryFilePath: string): MemoryNode[] {
  const content = readFileSync(memoryFilePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  const nodes: MemoryNode[] = [];
  for (const line of lines) {
    try {
      const node = JSON.parse(line) as MemoryNode;
      nodes.push(node);
    } catch {
      // Skip malformed lines
    }
  }

  return nodes;
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
 * Sorts nodes by recency (most recent first)
 */
function sortByRecency(nodes: MemoryNode[]): MemoryNode[] {
  return [...nodes].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return a.id.localeCompare(b.id);
  });
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
 * Truncates content to fit within max size
 */
function truncateToSize(content: string, maxSize: number): string {
  if (content.length <= maxSize) {
    return content;
  }

  const lines = content.split('\n');
  let currentSize = 0;
  const truncatedLines: string[] = [];

  for (const line of lines) {
    const lineSize = line.length + 1;
    if (currentSize + lineSize > maxSize - 50) {
      // Leave room for truncation marker
      truncatedLines.push('');
      truncatedLines.push('<!-- context truncated - exceeded max size -->');
      break;
    }
    truncatedLines.push(line);
    currentSize += lineSize;
  }

  return truncatedLines.join('\n');
}

/**
 * Generates the Memory Context section for wu:spawn prompts.
 *
 * Collects relevant memory nodes and formats them into a structured
 * markdown section suitable for embedding in spawn prompts.
 *
 * Context includes:
 * 1. Project profile items (lifecycle=project memories)
 * 2. WU-specific context (checkpoints, notes matching wu_id)
 * 3. Discoveries related to the WU
 *
 * @param baseDir - Project root directory
 * @param options - Generation options (wuId, lane, maxSize)
 * @returns Formatted Memory Context section, or empty string if no context
 */
export async function generateMemoryContextSection(
  baseDir: string,
  options: GenerateMemoryContextOptions,
): Promise<string> {
  const { wuId, maxSize = DEFAULT_MAX_SIZE } = options;

  const memoryFilePath = path.join(baseDir, MEMORY_PATHS.MEMORY_DIR, MEMORY_PATHS.MEMORY_FILE);

  // Check if memory layer is initialized
  const isInitialized = await checkMemoryLayerInitialized(baseDir);
  if (!isInitialized) {
    return '';
  }

  // Load memory nodes
  let allNodes: MemoryNode[];
  try {
    allNodes = loadMemoryNodes(memoryFilePath);
  } catch {
    return '';
  }

  if (allNodes.length === 0) {
    return '';
  }

  // Collect nodes for each section
  // 1. Project profile: lifecycle=project
  const projectNodes = sortByRecency(filterByLifecycle(allNodes, 'project'));

  // 2. WU context: wu_id match, not discovery type
  const wuNodes = filterByWuId(allNodes, wuId);
  const wuContextNodes = sortByRecency(
    wuNodes.filter((node) => node.type !== 'discovery' && node.type !== 'summary'),
  );

  // 3. Summaries: type=summary, wu_id match
  const summaryNodes = sortByRecency(wuNodes.filter((node) => node.type === 'summary'));

  // 4. Discoveries: type=discovery, wu_id match
  const discoveryNodes = sortByRecency(wuNodes.filter((node) => node.type === 'discovery'));

  // Build the content sections
  const sections: string[] = [];

  const projectSection = formatSection('### Project Profile', projectNodes);
  if (projectSection) {
    sections.push(projectSection);
  }

  const summarySection = formatSection('### Summaries', summaryNodes);
  if (summarySection) {
    sections.push(summarySection);
  }

  const wuContextSection = formatSection('### WU Context', wuContextNodes);
  if (wuContextSection) {
    sections.push(wuContextSection);
  }

  const discoverySection = formatSection('### Discoveries', discoveryNodes);
  if (discoverySection) {
    sections.push(discoverySection);
  }

  // If no sections have content, return empty
  if (sections.length === 0) {
    return '';
  }

  // Build the full Memory Context section
  const header = `${MEMORY_CONTEXT_SECTION_HEADER}\n\n`;
  const intro = `Prior context from memory layer for ${wuId}:\n\n`;
  const content = header + intro + sections.join('');

  // Apply size limit
  return truncateToSize(content, maxSize);
}
