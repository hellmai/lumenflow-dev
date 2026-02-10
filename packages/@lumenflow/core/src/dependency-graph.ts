import { existsSync, readdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { readWU, readWUAsync } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import { STRING_LITERALS, WU_STATUS } from './wu-constants.js';
import { detectCycles } from './cycle-detector.js';

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
export function buildDependencyGraph() {
  const wuDir = path.dirname(WU_PATHS.WU('dummy'));
  const graph = new Map();

  if (!existsSync(wuDir)) {
    return graph;
  }

  const files = readdirSync(wuDir).filter((f) => f.endsWith('.yaml') && f.startsWith('WU-'));

  for (const f of files) {
    const filePath = path.join(wuDir, f);
    const id = f.replace('.yaml', '');

    try {
      const doc = readWU(filePath, id);
      graph.set(id, {
        id,
        title: doc.title || id,
        status: doc.status || 'unknown',
        blocks: Array.isArray(doc.blocks) ? doc.blocks : [],
        blockedBy: Array.isArray(doc.blocked_by) ? doc.blocked_by : [],
      });
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
export async function buildDependencyGraphAsync() {
  const wuDir = path.dirname(WU_PATHS.WU('dummy'));
  const graph = new Map();

  try {
    const files = await fs.readdir(wuDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') && f.startsWith('WU-'));

    const promises = yamlFiles.map(async (f) => {
      const filePath = path.join(wuDir, f);
      const id = f.replace('.yaml', '');

      try {
        const doc = await readWUAsync(filePath, id);
        return {
          id,
          title: doc.title || id,
          status: doc.status || 'unknown',
          blocks: Array.isArray(doc.blocks) ? doc.blocks : [],
          blockedBy: Array.isArray(doc.blocked_by) ? doc.blocked_by : [],
        };
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
export function getUpstreamDependencies(graph, wuId, maxDepth = 10) {
  const visited = new Set();
  const result = [];

  function traverse(id, depth, pathSoFar) {
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
export function getDownstreamDependents(graph, wuId, maxDepth = 10) {
  const visited = new Set();
  const result = [];

  function traverse(id, depth, pathSoFar) {
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
export function renderASCII(graph, rootId, options: RenderASCIIOptions = {}) {
  const { direction = 'both', depth: maxDepth = 3 } = options;
  const lines = [];
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
  const cycleResult = detectCycles(graph);
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
export function renderMermaid(graph, options: RenderMermaidOptions = {}) {
  const { rootId, direction = 'TD', depth: maxDepth = 3 } = options;
  const lines = [];
  const nodes = new Set();
  const edges = [];

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
  const statusGroups = { done: [], in_progress: [], ready: [], blocked: [] };
  for (const nodeId of nodes) {
    const node = graph.get(nodeId);
    if (node && statusGroups[node.status]) {
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
export function validateGraph(graph) {
  const allIds = new Set(graph.keys());
  const orphans = [];

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
  const snakeCaseGraph = new Map();
  for (const [id, node] of graph.entries()) {
    snakeCaseGraph.set(id, {
      id: node.id,
      blocked_by: node.blockedBy || [],
      blocks: node.blocks || [],
    });
  }

  // Check for cycles
  const cycleResult = detectCycles(snakeCaseGraph);

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
function filterActiveGraph(graph) {
  const activeGraph = new Map();
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
function _areDependenciesSatisfied(activeGraph, fullGraph, node) {
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
export function topologicalSort(graph) {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return [];
  }

  // Build in-degree map (count of unsatisfied dependencies)
  const inDegree = new Map();
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
  const queue = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted = [];

  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);

    const node = activeGraph.get(current);
    if (!node) continue;

    // Decrease in-degree of dependents
    for (const depId of node.blocks) {
      if (!activeGraph.has(depId)) continue;

      const newDegree = inDegree.get(depId) - 1;
      inDegree.set(depId, newDegree);

      if (newDegree === 0) {
        queue.push(depId);
      }
    }
  }

  // Check for cycles (not all nodes processed)
  if (sorted.length < activeGraph.size) {
    const cycleNodes = [];
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
export function criticalPath(graph) {
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
  const distance = new Map();
  const predecessor = new Map();

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

      const newDistance = distance.get(current) + 1;
      if (newDistance > distance.get(depId)) {
        distance.set(depId, newDistance);
        predecessor.set(depId, current);
      }
    }
  }

  // Find the node with maximum distance
  let maxDistance = 0;
  let endNode = null;
  for (const [id, dist] of distance.entries()) {
    if (dist > maxDistance) {
      maxDistance = dist;
      endNode = id;
    }
  }

  // Reconstruct path
  const path = [];
  let current = endNode;
  while (current !== null) {
    path.unshift(current);
    current = predecessor.get(current);
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
export function impactScore(graph, wuId) {
  const activeGraph = filterActiveGraph(graph);

  if (!activeGraph.has(wuId)) {
    return 0;
  }

  // BFS to count all downstream dependents
  const visited = new Set();
  const queue = [wuId];
  visited.add(wuId);

  while (queue.length > 0) {
    const current = queue.shift();
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
export function bottlenecks(graph, limit) {
  const activeGraph = filterActiveGraph(graph);

  if (activeGraph.size === 0) {
    return [];
  }

  // Calculate impact score for each active WU
  const scores = [];
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
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? `${str.substring(0, maxLen - 3)}...` : str;
}
