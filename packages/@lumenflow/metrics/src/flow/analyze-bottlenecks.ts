/**
 * Bottleneck Analysis Module
 *
 * Provides dependency graph analysis for identifying bottlenecks and critical paths.
 * Includes topological sort, impact scoring, and critical path algorithms.
 *
 * @module @lumenflow/metrics/flow
 */

import type {
  DependencyGraphNode,
  BottleneckResult,
  CriticalPathResult,
  BottleneckAnalysis,
} from '../types.js';

/** Default WU status for done items */
const WU_STATUS_DONE = 'done';

/**
 * Dependency graph type - Map of WU ID to node data
 */
export type DependencyGraph = Map<string, DependencyGraphNode>;

/**
 * Result from topological sort
 */
export interface TopologicalSortResult {
  order: string[];
  hasCycle: boolean;
  warning?: string;
  cycleNodes?: string[];
}

/**
 * Filter graph to active (non-done) WUs only.
 */
function filterActiveGraph(graph: DependencyGraph): DependencyGraph {
  const activeGraph = new Map<string, DependencyGraphNode>();
  for (const [id, node] of graph.entries()) {
    if (node.status !== WU_STATUS_DONE) {
      activeGraph.set(id, node);
    }
  }
  return activeGraph;
}

/**
 * Build in-degree map for topological sort
 */
function buildInDegreeMap(activeGraph: DependencyGraph): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const [id, node] of activeGraph.entries()) {
    let count = 0;
    for (const depId of node.blockedBy) {
      if (activeGraph.has(depId)) {
        count++;
      }
    }
    inDegree.set(id, count);
  }
  return inDegree;
}

/**
 * Find nodes with zero in-degree (no active dependencies)
 */
function findStartingNodes(inDegree: Map<string, number>): string[] {
  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }
  return queue;
}

/**
 * Process a single node in topological sort
 */
function processNode(
  current: string,
  activeGraph: DependencyGraph,
  inDegree: Map<string, number>,
  workQueue: string[]
): void {
  const node = activeGraph.get(current);
  if (!node) return;

  for (const depId of node.blocks) {
    if (!activeGraph.has(depId)) continue;

    const currentDegree = inDegree.get(depId) ?? 0;
    const newDegree = currentDegree - 1;
    inDegree.set(depId, newDegree);

    if (newDegree === 0) {
      workQueue.push(depId);
    }
  }
}

/**
 * Find nodes involved in cycles
 */
function findCycleNodes(inDegree: Map<string, number>): string[] {
  const cycleNodes: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree > 0) {
      cycleNodes.push(id);
    }
  }
  return cycleNodes;
}

/**
 * Process topological sort using Kahn's algorithm
 */
function processTopologicalSort(
  activeGraph: DependencyGraph,
  inDegree: Map<string, number>,
  queue: string[]
): { sorted: string[]; cycleNodes: string[] } {
  const sorted: string[] = [];
  const workQueue = [...queue];

  while (workQueue.length > 0) {
    const current = workQueue.shift();
    if (current) {
      sorted.push(current);
      processNode(current, activeGraph, inDegree, workQueue);
    }
  }

  return { sorted, cycleNodes: findCycleNodes(inDegree) };
}

/**
 * Perform topological sort on non-done WUs using Kahn's algorithm.
 * Returns valid execution ordering where dependencies come before dependents.
 * Handles cycles gracefully by returning partial ordering with warning.
 */
export function topologicalSort(graph: DependencyGraph): TopologicalSortResult {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return { order: [], hasCycle: false };
  }

  const inDegree = buildInDegreeMap(activeGraph);
  const queue = findStartingNodes(inDegree);
  const { sorted, cycleNodes } = processTopologicalSort(activeGraph, inDegree, queue);

  if (sorted.length < activeGraph.size) {
    return {
      order: sorted,
      hasCycle: true,
      warning: 'Cycle detected: some WUs have circular dependencies',
      cycleNodes,
    };
  }

  return { order: sorted, hasCycle: false };
}

/**
 * Calculate distances for critical path using dynamic programming
 */
function calculateDistances(
  activeGraph: DependencyGraph,
  topoOrder: string[]
): { distance: Map<string, number>; predecessor: Map<string, string | null> } {
  const distance = new Map<string, number>();
  const predecessor = new Map<string, string | null>();

  for (const id of topoOrder) {
    distance.set(id, 1);
    predecessor.set(id, null);
  }

  for (const current of topoOrder) {
    const node = activeGraph.get(current);
    if (!node) continue;

    for (const depId of node.blocks) {
      if (!activeGraph.has(depId)) continue;

      const currentDist = distance.get(current) ?? 0;
      const newDistance = currentDist + 1;
      const existingDist = distance.get(depId) ?? 0;

      if (newDistance > existingDist) {
        distance.set(depId, newDistance);
        predecessor.set(depId, current);
      }
    }
  }

  return { distance, predecessor };
}

/**
 * Reconstruct path from predecessor map
 */
function reconstructPath(
  predecessor: Map<string, string | null>,
  endNode: string | null
): string[] {
  const path: string[] = [];
  let current: string | null = endNode;
  while (current !== null) {
    path.unshift(current);
    current = predecessor.get(current) ?? null;
  }
  return path;
}

/**
 * Find the critical path (longest dependency chain) in the graph.
 * Uses dynamic programming on the DAG to find the longest path.
 * Excludes done WUs from the path.
 */
export function criticalPath(graph: DependencyGraph): CriticalPathResult {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return { path: [], length: 0 };
  }

  const topoResult = topologicalSort(graph);

  if (topoResult.hasCycle) {
    return {
      path: [],
      length: 0,
      warning: topoResult.warning,
      cycleNodes: topoResult.cycleNodes,
    };
  }

  const { distance, predecessor } = calculateDistances(activeGraph, topoResult.order);

  let maxDistance = 0;
  let endNode: string | null = null;
  for (const [id, dist] of distance.entries()) {
    if (dist > maxDistance) {
      maxDistance = dist;
      endNode = id;
    }
  }

  const path = reconstructPath(predecessor, endNode);

  return {
    path,
    length: path.length,
  };
}

/**
 * Calculate the impact score for a WU.
 * Impact score is the count of all downstream dependents (recursive).
 * Excludes done WUs from the count.
 */
export function impactScore(graph: DependencyGraph, wuId: string): number {
  const activeGraph = filterActiveGraph(graph);

  if (!activeGraph.has(wuId)) {
    return 0;
  }

  const visited = new Set<string>();
  const queue: string[] = [wuId];
  visited.add(wuId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const node = activeGraph.get(current);
    if (!node) continue;

    for (const depId of node.blocks) {
      if (!visited.has(depId) && activeGraph.has(depId)) {
        visited.add(depId);
        queue.push(depId);
      }
    }
  }

  return visited.size - 1;
}

/**
 * Find the top N bottleneck WUs by impact score.
 * A bottleneck is a WU that blocks many other WUs.
 * Excludes done WUs from results.
 */
export function analyzeBottlenecks(
  graph: DependencyGraph,
  limit: number
): BottleneckResult[] {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return [];
  }

  const scores: BottleneckResult[] = [];
  for (const [id, node] of activeGraph.entries()) {
    const score = impactScore(graph, id);
    scores.push({
      id,
      score,
      title: node.title,
    });
  }

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, limit);
}

/**
 * Get complete bottleneck analysis including critical path
 */
export function getBottleneckAnalysis(
  graph: DependencyGraph,
  limit: number = 10
): BottleneckAnalysis {
  return {
    bottlenecks: analyzeBottlenecks(graph, limit),
    criticalPath: criticalPath(graph),
  };
}
