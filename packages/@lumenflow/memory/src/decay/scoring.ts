/**
 * Decay Scoring (WU-1238)
 *
 * Compute decay scores for memory nodes to manage relevance over time.
 * Frequently accessed, recent memories rank higher than stale, rarely-used ones.
 *
 * Decay scoring algorithm:
 * - recencyScore = exp(-age / HALF_LIFE_MS)
 * - accessScore = log1p(access_count) / 10
 * - importanceScore = priority P0=2, P1=1.5, P2=1, P3=0.5
 * - decayScore = recencyScore * (1 + accessScore) * importanceScore
 *
 * @see {@link packages/@lumenflow/memory/__tests__/decay-scoring.test.ts} - Tests
 */

import type { MemoryNode } from '../memory-schema.js';

/**
 * Default half-life for decay scoring: 30 days in milliseconds
 */
export const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Importance multipliers by priority level.
 * P0 (critical) gets highest importance, P3 (low) gets lowest.
 */
export const IMPORTANCE_BY_PRIORITY: Record<string, number> = {
  P0: 2,
  P1: 1.5,
  P2: 1,
  P3: 0.5,
};

/**
 * Default importance for nodes without priority
 */
const DEFAULT_IMPORTANCE = 1;

/**
 * Options for computing decay score
 */
export interface DecayScoreOptions {
  /** Current timestamp in milliseconds (default: Date.now()) */
  now?: number;
  /** Half-life in milliseconds (default: 30 days) */
  halfLifeMs?: number;
}

/**
 * Gets the reference timestamp for a node (most recent of created_at/updated_at).
 *
 * @param node - Memory node
 * @returns Timestamp in milliseconds
 */
function getNodeTimestamp(node: MemoryNode): number {
  const createdAt = new Date(node.created_at).getTime();

  if (!node.updated_at) {
    return createdAt;
  }

  const updatedAt = new Date(node.updated_at).getTime();

  // Use the more recent timestamp
  return Math.max(createdAt, updatedAt);
}

/**
 * Compute recency score based on exponential decay.
 *
 * Formula: exp(-age / halfLife)
 * - Returns 1 for brand new nodes
 * - Returns exp(-1) ~= 0.368 at half-life
 * - Approaches 0 for very old nodes
 *
 * @param node - Memory node to score
 * @param halfLifeMs - Half-life in milliseconds
 * @param now - Current timestamp (default: Date.now())
 * @returns Recency score between 0 and 1
 *
 * @example
 * const score = computeRecencyScore(node, DEFAULT_HALF_LIFE_MS);
 * // Returns ~1 for recent nodes, ~0.368 at half-life, ~0 for old nodes
 */
export function computeRecencyScore(
  node: MemoryNode,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
  now: number = Date.now(),
): number {
  const nodeTimestamp = getNodeTimestamp(node);
  const age = now - nodeTimestamp;

  // Exponential decay: exp(-age / halfLife)
  return Math.exp(-age / halfLifeMs);
}

/**
 * Compute access score based on access count.
 *
 * Formula: log1p(access_count) / 10
 * - Returns 0 for nodes with no access
 * - Logarithmic scaling prevents runaway scores for frequently accessed nodes
 * - Bounded contribution (log1p(1000)/10 ~= 0.691)
 *
 * @param node - Memory node to score
 * @returns Access score (0 to ~0.7 for typical access counts)
 *
 * @example
 * const score = computeAccessScore(node);
 * // Returns 0 for no access, ~0.07 for 1 access, ~0.24 for 10 accesses
 */
export function computeAccessScore(node: MemoryNode): number {
  const accessCount = (node.metadata?.access as { count?: number } | undefined)?.count ?? 0;

  // log1p(x) = ln(1 + x), divided by 10 to keep contribution bounded
  return Math.log1p(accessCount) / 10;
}

/**
 * Compute importance score based on priority level.
 *
 * Priority multipliers:
 * - P0: 2 (critical, highest importance)
 * - P1: 1.5 (high)
 * - P2: 1 (medium, default)
 * - P3: 0.5 (low)
 *
 * @param node - Memory node to score
 * @returns Importance multiplier (0.5 to 2)
 *
 * @example
 * const score = computeImportanceScore(node);
 * // Returns 2 for P0, 1.5 for P1, 1 for P2/default, 0.5 for P3
 */
export function computeImportanceScore(node: MemoryNode): number {
  const priority = node.metadata?.priority as string | undefined;

  if (!priority) {
    return DEFAULT_IMPORTANCE;
  }

  return IMPORTANCE_BY_PRIORITY[priority] ?? DEFAULT_IMPORTANCE;
}

/**
 * Compute the overall decay score for a memory node.
 *
 * Formula: recencyScore * (1 + accessScore) * importanceScore
 *
 * The score combines:
 * - Recency: Exponential decay based on age
 * - Access: Logarithmic boost for frequently accessed nodes
 * - Importance: Priority-based multiplier
 *
 * Higher scores indicate more relevant nodes that should be retained.
 * Lower scores indicate stale nodes that may be archived.
 *
 * @param node - Memory node to score
 * @param options - Scoring options (now, halfLifeMs)
 * @returns Decay score (0 to ~2 for typical nodes)
 *
 * @example
 * const score = computeDecayScore(node, { now: Date.now() });
 * // Returns high score for recent/accessed/important nodes
 * // Returns low score for old/unused/low-priority nodes
 */
export function computeDecayScore(node: MemoryNode, options: DecayScoreOptions = {}): number {
  const { now = Date.now(), halfLifeMs = DEFAULT_HALF_LIFE_MS } = options;

  const recencyScore = computeRecencyScore(node, halfLifeMs, now);
  const accessScore = computeAccessScore(node);
  const importanceScore = computeImportanceScore(node);

  // Combined formula: recency * (1 + access) * importance
  return recencyScore * (1 + accessScore) * importanceScore;
}
