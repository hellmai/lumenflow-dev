/**
 * Memory Cleanup Core (WU-1472, WU-1554)
 *
 * Prune closed memory nodes based on lifecycle policy.
 * Implements compaction to prevent memory bloat.
 *
 * Features:
 * - Remove ephemeral nodes (always discarded)
 * - Remove session nodes when session is closed
 * - Archive summarized nodes (marked with summarized_into)
 * - Respect sensitive:true flag for stricter retention
 * - Support dry-run mode for preview
 * - Report compaction metrics (ratio, bytes freed)
 * - WU-1554: TTL-based expiration for old nodes
 * - WU-1554: Active session protection regardless of age
 *
 * Lifecycle Policy:
 * - ephemeral: Always removed (scratch pad data)
 * - session: Removed when session is closed
 * - wu: Removed when marked with summarized_into (after WU completion)
 * - project: Never removed (architectural knowledge)
 *
 * TTL Policy (WU-1554):
 * - Nodes older than TTL are removed regardless of lifecycle
 * - Active sessions (status: 'active') are never removed
 * - Project and sensitive nodes are protected from TTL removal
 *
 * @see {@link tools/mem-cleanup.mjs} - CLI wrapper
 * @see {@link tools/__tests__/mem-cleanup.test.mjs} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import ms from 'ms';
import { loadMemory, MEMORY_FILE_NAME } from './memory-store.js';

/**
 * Memory directory path relative to base directory
 */
const MEMORY_DIR = '.beacon/memory';

/**
 * Lifecycle policy definitions
 *
 * Determines which nodes are eligible for cleanup based on lifecycle.
 */
export const LIFECYCLE_POLICY = {
  /** Ephemeral nodes are always removed - scratch pad data */
  ephemeral: { alwaysRemove: true, requiresSummarized: false },

  /** Session nodes removed when session is closed */
  session: { alwaysRemove: false, requiresSummarized: true },

  /** WU nodes removed only when summarized_into is set */
  wu: { alwaysRemove: false, requiresSummarized: true },

  /** Project nodes are never removed - architectural knowledge */
  project: { alwaysRemove: false, requiresSummarized: false, protected: true },
};

/**
 * Metadata flag that indicates sensitive data requiring stricter retention
 */
export const SENSITIVE_FLAG = 'sensitive';

/**
 * Status value indicating an active session (WU-1554)
 */
const ACTIVE_SESSION_STATUS = 'active';

/**
 * @typedef {import('./memory-schema.mjs').MemoryNode} MemoryNode
 */

/**
 * @typedef {object} CleanupOptions
 * @property {boolean} [dryRun=false] - If true, preview without modifications
 * @property {string} [sessionId] - Session ID to consider closed (removes session lifecycle nodes)
 * @property {string} [ttl] - TTL duration string (e.g., '30d', '7d', '24h') for age-based cleanup (WU-1554)
 * @property {number} [ttlMs] - TTL in milliseconds (alternative to ttl string) (WU-1554)
 * @property {number} [now] - Current timestamp for testing (defaults to Date.now()) (WU-1554)
 */

/**
 * @typedef {object} CleanupResult
 * @property {boolean} success - Whether cleanup succeeded
 * @property {string[]} removedIds - IDs of removed nodes
 * @property {string[]} retainedIds - IDs of retained nodes
 * @property {number} bytesFreed - Approximate bytes freed (0 if dry-run)
 * @property {number} compactionRatio - Ratio of removed to total nodes
 * @property {boolean} [dryRun] - True if in dry-run mode
 * @property {number} [ttlMs] - TTL in milliseconds if TTL was provided (WU-1554)
 * @property {object} breakdown - Breakdown by lifecycle
 * @property {number} breakdown.ephemeral - Ephemeral nodes removed
 * @property {number} breakdown.session - Session nodes removed
 * @property {number} breakdown.wu - WU nodes removed (summarized)
 * @property {number} breakdown.sensitive - Sensitive nodes retained
 * @property {number} breakdown.ttlExpired - Nodes removed due to TTL expiration (WU-1554)
 * @property {number} breakdown.activeSessionProtected - Active sessions protected from removal (WU-1554)
 */

/**
 * Parse a TTL duration string into milliseconds (WU-1554).
 *
 * Uses the `ms` package to parse human-readable duration strings.
 *
 * @param {string} ttlString - TTL string (e.g., '30d', '7d', '24h', '60m')
 * @returns {number} TTL in milliseconds
 * @throws {Error} If TTL format is invalid
 *
 * @example
 * parseTtl('30d'); // 2592000000 (30 days in ms)
 * parseTtl('7d');  // 604800000 (7 days in ms)
 * parseTtl('24h'); // 86400000 (24 hours in ms)
 */
export function parseTtl(ttlString) {
  if (!ttlString || typeof ttlString !== 'string') {
    throw new Error('Invalid TTL format: TTL string is required');
  }

  const trimmed = ttlString.trim();
  if (!trimmed) {
    throw new Error('Invalid TTL format: TTL string is required');
  }

  // Use ms package to parse the duration
  const result = ms(trimmed);

  if (result === undefined || result <= 0) {
    throw new Error(`Invalid TTL format: "${ttlString}" is not a valid duration`);
  }

  return result;
}

/**
 * Check if a node has expired based on TTL (WU-1554).
 *
 * @param {MemoryNode} node - Memory node to check
 * @param {number} ttlMs - TTL in milliseconds
 * @param {number} [now] - Current timestamp (defaults to Date.now())
 * @returns {boolean} True if node is older than TTL
 *
 * @example
 * // Check if node is older than 30 days
 * const expired = isNodeExpired(node, 30 * 24 * 60 * 60 * 1000);
 */
export function isNodeExpired(node, ttlMs, now = Date.now()) {
  if (!node.created_at) {
    return false; // No timestamp means we can't determine age - safer to retain
  }

  const createdAt = new Date(node.created_at).getTime();

  // Invalid date - safer to retain
  if (Number.isNaN(createdAt)) {
    return false;
  }

  const age = now - createdAt;
  return age > ttlMs;
}

/**
 * Check if a node is an active session (WU-1554).
 *
 * Active sessions are protected from all cleanup including TTL.
 *
 * @param {MemoryNode} node - Memory node to check
 * @returns {boolean} True if node is an active session
 */
function isActiveSession(node) {
  if (node.type !== 'session') {
    return false;
  }

  if (!node.metadata) {
    return false;
  }

  return node.metadata.status === ACTIVE_SESSION_STATUS;
}

/**
 * Check if a node has the sensitive flag set in metadata.
 *
 * @param {MemoryNode} node - Memory node to check
 * @returns {boolean} True if sensitive flag is set
 */
function hasSensitiveFlag(node) {
  if (!node.metadata) {
    return false;
  }
  return Object.hasOwn(node.metadata, SENSITIVE_FLAG) && node.metadata[SENSITIVE_FLAG] === true;
}

/**
 * Get the lifecycle policy for a node's lifecycle.
 *
 * @param {string} lifecycle - Lifecycle name
 * @returns {object|undefined} Policy object or undefined if not found
 */
function getLifecyclePolicy(lifecycle) {
  if (!Object.hasOwn(LIFECYCLE_POLICY, lifecycle)) {
    return undefined;
  }
  return LIFECYCLE_POLICY[lifecycle];
}

/**
 * Check if a node should be removed based on lifecycle policy and TTL.
 *
 * Policy rules (checked in order):
 * 1. Active sessions are always retained (WU-1554)
 * 2. Sensitive nodes are always retained
 * 3. Protected lifecycle (project) nodes are never removed
 * 4. TTL expiration removes old nodes (WU-1554)
 * 5. Ephemeral nodes are always removed
 * 6. Session nodes are removed when their session is closed
 * 7. WU nodes are removed only when marked with summarized_into
 *
 * @param {MemoryNode} node - Memory node to check
 * @param {CleanupOptions} options - Cleanup options
 * @returns {{remove: boolean, reason: string}} Removal decision with reason
 */
export function shouldRemoveNode(node, options = {}) {
  const { sessionId, ttlMs, now = Date.now() } = options;

  // WU-1554: Active sessions are always protected first
  if (isActiveSession(node)) {
    return { remove: false, reason: 'active-session-protected' };
  }

  // Check sensitive flag - stricter retention
  if (hasSensitiveFlag(node)) {
    return { remove: false, reason: 'sensitive-retained' };
  }

  const policy = getLifecyclePolicy(node.lifecycle);

  // Unknown lifecycle - retain for safety
  if (!policy) {
    return { remove: false, reason: 'unknown-lifecycle' };
  }

  // Protected lifecycle (project) - never remove
  if (policy.protected) {
    return { remove: false, reason: 'protected-lifecycle' };
  }

  // WU-1554: TTL-based expiration (after protection checks)
  if (ttlMs && isNodeExpired(node, ttlMs, now)) {
    return { remove: true, reason: 'ttl-expired' };
  }

  // Ephemeral lifecycle - always remove
  if (policy.alwaysRemove) {
    return { remove: true, reason: 'ephemeral-cleanup' };
  }

  // Session lifecycle - remove if session is closed
  if (node.lifecycle === 'session' && sessionId && node.session_id === sessionId) {
    return { remove: true, reason: 'session-closed' };
  }

  // WU lifecycle - remove only if summarized
  if (policy.requiresSummarized && node.metadata?.summarized_into) {
    return { remove: true, reason: 'summarized-archived' };
  }

  // Default: retain
  return { remove: false, reason: 'policy-retained' };
}

/**
 * Calculate approximate byte size of a node when serialized.
 *
 * @param {MemoryNode} node - Memory node
 * @returns {number} Approximate byte size
 */
export function estimateNodeBytes(node) {
  // JSON.stringify + newline character
  return JSON.stringify(node).length + 1;
}

/**
 * Calculate compaction ratio (removed / total).
 *
 * @param {number} removedCount - Number of removed nodes
 * @param {number} totalCount - Total number of nodes
 * @returns {number} Compaction ratio (0 to 1, or 0 if no nodes)
 */
export function getCompactionRatio(removedCount, totalCount) {
  if (totalCount === 0) {
    return 0;
  }
  return removedCount / totalCount;
}

/**
 * Reason-to-breakdown-key mapping for tracking cleanup statistics.
 */
const REASON_TO_BREAKDOWN_KEY = {
  'ephemeral-cleanup': 'ephemeral',
  'session-closed': 'session',
  'summarized-archived': 'wu',
  'sensitive-retained': 'sensitive',
  'ttl-expired': 'ttlExpired',
  'active-session-protected': 'activeSessionProtected',
};

/**
 * Update breakdown statistics based on removal decision.
 *
 * @param {object} breakdown - Breakdown object to update
 * @param {object} decision - Removal decision with reason
 */
function updateBreakdown(breakdown, decision) {
  const key = REASON_TO_BREAKDOWN_KEY[decision.reason];
  if (key && Object.hasOwn(breakdown, key)) {
    breakdown[key]++;
  }
}

/**
 * Write retained nodes to memory file.
 *
 * @param {string} memoryDir - Memory directory path
 * @param {MemoryNode[]} retainedNodes - Nodes to write
 */
async function writeRetainedNodes(memoryDir, retainedNodes) {
  const filePath = path.join(memoryDir, MEMORY_FILE_NAME);
  const content =
    retainedNodes.map((n) => JSON.stringify(n)).join('\n') + (retainedNodes.length > 0 ? '\n' : '');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes known path
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Perform memory cleanup based on lifecycle policy and TTL.
 *
 * Removes nodes according to lifecycle policy:
 * - Active sessions are never removed (WU-1554)
 * - Sensitive nodes are always retained
 * - Project nodes are never removed
 * - TTL-expired nodes are removed (WU-1554)
 * - Ephemeral nodes are always removed
 * - Session nodes are removed when their session is closed
 * - WU nodes are removed only when marked with summarized_into
 *
 * In dry-run mode, no modifications are made but the result shows
 * what would be removed.
 *
 * @param {string} baseDir - Base directory containing .beacon/memory/
 * @param {CleanupOptions} options - Cleanup options
 * @returns {Promise<CleanupResult>} Result with removed nodes and metrics
 *
 * @example
 * // Cleanup with dry-run to preview
 * const preview = await cleanupMemory(baseDir, { dryRun: true });
 * console.log(`Would remove ${preview.removedIds.length} nodes`);
 * console.log(`Would free ${preview.bytesFreed} bytes`);
 *
 * @example
 * // Cleanup session nodes when session closes
 * const result = await cleanupMemory(baseDir, {
 *   sessionId: 'abc-123-def-456',
 * });
 * console.log(`Removed ${result.removedIds.length} nodes`);
 *
 * @example
 * // WU-1554: TTL-based cleanup
 * const result = await cleanupMemory(baseDir, { ttl: '30d' });
 * console.log(`Removed ${result.breakdown.ttlExpired} expired nodes`);
 */
export async function cleanupMemory(baseDir, options = {}) {
  const { dryRun = false, sessionId, ttl, ttlMs: providedTtlMs, now = Date.now() } = options;
  const memoryDir = path.join(baseDir, MEMORY_DIR);

  // WU-1554: Parse TTL if provided as string
  let ttlMs = providedTtlMs;
  if (ttl && !ttlMs) {
    ttlMs = parseTtl(ttl);
  }

  // Load existing memory
  const memory = await loadMemory(memoryDir);

  // Track cleanup decisions
  const removedIds = [];
  const retainedIds = [];
  const retainedNodes = [];
  let bytesFreed = 0;
  const breakdown = {
    ephemeral: 0,
    session: 0,
    wu: 0,
    sensitive: 0,
    ttlExpired: 0,
    activeSessionProtected: 0,
  };

  // Process each node
  for (const node of memory.nodes) {
    const decision = shouldRemoveNode(node, { sessionId, ttlMs, now });

    if (decision.remove) {
      removedIds.push(node.id);
      bytesFreed += estimateNodeBytes(node);
    } else {
      retainedIds.push(node.id);
      retainedNodes.push(node);
    }

    updateBreakdown(breakdown, decision);
  }

  const compactionRatio = getCompactionRatio(removedIds.length, memory.nodes.length);
  const baseResult = {
    success: true,
    removedIds,
    retainedIds,
    bytesFreed,
    compactionRatio,
    breakdown,
  };

  // WU-1554: Include TTL in result if provided
  if (ttlMs) {
    baseResult.ttlMs = ttlMs;
  }

  // If dry-run, return preview without modifications
  if (dryRun) {
    return { ...baseResult, dryRun: true };
  }

  // Write retained nodes back to file (rewrite entire file)
  if (removedIds.length > 0) {
    await writeRetainedNodes(memoryDir, retainedNodes);
  }

  return baseResult;
}
