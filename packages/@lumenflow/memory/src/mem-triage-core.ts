// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Triage Core (WU-1470)
 *
 * Review discovery nodes and promote to WUs or archive.
 *
 * Features:
 * - List open discovery nodes with deterministic ordering
 * - Promote discovery to WU (integrates with wu:create)
 * - Archive discovery without promotion
 *
 * @see {@link packages/@lumenflow/cli/src/mem-triage.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-triage.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMemory, appendNode } from './memory-store.js';
import type { MemoryNode } from './memory-schema.js';
import type { NodeFsError } from '@lumenflow/core/wu-constants';
import { validateLaneFormat } from '@lumenflow/core/lane-checker';
import { createWuPaths } from '@lumenflow/core/wu-paths';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Relationships file name
 */
const RELATIONSHIPS_FILE_NAME = 'relationships.jsonl';

/**
 * Default priority for promoted WUs
 */
const DEFAULT_PRIORITY = 'P2';

/**
 * Maximum WU title length
 */
const MAX_TITLE_LENGTH = 80;

/**
 * Priority levels for memory nodes
 */
type PriorityLevel = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Priority ranking for deterministic ordering.
 * Lower rank = higher priority.
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
 * Memory node structure for triage operations
 */
interface TriageMemoryNode {
  id: string;
  type: string;
  lifecycle: string;
  content: string;
  created_at: string;
  updated_at?: string;
  wu_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Relationship between memory nodes
 */
interface TriageRelationship {
  from_id: string;
  to_id: string;
  type: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gets the priority rank for a node.
 *
 * @param node - Memory node
 * @returns Priority rank
 */
function getPriorityRank(node: TriageMemoryNode): number {
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
 * @returns Comparison result
 */
function compareNodes(a: TriageMemoryNode, b: TriageMemoryNode): number {
  const priorityDiff = getPriorityRank(a) - getPriorityRank(b);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return a.id.localeCompare(b.id);
}

// WU-1548: NodeFsError imported from @lumenflow/core/wu-constants (consolidated)

/**
 * Load relationships from relationships.jsonl
 *
 * @param memoryDir - Memory directory path
 * @returns Array of relationship objects
 */
async function loadRelationships(memoryDir: string): Promise<TriageRelationship[]> {
  const filePath = path.join(memoryDir, RELATIONSHIPS_FILE_NAME);

  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' as BufferEncoding });
    const lines = content.split('\n');
    const relationships: TriageRelationship[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        relationships.push(JSON.parse(trimmed) as TriageRelationship);
      } catch {
        continue;
      }
    }

    return relationships;
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
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
function buildBlockedSet(relationships: TriageRelationship[]): Set<string> {
  const blocked = new Set<string>();

  for (const rel of relationships) {
    if (rel.type === 'blocks') {
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
function isBlocked(node: TriageMemoryNode, blockedByRelationships: Set<string>): boolean {
  if (blockedByRelationships.has(node.id)) {
    return true;
  }

  const blockedBy = node.metadata?.blocked_by;
  if (Array.isArray(blockedBy) && blockedBy.length > 0) {
    return true;
  }

  return false;
}

/**
 * Check if a node is closed/archived
 *
 * @param node - Memory node
 * @returns True if node is closed
 */
function isClosed(node: TriageMemoryNode): boolean {
  const status = node.metadata?.status;
  if (status === 'closed' || status === 'archived') {
    return true;
  }

  if (node.lifecycle === 'ephemeral') {
    return true;
  }

  return false;
}

/**
 * Options for listing discoveries
 */
export interface ListOptions {
  /** Filter by WU ID (or 'unlinked' for nodes without wu_id) */
  wuId?: string;
  /** Filter by tag */
  tag?: string;
}

/**
 * List open discovery nodes.
 *
 * Returns unblocked, non-archived discovery nodes in deterministic order.
 *
 * @param baseDir - Base directory
 * @param options - Filter options
 * @returns Open discovery nodes
 */
export async function listOpenDiscoveries(
  baseDir: string,
  options: ListOptions = {},
): Promise<TriageMemoryNode[]> {
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  const memory = await loadMemory(memoryDir);
  const relationships = await loadRelationships(memoryDir);
  const blockedByRelationships = buildBlockedSet(relationships);

  // Filter to discovery type only
  let nodes = (memory.nodes as TriageMemoryNode[]).filter((node) => node.type === 'discovery');

  // Filter out blocked nodes
  nodes = nodes.filter((node) => !isBlocked(node, blockedByRelationships));

  // Filter out closed/archived nodes
  nodes = nodes.filter((node) => !isClosed(node));

  // Apply WU filter
  if (options.wuId) {
    if (options.wuId === 'unlinked') {
      nodes = nodes.filter((node) => !node.wu_id);
    } else {
      nodes = nodes.filter((node) => node.wu_id === options.wuId);
    }
  }

  // Apply tag filter
  if (options.tag) {
    const filterTag = options.tag;
    nodes = nodes.filter((node) => node.tags?.includes(filterTag));
  }

  // Sort deterministically
  return nodes.sort(compareNodes);
}

/**
 * Options for archiving a discovery
 */
export interface ArchiveOptions {
  /** Node ID to archive */
  nodeId: string;
  /** Archive reason */
  reason: string;
}

/**
 * Result of archiving a discovery
 */
export interface ArchiveResult {
  /** Whether archiving succeeded */
  success: boolean;
  /** Archived node ID */
  nodeId: string;
}

/**
 * Archive a discovery node without promotion.
 *
 * Sets metadata.status to 'archived' and records the reason.
 *
 * @param baseDir - Base directory
 * @param options - Archive options
 * @returns Archive result
 * @throws If node not found, not a discovery, or already archived
 */
export async function archiveDiscovery(
  baseDir: string,
  options: ArchiveOptions,
): Promise<ArchiveResult> {
  const { nodeId, reason } = options;
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  const memory = await loadMemory(memoryDir);
  const node = memory.byId.get(nodeId) as TriageMemoryNode | undefined;

  if (!node) {
    throw createError(ErrorCodes.NODE_NOT_FOUND, `Node not found: ${nodeId}`);
  }

  if (node.type !== 'discovery') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Node ${nodeId} is not a discovery (type: ${node.type})`,
    );
  }

  if (node.metadata?.status === 'archived' || node.metadata?.status === 'closed') {
    throw createError(ErrorCodes.ALREADY_EXISTS, `Node ${nodeId} is already archived/closed`);
  }

  // Create updated node with archive metadata
  const archivedNode = {
    ...node,
    metadata: {
      ...node.metadata,
      status: 'archived',
      archive_reason: reason,
      archived_at: new Date().toISOString(),
    },
  };

  // Append updated node (JSONL append-only model)
  // WU-1910: loadMemory now deduplicates by node ID (last-write-wins), so the
  // archived entry appended here will suppress the original on next load.
  // Cast is safe here because the node came from loadMemory which validates the schema
  await appendNode(memoryDir, archivedNode as unknown as MemoryNode);

  return {
    success: true,
    nodeId,
  };
}

/**
 * Options for promoting a discovery to a WU
 */
export interface PromoteOptions {
  /** Node ID to promote */
  nodeId: string;
  /** WU lane */
  lane: string;
  /** Custom WU title (defaults to discovery content) */
  title?: string;
  /** Explicit WU ID (defaults to next available) */
  wuId?: string;
  /** Priority override */
  priority?: string;
  /** If true, return spec without creating WU */
  dryRun?: boolean;
}

/**
 * WU specification generated from promotion
 */
export interface WUSpec {
  /** WU ID */
  id: string;
  /** WU title */
  title: string;
  /** WU lane */
  lane: string;
  /** WU priority */
  priority: string;
  /** WU notes with provenance */
  notes: string;
}

/**
 * Result of promoting a discovery
 */
export interface PromoteResult {
  /** Whether promotion succeeded */
  success: boolean;
  /** Generated WU specification */
  wuSpec: WUSpec;
}

/**
 * Get next available WU ID by scanning existing WUs.
 *
 * @param baseDir - Base directory
 * @returns Next WU ID (e.g., 'WU-1502')
 */
async function getNextWuId(baseDir: string): Promise<string> {
  const paths = createWuPaths({ projectRoot: baseDir });
  const wuDir = path.join(baseDir, paths.WU_DIR());
  let maxId = 0;

  try {
    const files = await fs.readdir(wuDir);
    for (const file of files) {
      const match = file.match(/^WU-(\d+)\.yaml$/);
      if (match && match[1]) {
        const id = parseInt(match[1], 10);
        if (id > maxId) {
          maxId = id;
        }
      }
    }
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return `WU-${maxId + 1}`;
}

/**
 * Truncate content to max title length.
 *
 * @param content - Content to truncate
 * @returns Truncated title
 */
function truncateToTitle(content: string): string {
  // Take first sentence or up to max length
  const parts = content.split(/[.!?]/);
  const firstSentence = (parts[0] ?? '').trim();
  if (firstSentence.length <= MAX_TITLE_LENGTH) {
    return firstSentence;
  }
  return firstSentence.substring(0, MAX_TITLE_LENGTH - 3) + '...';
}

/**
 * Promote a discovery node to a WU.
 *
 * @param baseDir - Base directory
 * @param options - Promote options
 * @returns Promotion result
 * @throws If node not found, not a discovery, or already closed
 */
export async function promoteDiscovery(
  baseDir: string,
  options: PromoteOptions,
): Promise<PromoteResult> {
  const { nodeId, lane, title, wuId, priority, dryRun: _dryRun = false } = options;
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Validate lane format
  try {
    validateLaneFormat(lane);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw createError(ErrorCodes.INVALID_LANE, `Invalid lane format: ${errMsg}`, { cause: err });
  }

  const memory = await loadMemory(memoryDir);
  const node = memory.byId.get(nodeId) as TriageMemoryNode | undefined;

  if (!node) {
    throw createError(ErrorCodes.NODE_NOT_FOUND, `Node not found: ${nodeId}`);
  }

  if (node.type !== 'discovery') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Node ${nodeId} is not a discovery (type: ${node.type})`,
    );
  }

  if (node.metadata?.status === 'archived' || node.metadata?.status === 'closed') {
    throw createError(ErrorCodes.ALREADY_EXISTS, `Node ${nodeId} is already archived/closed`);
  }

  // Generate WU spec
  const resolvedWuId = wuId || (await getNextWuId(baseDir));
  const resolvedTitle = title || truncateToTitle(node.content);
  const resolvedPriority =
    priority || (node.metadata?.priority as string | undefined) || DEFAULT_PRIORITY;

  const wuSpec = {
    id: resolvedWuId,
    title: resolvedTitle,
    lane,
    priority: resolvedPriority,
    notes: `Promoted from discovery ${nodeId}`,
  };

  return {
    success: true,
    wuSpec,
  };
}
