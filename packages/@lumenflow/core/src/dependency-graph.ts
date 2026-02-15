import { existsSync, readdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { readWU, readWUAsync } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import { STRING_LITERALS, WU_STATUS } from './wu-constants.js';
import { detectCycles, type WUObject } from './cycle-detector.js';

export interface DependencyNode {
  id: string;
  title: string;
  status: string;
  blocks: string[];
  blockedBy: string[];
}

type WUDoc = {
  title?: string;
  status?: string;
  blocks?: unknown;
  blocked_by?: unknown;
};

export type DependencyGraph = Map<string, DependencyNode>;

interface DependencyTraversalEntry {
  id: string;
  depth: number;
  path: string[];
}

interface MermaidEdge {
  from: string;
  to: string;
}

type GraphStatus = 'done' | 'in_progress' | 'ready' | 'blocked';

interface TopologicalSortCycleWarning {
  order: string[];
  warning: string;
  cycleNodes: string[];
}

interface CriticalPathResult {
  path: string[];
  length: number;
  warning?: string;
}

interface BottleneckScore {
  id: string;
  score: number;
  title?: string;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toDependencyNode(id: string, doc: WUDoc): DependencyNode {
  return {
    id,
    title: typeof doc.title === 'string' ? doc.title : id,
    status: typeof doc.status === 'string' ? doc.status : 'unknown',
    blocks: toStringArray(doc.blocks),
    blockedBy: toStringArray(doc.blocked_by),
  };
}

function isGraphStatus(status: string): status is GraphStatus {
  return (
    status === 'done' || status === 'in_progress' || status === 'ready' || status === 'blocked'
  );
}

function toCycleDetectorGraph(graph: DependencyGraph): Map<string, WUObject> {
  const normalized = new Map<string, WUObject>();
  for (const [id, node] of graph.entries()) {
    normalized.set(id, {
      id: node.id,
      blocks: node.blocks,
      blocked_by: node.blockedBy,
    });
  }
  return normalized;
}

/**
 * Dependency Graph Module (WU-1247, WU-1568)
 *
 * Provides graph building, visualization, and analysis for WU dependencies.
 * Supports ASCII tree and Mermaid diagram output formats.
 * Includes graph algorithms for operational insights: topological sort,
 * critical path, impact scoring, and bottleneck detection.
 *
 * @example
 * import { buildDependencyGraph, renderASCII, renderMermaid, topologicalSort, criticalPath, bottlenecks } from './lib/dependency-graph.js';
 *
 * const graph = buildDependencyGraph();
 * console.log(renderASCII(graph, 'WU-1247'));
 * console.log(renderMermaid(graph, { direction: 'TD' }));
 *
 * // Graph analysis (WU-1568)
 * const sorted = topologicalSort(graph);
 * const critical = criticalPath(graph);
 * const topBottlenecks = bottlenecks(graph, 10);
 */

/**
 * Build a dependency graph from all WU YAML files.
 *
 * @returns {Map<string, {id: string, title: string, status: string, blocks: string[], blockedBy: string[]}>}
 */
export function buildDependencyGraph(): DependencyGraph {
  const wuDir = path.dirname(WU_PATHS.WU('dummy'));
  const graph: DependencyGraph = new Map();

  if (!existsSync(wuDir)) {
    return graph;
  }

  const files = readdirSync(wuDir).filter(
    (f: string) => f.endsWith('.yaml') && f.startsWith('WU-'),
  );

  for (const f of files) {
    const filePath = path.join(wuDir, f);
    const id = f.replace('.yaml', '');

    try {
      const doc = readWU(filePath, id) as WUDoc;
      graph.set(id, toDependencyNode(id, doc));
    } catch {
      // Skip invalid files
    }
  }

  return graph;
}

/**
 * Build a dependency graph from all WU YAML files asynchronously.
 *
 * @returns {Promise<Map<string, {id: string, title: string, status: string, blocks: string[], blockedBy: string[]}>>}
 */
export async function buildDependencyGraphAsync(): Promise<DependencyGraph> {
  const wuDir = path.dirname(WU_PATHS.WU('dummy'));
  const graph: DependencyGraph = new Map();

  try {
    const files = await fs.readdir(wuDir);
    const yamlFiles = files.filter((f: string) => f.endsWith('.yaml') && f.startsWith('WU-'));

    const promises = yamlFiles.map(async (f: string): Promise<DependencyNode | null> => {
      const filePath = path.join(wuDir, f);
      const id = f.replace('.yaml', '');

      try {
        const doc = (await readWUAsync(filePath, id)) as WUDoc;
        return toDependencyNode(id, doc);
      } catch {
        // Skip invalid files
        return null;
      }
    });

    const results = await Promise.all(promises);

    for (const result of results) {
      if (result) {
        graph.set(result.id, result);
      }
    }
  } catch {
    // Return empty graph if dir doesn't exist or other error
  }

  return graph;
}

/**
 * Get all dependencies (upstream: blocked_by) for a WU.
 *
 * @param {Map} graph - Dependency graph
 * @param {string} wuId - WU ID to get dependencies for
 * @param {number} [maxDepth=10] - Maximum traversal depth
 * @returns {Array<{id: string, depth: number, path: string[]}>}
 */
export function getUpstreamDependencies(
  graph: DependencyGraph,
  wuId: string,
  maxDepth = 10,
): DependencyTraversalEntry[] {
  const visited = new Set<string>();
  const result: DependencyTraversalEntry[] = [];

  function traverse(id: string, depth: number, pathSoFar: string[]): void {
    if (depth > maxDepth || visited.has(id)) return;
    visited.add(id);

    const node = graph.get(id);
    if (!node) return;

    for (const dep of node.blockedBy) {
      if (!visited.has(dep)) {
        result.push({ id: dep, depth, path: [...pathSoFar, dep] });
        traverse(dep, depth + 1, [...pathSoFar, dep]);
      }
    }
  }

  traverse(wuId, 1, [wuId]);
  return result;
}

/**
 * Get all dependents (downstream: blocks) for a WU.
 *
 * @param {Map} graph - Dependency graph
 * @param {string} wuId - WU ID to get dependents for
 * @param {number} [maxDepth=10] - Maximum traversal depth
 * @returns {Array<{id: string, depth: number, path: string[]}>}
 */
export function getDownstreamDependents(
  graph: DependencyGraph,
  wuId: string,
  maxDepth = 10,
): DependencyTraversalEntry[] {
  const visited = new Set<string>();
  const result: DependencyTraversalEntry[] = [];

  function traverse(id: string, depth: number, pathSoFar: string[]): void {
    if (depth > maxDepth || visited.has(id)) return;
    visited.add(id);

    const node = graph.get(id);
    if (!node) return;

    for (const dep of node.blocks) {
      if (!visited.has(dep)) {
        result.push({ id: dep, depth, path: [...pathSoFar, dep] });
        traverse(dep, depth + 1, [...pathSoFar, dep]);
      }
    }
  }

  traverse(wuId, 1, [wuId]);
  return result;
}

/**
 * Options for rendering ASCII tree
 */
export interface RenderASCIIOptions {
  /** Direction to traverse: 'up', 'down', or 'both' */
  direction?: 'up' | 'down' | 'both';
  /** Maximum depth to traverse */
  depth?: number;
}

/**
 * Render dependency graph as ASCII tree.
 *
 * @param {Map} graph - Dependency graph
 * @param {string} rootId - Root WU ID
 * @param {RenderASCIIOptions} [options] - Render options
 * @returns {string} ASCII tree representation
 */
export function renderASCII(
  graph: DependencyGraph,
  rootId: string,
  options: RenderASCIIOptions = {},
): string {
  const { direction = 'both', depth: maxDepth = 3 } = options;
  const lines: string[] = [];
  const root = graph.get(rootId);

  if (!root) {
    return `WU not found: ${rootId}`;
  }

  // Header
  lines.push(`${rootId}: ${truncate(root.title, 50)}`);
  lines.push('');

  // Upstream (blocked_by)
  if (direction === 'up' || direction === 'both') {
    const upstream = getUpstreamDependencies(graph, rootId, maxDepth);
    if (upstream.length > 0) {
      lines.push('Dependencies (blocked by):');
      for (const dep of upstream) {
        const node = graph.get(dep.id);
        const status = node ? `[${node.status}]` : '[unknown]';
        const title = node ? truncate(node.title, 40) : '';
        const indent = '  '.repeat(dep.depth);
        lines.push(`${indent}+-- ${dep.id}: ${title} ${status}`);
      }
      lines.push('');
    }
  }

  // Downstream (blocks)
  if (direction === 'down' || direction === 'both') {
    const downstream = getDownstreamDependents(graph, rootId, maxDepth);
    if (downstream.length > 0) {
      lines.push('Dependents (blocks):');
      for (const dep of downstream) {
        const node = graph.get(dep.id);
        const status = node ? `[${node.status}]` : '[unknown]';
        const title = node ? truncate(node.title, 40) : '';
        const indent = '  '.repeat(dep.depth);
        lines.push(`${indent}+-- ${dep.id}: ${title} ${status}`);
      }
      lines.push('');
    }
  }

  // Check for cycles
  const cycleResult = detectCycles(toCycleDetectorGraph(graph));
  if (cycleResult.hasCycle) {
    lines.push('⚠️  Circular dependencies detected:');
    for (const cycle of cycleResult.cycles) {
      lines.push(`  ${cycle.join(' → ')}`);
    }
    lines.push('');
  }

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * Options for rendering Mermaid diagram
 */
export interface RenderMermaidOptions {
  /** Optional root WU ID to focus on */
  rootId?: string;
  /** Diagram direction: 'TD', 'LR', 'BT', 'RL' */
  direction?: 'TD' | 'LR' | 'BT' | 'RL';
  /** Maximum depth from root */
  depth?: number;
}

/**
 * Render dependency graph as Mermaid diagram.
 *
 * @param {Map} graph - Dependency graph
 * @param {RenderMermaidOptions} [options] - Render options
 * @returns {string} Mermaid diagram syntax
 */
export function renderMermaid(graph: DependencyGraph, options: RenderMermaidOptions = {}): string {
  const { rootId, direction = 'TD', depth: maxDepth = 3 } = options;
  const lines: string[] = [];
  const nodes = new Set<string>();
  const edges: MermaidEdge[] = [];

  // Collect nodes and edges
  if (rootId) {
    // Focus on specific WU
    const upstream = getUpstreamDependencies(graph, rootId, maxDepth);
    const downstream = getDownstreamDependents(graph, rootId, maxDepth);

    nodes.add(rootId);
    for (const dep of upstream) {
      nodes.add(dep.id);
    }
    for (const dep of downstream) {
      nodes.add(dep.id);
    }

    // Build edges for focused view
    for (const nodeId of nodes) {
      const node = graph.get(nodeId);
      if (!node) continue;

      for (const blockedBy of node.blockedBy) {
        if (nodes.has(blockedBy)) {
          edges.push({ from: blockedBy, to: nodeId });
        }
      }
    }
  } else {
    // Full graph
    for (const [nodeId, node] of graph.entries()) {
      nodes.add(nodeId);
      for (const blockedBy of node.blockedBy) {
        if (graph.has(blockedBy)) {
          edges.push({ from: blockedBy, to: nodeId });
        }
      }
    }
  }

  // Generate Mermaid
  lines.push(`flowchart ${direction}`);

  // Node definitions with labels
  for (const nodeId of nodes) {
    const node = graph.get(nodeId);
    if (node) {
      const shortTitle = truncate(node.title, 30);
      lines.push(`    ${nodeId}["${nodeId}: ${shortTitle}<br/>${node.status}"]`);
    }
  }

  lines.push('');

  // Edges
  for (const { from, to } of edges) {
    lines.push(`    ${from} --> ${to}`);
  }

  lines.push('');

  // Status styling
  lines.push('    classDef done fill:#86efac,stroke:#22c55e');
  lines.push('    classDef in_progress fill:#93c5fd,stroke:#3b82f6');
  lines.push('    classDef ready fill:#fde68a,stroke:#f59e0b');
  lines.push('    classDef blocked fill:#fca5a5,stroke:#ef4444');

  // Apply classes
  const statusGroups: Record<GraphStatus, string[]> = {
    done: [],
    in_progress: [],
    ready: [],
    blocked: [],
  };
  for (const nodeId of nodes) {
    const node = graph.get(nodeId);
    if (node && isGraphStatus(node.status)) {
      statusGroups[node.status].push(nodeId);
    }
  }

  for (const [status, nodeIds] of Object.entries(statusGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`    class ${nodeIds.join(',')} ${status}`);
    }
  }

  return lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * Validate dependency graph for cycles and orphans.
 *
 * @param {Map} graph - Dependency graph
 * @returns {{hasCycle: boolean, cycles: string[][], orphans: Array<{wuId: string, ref: string}>}}
 */
export function validateGraph(graph: DependencyGraph): {
  hasCycle: boolean;
  cycles: string[][];
  orphans: Array<{ wuId: string; ref: string }>;
} {
  const allIds = new Set(graph.keys());
  const orphans: Array<{ wuId: string; ref: string }> = [];

  // Check for orphan references
  for (const [wuId, node] of graph.entries()) {
    for (const ref of [...node.blocks, ...node.blockedBy]) {
      if (!allIds.has(ref)) {
        orphans.push({ wuId, ref });
      }
    }
  }

  // Transform graph to snake_case for detectCycles compatibility
  // (dependency-graph uses camelCase internally, initiative-validator uses snake_case)
  const cycleResult = detectCycles(toCycleDetectorGraph(graph));

  return {
    hasCycle: cycleResult.hasCycle,
    cycles: cycleResult.cycles,
    orphans,
  };
}

// =============================================================================
// Graph Analysis Functions (WU-1568)
// =============================================================================

/**
 * Filter graph to active (non-done) WUs only.
 *
 * @param {Map} graph - Full dependency graph
 * @returns {Map} Graph containing only non-done WUs
 */
function filterActiveGraph(graph: DependencyGraph): DependencyGraph {
  const activeGraph: DependencyGraph = new Map();
  for (const [id, node] of graph.entries()) {
    if (node.status !== WU_STATUS.DONE) {
      activeGraph.set(id, node);
    }
  }
  return activeGraph;
}

/**
 * Check if a WU's dependencies are satisfied (done or not in active graph).
 *
 * @param {Map} activeGraph - Active subgraph
 * @param {Map} fullGraph - Full graph (includes done WUs)
 * @param {object} node - Node to check
 * @returns {boolean} True if all dependencies are satisfied
 */
function _areDependenciesSatisfied(
  activeGraph: DependencyGraph,
  fullGraph: DependencyGraph,
  node: DependencyNode,
): boolean {
  for (const depId of node.blockedBy) {
    // Dependency is satisfied if:
    // 1. It doesn't exist in the graph (orphan reference, treat as satisfied)
    // 2. It's done
    // 3. It's not in the active graph (already filtered out)
    const depNode = fullGraph.get(depId);
    if (depNode && depNode.status !== WU_STATUS.DONE && activeGraph.has(depId)) {
      return false;
    }
  }
  return true;
}

/**
 * Perform topological sort on non-done WUs using Kahn's algorithm.
 * Returns valid execution ordering where dependencies come before dependents.
 * Handles cycles gracefully by returning partial ordering with warning.
 *
 * @param {Map} graph - Dependency graph
 * @returns {string[]|{order: string[], warning: string, cycleNodes: string[]}} Sorted WU IDs or warning object
 */
export function topologicalSort(graph: DependencyGraph): string[] | TopologicalSortCycleWarning {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return [];
  }

  // Build in-degree map (count of unsatisfied dependencies)
  const inDegree = new Map<string, number>();
  for (const [id, node] of activeGraph.entries()) {
    // Count only dependencies that are in the active graph
    let count = 0;
    for (const depId of node.blockedBy) {
      if (activeGraph.has(depId)) {
        count++;
      }
    }
    inDegree.set(id, count);
  }

  // Start with nodes that have no active dependencies
  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    sorted.push(current);

    const node = activeGraph.get(current);
    if (!node) continue;

    // Decrease in-degree of dependents
    for (const depId of node.blocks) {
      if (!activeGraph.has(depId)) continue;

      const newDegree = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, newDegree);

      if (newDegree === 0) {
        queue.push(depId);
      }
    }
  }

  // Check for cycles (not all nodes processed)
  if (sorted.length < activeGraph.size) {
    const cycleNodes: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree > 0) {
        cycleNodes.push(id);
      }
    }

    return {
      order: sorted,
      warning: 'Cycle detected: some WUs have circular dependencies',
      cycleNodes,
    };
  }

  return sorted;
}

/**
 * Find the critical path (longest dependency chain) in the graph.
 * Uses dynamic programming on the DAG to find the longest path.
 * Excludes done WUs from the path.
 *
 * @param {Map} graph - Dependency graph
 * @returns {{path: string[], length: number, warning?: string}} Critical path info
 */
export function criticalPath(graph: DependencyGraph): CriticalPathResult {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return { path: [], length: 0 };
  }

  // First, get topological order
  const topoResult = topologicalSort(graph);

  // Handle cycle case
  if (!Array.isArray(topoResult)) {
    return {
      path: [],
      length: 0,
      warning: topoResult.warning,
    };
  }

  // Distance and predecessor maps for longest path
  const distance = new Map<string, number>();
  const predecessor = new Map<string, string | null>();

  // Initialise distances
  for (const id of topoResult) {
    distance.set(id, 1); // Each node has length 1
    predecessor.set(id, null);
  }

  // Process in topological order
  for (const current of topoResult) {
    const node = activeGraph.get(current);
    if (!node) continue;

    // Update distances for dependents
    for (const depId of node.blocks) {
      if (!activeGraph.has(depId)) continue;

      const newDistance = (distance.get(current) ?? 0) + 1;
      if (newDistance > (distance.get(depId) ?? 0)) {
        distance.set(depId, newDistance);
        predecessor.set(depId, current);
      }
    }
  }

  // Find the node with maximum distance
  let maxDistance = 0;
  let endNode: string | null = null;
  for (const [id, dist] of distance.entries()) {
    if (dist > maxDistance) {
      maxDistance = dist;
      endNode = id;
    }
  }

  // Reconstruct path
  const path: string[] = [];
  let current = endNode;
  while (current !== null) {
    path.unshift(current);
    current = predecessor.get(current) ?? null;
  }

  return {
    path,
    length: path.length,
  };
}

/**
 * Calculate the impact score for a WU.
 * Impact score is the count of all downstream dependents (recursive).
 * Excludes done WUs from the count.
 *
 * @param {Map} graph - Dependency graph
 * @param {string} wuId - WU ID to score
 * @returns {number} Count of downstream dependents
 */
export function impactScore(graph: DependencyGraph, wuId: string): number {
  const activeGraph = filterActiveGraph(graph);

  if (!activeGraph.has(wuId)) {
    return 0;
  }

  // BFS to count all downstream dependents
  const visited = new Set<string>();
  const queue: string[] = [wuId];
  visited.add(wuId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const node = activeGraph.get(current);
    if (!node) continue;

    for (const depId of node.blocks) {
      if (!visited.has(depId) && activeGraph.has(depId)) {
        visited.add(depId);
        queue.push(depId);
      }
    }
  }

  // Score is count minus 1 (exclude the starting node)
  return visited.size - 1;
}

/**
 * Find the top N bottleneck WUs by impact score.
 * A bottleneck is a WU that blocks many other WUs.
 * Excludes done WUs from results.
 *
 * @param {Map} graph - Dependency graph
 * @param {number} limit - Maximum number of bottlenecks to return
 * @returns {Array<{id: string, score: number, title?: string}>} Bottlenecks sorted by score descending
 */
export function bottlenecks(graph: DependencyGraph, limit: number): BottleneckScore[] {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return [];
  }

  // Calculate impact score for each active WU
  const scores: BottleneckScore[] = [];
  for (const [id, node] of activeGraph.entries()) {
    const score = impactScore(graph, id);
    scores.push({
      id,
      score,
      title: node.title,
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Return top N
  return scores.slice(0, limit);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Truncate string with ellipsis.
 *
 * @param {string} str - String to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? `${str.substring(0, maxLen - 3)}...` : str;
}
