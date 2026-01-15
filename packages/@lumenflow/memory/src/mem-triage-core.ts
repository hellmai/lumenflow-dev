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
 * @see {@link tools/mem-triage.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-triage.test.mjs} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMemory, appendNode, MEMORY_FILE_NAME } from './memory-store.js';
import { validateLaneFormat } from '@lumenflow/core/dist/lane-checker.js';

/**
 * Memory directory path relative to base
 */
const MEMORY_DIR = '.beacon/memory';

/**
 * WU directory path relative to base
 */
const WU_DIR = 'docs/04-operations/tasks/wu';

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
 * Priority ranking for deterministic ordering.
 * Lower rank = higher priority.
 */
const PRIORITY_RANK = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Default rank for nodes without priority (lowest priority) */
const DEFAULT_PRIORITY_RANK = 999;

/**
 * Gets the priority rank for a node.
 *
 * @param {object} node - Memory node
 * @returns {number} Priority rank
 */
function getPriorityRank(node) {
  const priority = node.metadata?.priority;
  if (!priority) {
    return DEFAULT_PRIORITY_RANK;
  }
  return PRIORITY_RANK[priority] ?? DEFAULT_PRIORITY_RANK;
}

/**
 * Comparator for deterministic ordering: priority first, then createdAt, then ID.
 *
 * @param {object} a - First node
 * @param {object} b - Second node
 * @returns {number} Comparison result
 */
function compareNodes(a, b) {
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

/**
 * Load relationships from relationships.jsonl
 *
 * @param {string} memoryDir - Memory directory path
 * @returns {Promise<object[]>} Array of relationship objects
 */
async function loadRelationships(memoryDir) {
  const filePath = path.join(memoryDir, RELATIONSHIPS_FILE_NAME);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const relationships = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        relationships.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }

    return relationships;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Build a set of node IDs that are blocked by relationships
 *
 * @param {object[]} relationships - Relationship objects
 * @returns {Set<string>} Set of blocked node IDs
 */
function buildBlockedSet(relationships) {
  const blocked = new Set();

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
 * @param {object} node - Memory node
 * @param {Set<string>} blockedByRelationships - Set of IDs blocked by relationships
 * @returns {boolean} True if node is blocked
 */
function isBlocked(node, blockedByRelationships) {
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
 * @param {object} node - Memory node
 * @returns {boolean} True if node is closed
 */
function isClosed(node) {
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
 * @typedef {object} ListOptions
 * @property {string} [wuId] - Filter by WU ID (or 'unlinked' for nodes without wu_id)
 * @property {string} [tag] - Filter by tag
 */

/**
 * List open discovery nodes.
 *
 * Returns unblocked, non-archived discovery nodes in deterministic order.
 *
 * @param {string} baseDir - Base directory
 * @param {ListOptions} [options] - Filter options
 * @returns {Promise<object[]>} Open discovery nodes
 */
export async function listOpenDiscoveries(baseDir, options = {}) {
  const memoryDir = path.join(baseDir, MEMORY_DIR);

  const memory = await loadMemory(memoryDir);
  const relationships = await loadRelationships(memoryDir);
  const blockedByRelationships = buildBlockedSet(relationships);

  // Filter to discovery type only
  let nodes = memory.nodes.filter((node) => node.type === 'discovery');

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
    nodes = nodes.filter((node) => node.tags?.includes(options.tag));
  }

  // Sort deterministically
  return nodes.sort(compareNodes);
}

/**
 * @typedef {object} ArchiveOptions
 * @property {string} nodeId - Node ID to archive
 * @property {string} reason - Archive reason
 */

/**
 * @typedef {object} ArchiveResult
 * @property {boolean} success - Whether archiving succeeded
 * @property {string} nodeId - Archived node ID
 */

/**
 * Archive a discovery node without promotion.
 *
 * Sets metadata.status to 'archived' and records the reason.
 *
 * @param {string} baseDir - Base directory
 * @param {ArchiveOptions} options - Archive options
 * @returns {Promise<ArchiveResult>} Archive result
 * @throws {Error} If node not found, not a discovery, or already archived
 */
export async function archiveDiscovery(baseDir, options) {
  const { nodeId, reason } = options;
  const memoryDir = path.join(baseDir, MEMORY_DIR);

  const memory = await loadMemory(memoryDir);
  const node = memory.byId.get(nodeId);

  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (node.type !== 'discovery') {
    throw new Error(`Node ${nodeId} is not a discovery (type: ${node.type})`);
  }

  if (node.metadata?.status === 'archived' || node.metadata?.status === 'closed') {
    throw new Error(`Node ${nodeId} is already archived/closed`);
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
  // Note: This creates a new entry - in production, we'd need deduplication on load
  await appendNode(memoryDir, archivedNode);

  return {
    success: true,
    nodeId,
  };
}

/**
 * @typedef {object} PromoteOptions
 * @property {string} nodeId - Node ID to promote
 * @property {string} lane - WU lane
 * @property {string} [title] - Custom WU title (defaults to discovery content)
 * @property {string} [wuId] - Explicit WU ID (defaults to next available)
 * @property {string} [priority] - Priority override
 * @property {boolean} [dryRun] - If true, return spec without creating WU
 */

/**
 * @typedef {object} WUSpec
 * @property {string} id - WU ID
 * @property {string} title - WU title
 * @property {string} lane - WU lane
 * @property {string} priority - WU priority
 * @property {string} notes - WU notes with provenance
 */

/**
 * @typedef {object} PromoteResult
 * @property {boolean} success - Whether promotion succeeded
 * @property {WUSpec} wuSpec - Generated WU specification
 */

/**
 * Get next available WU ID by scanning existing WUs.
 *
 * @param {string} baseDir - Base directory
 * @returns {Promise<string>} Next WU ID (e.g., 'WU-1502')
 */
async function getNextWuId(baseDir) {
  const wuDir = path.join(baseDir, WU_DIR);
  let maxId = 0;

  try {
    const files = await fs.readdir(wuDir);
    for (const file of files) {
      const match = file.match(/^WU-(\d+)\.yaml$/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) {
          maxId = id;
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return `WU-${maxId + 1}`;
}

/**
 * Truncate content to max title length.
 *
 * @param {string} content - Content to truncate
 * @returns {string} Truncated title
 */
function truncateToTitle(content) {
  // Take first sentence or up to max length
  const firstSentence = content.split(/[.!?]/)[0].trim();
  if (firstSentence.length <= MAX_TITLE_LENGTH) {
    return firstSentence;
  }
  return firstSentence.substring(0, MAX_TITLE_LENGTH - 3) + '...';
}

/**
 * Promote a discovery node to a WU.
 *
 * @param {string} baseDir - Base directory
 * @param {PromoteOptions} options - Promote options
 * @returns {Promise<PromoteResult>} Promotion result
 * @throws {Error} If node not found, not a discovery, or already closed
 */
export async function promoteDiscovery(baseDir, options) {
  const { nodeId, lane, title, wuId, priority, dryRun = false } = options;
  const memoryDir = path.join(baseDir, MEMORY_DIR);

  // Validate lane format
  try {
    validateLaneFormat(lane);
  } catch (error) {
    throw new Error(`Invalid lane format: ${error.message}`);
  }

  const memory = await loadMemory(memoryDir);
  const node = memory.byId.get(nodeId);

  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (node.type !== 'discovery') {
    throw new Error(`Node ${nodeId} is not a discovery (type: ${node.type})`);
  }

  if (node.metadata?.status === 'archived' || node.metadata?.status === 'closed') {
    throw new Error(`Node ${nodeId} is already archived/closed`);
  }

  // Generate WU spec
  const resolvedWuId = wuId || (await getNextWuId(baseDir));
  const resolvedTitle = title || truncateToTitle(node.content);
  const resolvedPriority = priority || node.metadata?.priority || DEFAULT_PRIORITY;

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
