// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Cleanup Core (WU-1472, WU-1554, WU-1238)
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
 * - WU-1238: Decay-based archival for stale nodes
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
 * Decay Policy (WU-1238):
 * - Nodes with decay score below threshold are archived (not deleted)
 * - Project lifecycle nodes are never archived
 * - Already archived nodes are skipped
 *
 * @see {@link packages/@lumenflow/cli/src/mem-cleanup.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-cleanup.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ms = require('ms') as (value: string) => number;
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { loadMemoryAll, MEMORY_FILE_NAME } from './memory-store.js';
import type { MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';
import {
  archiveByDecay,
  DEFAULT_DECAY_THRESHOLD,
  type DecayArchiveResult,
} from './decay/archival.js';
import { DEFAULT_HALF_LIFE_MS } from './decay/scoring.js';

/**
 * Lifecycle policy definition
 */
interface LifecyclePolicyEntry {
  alwaysRemove: boolean;
  requiresSummarized: boolean;
  protected?: boolean;
}

/**
 * Lifecycle policy type for indexed access
 */
type LifecycleType = 'ephemeral' | 'session' | 'wu' | 'project';

/**
 * Lifecycle policy definitions
 *
 * Determines which nodes are eligible for cleanup based on lifecycle.
 */
export const LIFECYCLE_POLICY: Record<LifecycleType, LifecyclePolicyEntry> = {
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
 * Cleanup options for memory pruning
 */
export interface CleanupOptions {
  /** If true, preview without modifications */
  dryRun?: boolean;
  /** Session ID to consider closed (removes session lifecycle nodes) */
  sessionId?: string;
  /** TTL duration string (e.g., '30d', '7d', '24h') for age-based cleanup */
  ttl?: string;
  /** TTL in milliseconds (alternative to ttl string) */
  ttlMs?: number;
  /** Current timestamp for testing (defaults to Date.now()) */
  now?: number;
  /** WU-1238: Enable decay-based archival */
  decay?: boolean;
  /** WU-1238: Decay threshold (nodes below this are archived, default: 0.1) */
  decayThreshold?: number;
  /** WU-1238: Half-life in milliseconds for decay calculation (default: 30 days) */
  halfLifeMs?: number;
}

/**
 * Breakdown of cleanup by lifecycle type
 */
interface CleanupBreakdown {
  ephemeral: number;
  session: number;
  wu: number;
  sensitive: number;
  ttlExpired: number;
  activeSessionProtected: number;
  /** WU-1238: Number of nodes archived by decay */
  decayArchived: number;
}

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  /** Whether cleanup succeeded */
  success: boolean;
  /** IDs of removed nodes */
  removedIds: string[];
  /** IDs of retained nodes */
  retainedIds: string[];
  /** Approximate bytes freed (0 if dry-run) */
  bytesFreed: number;
  /** Ratio of removed to total nodes */
  compactionRatio: number;
  /** True if in dry-run mode */
  dryRun?: boolean;
  /** TTL in milliseconds if TTL was provided */
  ttlMs?: number;
  /** Breakdown by lifecycle */
  breakdown: CleanupBreakdown;
  /** WU-1238: Decay archival result (if decay mode was used) */
  decayResult?: DecayArchiveResult;
}

/**
 * Parse a TTL duration string into milliseconds (WU-1554).
 *
 * Uses the `ms` package to parse human-readable duration strings.
 *
 * @param ttlString - TTL string (e.g., '30d', '7d', '24h', '60m')
 * @returns TTL in milliseconds
 * @throws If TTL format is invalid
 *
 * @example
 * parseTtl('30d'); // 2592000000 (30 days in ms)
 * parseTtl('7d');  // 604800000 (7 days in ms)
 * parseTtl('24h'); // 86400000 (24 hours in ms)
 */
export function parseTtl(ttlString: string): number {
  if (!ttlString || typeof ttlString !== 'string') {
    throw createError(ErrorCodes.INVALID_DURATION, 'Invalid TTL format: TTL string is required');
  }

  const trimmed = ttlString.trim();
  if (!trimmed) {
    throw createError(ErrorCodes.INVALID_DURATION, 'Invalid TTL format: TTL string is required');
  }

  // Use ms package to parse the duration
  const result = ms(trimmed);

  if (result == null || result <= 0) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      `Invalid TTL format: "${ttlString}" is not a valid duration`,
    );
  }

  return result;
}

/**
 * Check if a node has expired based on TTL (WU-1554).
 *
 * @param node - Memory node to check
 * @param ttlMs - TTL in milliseconds
 * @param now - Current timestamp (defaults to Date.now())
 * @returns True if node is older than TTL
 *
 * @example
 * // Check if node is older than 30 days
 * const expired = isNodeExpired(node, 30 * 24 * 60 * 60 * 1000);
 */
export function isNodeExpired(node: MemoryNode, ttlMs: number, now: number = Date.now()): boolean {
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
 * @param node - Memory node to check
 * @returns True if node is an active session
 */
function isActiveSession(node: MemoryNode): boolean {
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
 * @param node - Memory node to check
 * @returns True if sensitive flag is set
 */
function hasSensitiveFlag(node: MemoryNode): boolean {
  if (!node.metadata) {
    return false;
  }
  return Object.hasOwn(node.metadata, SENSITIVE_FLAG) && node.metadata[SENSITIVE_FLAG] === true;
}

/**
 * Get the lifecycle policy for a node's lifecycle.
 *
 * @param lifecycle - Lifecycle name
 * @returns Policy object or undefined if not found
 */
function getLifecyclePolicy(lifecycle: string): LifecyclePolicyEntry | undefined {
  if (!Object.hasOwn(LIFECYCLE_POLICY, lifecycle)) {
    return undefined;
  }
  return LIFECYCLE_POLICY[lifecycle as LifecycleType];
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
export function shouldRemoveNode(
  node: MemoryNode,
  options: CleanupOptions = {},
): { remove: boolean; reason: string } {
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
 * @param node - Memory node
 * @returns Approximate byte size
 */
export function estimateNodeBytes(node: MemoryNode): number {
  // JSON.stringify + newline character
  return JSON.stringify(node).length + 1;
}

/**
 * Calculate compaction ratio (removed / total).
 *
 * @param removedCount - Number of removed nodes
 * @param totalCount - Total number of nodes
 * @returns Compaction ratio (0 to 1, or 0 if no nodes)
 */
export function getCompactionRatio(removedCount: number, totalCount: number): number {
  if (totalCount === 0) {
    return 0;
  }
  return removedCount / totalCount;
}

/**
 * Cleanup decision with reason
 */
interface CleanupDecision {
  remove: boolean;
  reason: string;
}

/**
 * Reason-to-breakdown-key mapping for tracking cleanup statistics.
 */
const REASON_TO_BREAKDOWN_KEY: Record<string, keyof CleanupBreakdown | undefined> = {
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
 * @param breakdown - Breakdown object to update
 * @param decision - Removal decision with reason
 */
function updateBreakdown(breakdown: CleanupBreakdown, decision: CleanupDecision): void {
  const key = REASON_TO_BREAKDOWN_KEY[decision.reason];
  if (key && Object.hasOwn(breakdown, key)) {
    breakdown[key]++;
  }
}

/**
 * Write retained nodes to memory file.
 *
 * @param memoryDir - Memory directory path
 * @param retainedNodes - Nodes to write
 */
async function writeRetainedNodes(memoryDir: string, retainedNodes: MemoryNode[]): Promise<void> {
  const filePath = path.join(memoryDir, MEMORY_FILE_NAME);
  const content =
    retainedNodes.map((n) => JSON.stringify(n)).join('\n') + (retainedNodes.length > 0 ? '\n' : '');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes known path
  await fs.writeFile(filePath, content, { encoding: 'utf-8' as BufferEncoding });
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
 * @param {string} baseDir - Base directory containing .lumenflow/memory/
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
 *
 * @example
 * // WU-1238: Decay-based archival
 * const result = await cleanupMemory(baseDir, { decay: true, decayThreshold: 0.1 });
 * console.log(`Archived ${result.breakdown.decayArchived} stale nodes`);
 */
export async function cleanupMemory(
  baseDir: string,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const {
    dryRun = false,
    sessionId,
    ttl,
    ttlMs: providedTtlMs,
    now = Date.now(),
    decay = false,
    decayThreshold = DEFAULT_DECAY_THRESHOLD,
    halfLifeMs = DEFAULT_HALF_LIFE_MS,
  } = options;
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // WU-1554: Parse TTL if provided as string
  let ttlMs = providedTtlMs;
  if (ttl && !ttlMs) {
    ttlMs = parseTtl(ttl);
  }

  // WU-1238: Handle decay-based archival if requested
  let decayResult: DecayArchiveResult | undefined;
  if (decay) {
    decayResult = await archiveByDecay(memoryDir, {
      threshold: decayThreshold,
      now,
      halfLifeMs,
      dryRun,
    });
  }

  // Load existing memory (includes all nodes for policy-based cleanup)
  // Note: We need to include archived nodes to properly track retained vs removed
  const memory = await loadMemoryAll(memoryDir);

  // Track cleanup decisions
  const removedIds: string[] = [];
  const retainedIds: string[] = [];
  const retainedNodes: MemoryNode[] = [];
  let bytesFreed = 0;
  const breakdown = {
    ephemeral: 0,
    session: 0,
    wu: 0,
    sensitive: 0,
    ttlExpired: 0,
    activeSessionProtected: 0,
    decayArchived: decayResult?.archivedIds.length ?? 0,
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
  const baseResult: CleanupResult = {
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

  // WU-1238: Add decay result if present
  if (decayResult) {
    baseResult.decayResult = decayResult;
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
