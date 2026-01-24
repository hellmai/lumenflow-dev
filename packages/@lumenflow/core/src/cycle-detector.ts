/**
 * Cycle Detection Module (WU-1088)
 *
 * Provides cycle detection for WU dependency graphs.
 * Extracted from @lumenflow/initiatives to break circular dependency.
 *
 * @module @lumenflow/core/cycle-detector
 */

/**
 * WU object interface for validation and cycle detection
 * Note: This interface is shared with @lumenflow/initiatives for backward compatibility
 */
export interface WUObject {
  id?: string;
  blocks?: string[];
  blocked_by?: string[];
  initiative?: string;
  phase?: number;
  [key: string]: unknown;
}

/**
 * Result of cycle detection
 */
export interface CycleResult {
  hasCycle: boolean;
  cycles: string[][];
}

/**
 * Detects circular dependencies in WU dependency graph using DFS
 *
 * Uses standard cycle detection: tracks visited nodes and nodes in current
 * recursion stack. If we encounter a node already in the recursion stack,
 * we've found a cycle.
 *
 * Note: This function treats both `blocks` and `blocked_by` as edges for
 * traversal. This means if WU-A blocks WU-B, and WU-B's blocked_by includes
 * WU-A, following both directions will find a path back to WU-A.
 *
 * @param wuMap - Map of WU ID to WU object
 * @returns Cycle detection result with hasCycle boolean and cycles array
 *
 * @example
 * const wuMap = new Map([
 *   ['WU-001', { id: 'WU-001', blocks: ['WU-002'] }],
 *   ['WU-002', { id: 'WU-002', blocks: ['WU-001'] }],
 * ]);
 * const result = detectCycles(wuMap);
 * // result.hasCycle === true
 * // result.cycles contains the cycle path
 */
export function detectCycles(wuMap: Map<string, WUObject>): CycleResult {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[][] = [];

  /**
   * DFS traversal to detect cycles
   * @param wuId - Current WU ID
   * @param path - Current path from root
   * @returns True if cycle found
   */
  function dfs(wuId: string, path: string[]): boolean {
    // If node is in recursion stack, we found a cycle
    if (recursionStack.has(wuId)) {
      const cycleStart = path.indexOf(wuId);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), wuId]);
      } else {
        // Self-reference case
        cycles.push([wuId, wuId]);
      }
      return true;
    }

    // If already fully visited, skip
    if (visited.has(wuId)) {
      return false;
    }

    // Mark as being processed
    visited.add(wuId);
    recursionStack.add(wuId);

    // Get dependencies (both blocks and blocked_by create edges)
    // Only use arrays - ignore legacy string format for backward compatibility
    const wu = wuMap.get(wuId);
    const blocks = Array.isArray(wu?.blocks) ? wu.blocks : [];
    const blockedBy = Array.isArray(wu?.blocked_by) ? wu.blocked_by : [];
    const deps = [...blocks, ...blockedBy];

    // Visit all dependencies
    for (const dep of deps) {
      // Only traverse if the dependency exists in our map
      if (wuMap.has(dep)) {
        dfs(dep, [...path, wuId]);
      }
    }

    // Remove from recursion stack (done processing)
    recursionStack.delete(wuId);
    return false;
  }

  // Run DFS from each node to find all cycles
  for (const wuId of wuMap.keys()) {
    if (!visited.has(wuId)) {
      dfs(wuId, []);
    }
  }

  return {
    hasCycle: cycles.length > 0,
    cycles,
  };
}
