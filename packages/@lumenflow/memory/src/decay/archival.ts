/**
 * Archival (WU-1238)
 *
 * Archive memory nodes below decay threshold.
 * Uses append-only pattern - nothing is deleted, nodes are marked with metadata.status = 'archived'.
 *
 * Archival rules:
 * - Nodes below threshold get metadata.status = 'archived'
 * - Project lifecycle nodes are never archived (protected)
 * - Already archived nodes are skipped
 * - Archived nodes excluded from default queries
 *
 * @see {@link packages/@lumenflow/memory/__tests__/archival.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMemory, MEMORY_FILE_NAME } from '../memory-store.js';

// We need to load ALL nodes including archived ones for archival processing
import type { MemoryNode } from '../memory-schema.js';
import { computeDecayScore, DEFAULT_HALF_LIFE_MS } from './scoring.js';

/**
 * Default decay threshold below which nodes are archived
 */
export const DEFAULT_DECAY_THRESHOLD = 0.1;

/**
 * Status value for archived nodes
 */
const ARCHIVED_STATUS = 'archived';

/**
 * Protected lifecycle that is never archived
 */
const PROTECTED_LIFECYCLE = 'project';

/**
 * Options for archiveByDecay
 */
export interface DecayArchiveOptions {
  /** Decay score threshold - nodes below this are archived (default: 0.1) */
  threshold?: number;
  /** Current timestamp in milliseconds (default: Date.now()) */
  now?: number;
  /** Half-life in milliseconds (default: 30 days) */
  halfLifeMs?: number;
  /** If true, preview without modifications (default: false) */
  dryRun?: boolean;
}

/**
 * Result of archiveByDecay operation
 */
export interface DecayArchiveResult {
  /** IDs of nodes that were archived */
  archivedIds: string[];
  /** IDs of nodes that were retained (above threshold) */
  retainedIds: string[];
  /** IDs of nodes that were skipped (already archived or protected) */
  skippedIds: string[];
  /** Total number of nodes processed */
  totalProcessed: number;
  /** True if in dry-run mode */
  dryRun?: boolean;
}

/**
 * Check if a node is already archived.
 *
 * @param node - Memory node to check
 * @returns True if node has metadata.status = 'archived'
 *
 * @example
 * if (isArchived(node)) {
 *   console.log('Node is already archived');
 * }
 */
export function isArchived(node: MemoryNode): boolean {
  return node.metadata?.status === ARCHIVED_STATUS;
}

/**
 * Check if a node is protected from archival.
 *
 * Protected nodes:
 * - Project lifecycle nodes (architectural knowledge)
 *
 * @param node - Memory node to check
 * @returns True if node should never be archived
 */
function isProtected(node: MemoryNode): boolean {
  return node.lifecycle === PROTECTED_LIFECYCLE;
}

/**
 * Mark a node as archived.
 *
 * @param node - Node to archive
 * @param score - The decay score that triggered archival
 * @param threshold - The threshold used
 * @param now - Current timestamp
 * @returns Node with archived status
 */
function markAsArchived(
  node: MemoryNode,
  score: number,
  threshold: number,
  now: number,
): MemoryNode {
  const timestamp = new Date(now).toISOString();

  return {
    ...node,
    metadata: {
      ...node.metadata,
      status: ARCHIVED_STATUS,
      archived_at: timestamp,
      decay: {
        ...(node.metadata?.decay as Record<string, unknown> | undefined),
        score,
        reason: `Score ${score.toFixed(4)} below threshold ${threshold}`,
        computed_at: timestamp,
      },
    },
  };
}

/**
 * Write nodes back to memory file.
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
 * Archive nodes with decay score below threshold.
 *
 * This function:
 * 1. Computes decay score for each node
 * 2. Archives nodes below the threshold
 * 3. Skips already archived and protected nodes
 * 4. Does NOT delete any nodes (append-only pattern)
 *
 * Archived nodes get:
 * - metadata.status = 'archived'
 * - metadata.archived_at = ISO timestamp
 * - metadata.decay.score = computed score
 * - metadata.decay.reason = explanation string
 *
 * @param baseDir - Base directory containing memory.jsonl
 * @param options - Archive options
 * @returns Result with lists of archived, retained, and skipped node IDs
 *
 * @example
 * // Archive nodes with decay score below 0.1
 * const result = await archiveByDecay(baseDir, { threshold: 0.1 });
 * console.log(`Archived ${result.archivedIds.length} nodes`);
 *
 * @example
 * // Dry-run to preview what would be archived
 * const preview = await archiveByDecay(baseDir, { threshold: 0.1, dryRun: true });
 * console.log(`Would archive: ${preview.archivedIds.join(', ')}`);
 */
export async function archiveByDecay(
  baseDir: string,
  options: DecayArchiveOptions = {},
): Promise<DecayArchiveResult> {
  const {
    threshold = DEFAULT_DECAY_THRESHOLD,
    now = Date.now(),
    halfLifeMs = DEFAULT_HALF_LIFE_MS,
    dryRun = false,
  } = options;

  // Load all nodes including archived ones (need to see everything for processing)
  const memory = await loadMemory(baseDir, { includeArchived: true });

  // Track results
  const archivedIds: string[] = [];
  const retainedIds: string[] = [];
  const skippedIds: string[] = [];

  // Process nodes and build updated list
  const updatedNodes = memory.nodes.map((node) => {
    // Skip already archived nodes
    if (isArchived(node)) {
      skippedIds.push(node.id);
      return node;
    }

    // Skip protected nodes (project lifecycle)
    if (isProtected(node)) {
      skippedIds.push(node.id);
      return node;
    }

    // Compute decay score
    const score = computeDecayScore(node, { now, halfLifeMs });

    // Check threshold
    if (score < threshold) {
      archivedIds.push(node.id);
      return markAsArchived(node, score, threshold, now);
    }

    retainedIds.push(node.id);
    return node;
  });

  // Write back to file if not dry-run and nodes were archived
  if (!dryRun && archivedIds.length > 0) {
    await writeMemoryFile(baseDir, updatedNodes);
  }

  return {
    archivedIds,
    retainedIds,
    skippedIds,
    totalProcessed: memory.nodes.length,
    ...(dryRun ? { dryRun: true } : {}),
  };
}
