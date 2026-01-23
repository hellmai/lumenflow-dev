/**
 * Spawn Tree Builder (WU-1950)
 *
 * Builds and formats spawn trees for visualization.
 * Used by spawn:list command to display parent-child relationships.
 *
 * Note: Domain-specific tree visualization for spawn registry.
 * Integrates with spawn-registry-store and spawn-registry-schema.
 * No external tree library needed - logic is tightly coupled to spawn data model.
 *
 * @see {@link tools/__tests__/spawn-list.test.mjs} - Tests
 * @see {@link tools/spawn-list.mjs} - CLI command
 * @see {@link tools/lib/spawn-registry-store.mjs} - Data source
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { SpawnRegistryStore } from './spawn-registry-store.js';
import { SpawnStatus } from './spawn-registry-schema.js';
import { parse as parseYAML } from 'yaml';

/**
 * Status indicators for terminal output.
 * Using unicode symbols for clear visual distinction.
 */
export const STATUS_INDICATORS = Object.freeze({
  [SpawnStatus.PENDING]: '\u25CB', // ○ (white circle)
  [SpawnStatus.COMPLETED]: '\u2713', // ✓ (check mark)
  [SpawnStatus.TIMEOUT]: '\u23F1', // ⏱ (stopwatch)
  [SpawnStatus.CRASHED]: '\u2717', // ✗ (x mark)
});

/**
 * Tree node structure
 * @typedef {object} SpawnTreeNode
 * @property {string} wuId - WU ID for this node
 * @property {string|null} spawnId - Spawn ID (null for root)
 * @property {string|null} status - Spawn status (null for root)
 * @property {string|null} lane - Lane (null for root)
 * @property {string|null} spawnedAt - Spawn timestamp (null for root)
 * @property {SpawnTreeNode[]} children - Child nodes
 */

/**
 * Builds a spawn tree from flat spawn events.
 *
 * @param {import('./spawn-registry-schema.js').SpawnEvent[]} spawns - Array of spawn events
 * @param {string} rootWuId - Root WU ID to build tree from
 * @returns {SpawnTreeNode} Tree rooted at rootWuId
 *
 * @example
 * const tree = buildSpawnTree(spawns, 'WU-1000');
 * // { wuId: 'WU-1000', children: [{ wuId: 'WU-1001', ... }] }
 */
export function buildSpawnTree(spawns, rootWuId) {
  // Create root node
  /** @type {SpawnTreeNode} */
  const root = {
    wuId: rootWuId,
    spawnId: null,
    status: null,
    lane: null,
    spawnedAt: null,
    children: [],
  };

  if (spawns.length === 0) {
    return root;
  }

  // Build index of spawns by parent WU ID for efficient lookup
  /** @type {Map<string, import('./spawn-registry-schema.js').SpawnEvent[]>} */
  const spawnsByParent = new Map();
  for (const spawn of spawns) {
    const existing = spawnsByParent.get(spawn.parentWuId) ?? [];
    existing.push(spawn);
    spawnsByParent.set(spawn.parentWuId, existing);
  }

  // Recursive function to build tree
  /**
   * @param {string} parentWuId
   * @returns {SpawnTreeNode[]}
   */
  function buildChildren(parentWuId) {
    const childSpawns = spawnsByParent.get(parentWuId) ?? [];
    return childSpawns.map((spawn) => ({
      wuId: spawn.targetWuId,
      spawnId: spawn.id,
      status: spawn.status,
      lane: spawn.lane,
      spawnedAt: spawn.spawnedAt,
      children: buildChildren(spawn.targetWuId),
    }));
  }

  root.children = buildChildren(rootWuId);
  return root;
}

/**
 * Tree branch characters for formatting
 */
const TREE_CHARS = Object.freeze({
  VERTICAL: '\u2502', // │
  BRANCH: '\u251C', // ├
  LAST_BRANCH: '\u2514', // └
  HORIZONTAL: '\u2500', // ─
  SPACE: ' ',
});

/**
 * Formats a spawn tree for terminal display with indentation and tree characters.
 *
 * @param {SpawnTreeNode} tree - Tree to format
 * @returns {string} Formatted tree string
 *
 * @example
 * const formatted = formatSpawnTree(tree);
 * // WU-1000 (root)
 * // ├── ○ WU-1001 [spawn-1111] (Operations: Tooling)
 * // │   └── ✓ WU-1002 [spawn-2222] (Core: Backend)
 * // └── ○ WU-1003 [spawn-3333] (Experience: Web)
 */
export function formatSpawnTree(tree) {
  const lines = [];

  // Root line
  lines.push(`${tree.wuId} (root)`);

  if (tree.children.length === 0) {
    lines.push(`  (no spawns)`);
    return lines.join('\n');
  }

  // Recursive formatting
  /**
   * @param {SpawnTreeNode[]} children
   * @param {string} prefix - Indentation prefix for this level
   */
  function formatChildren(children, prefix) {
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const branch = isLast
        ? `${TREE_CHARS.LAST_BRANCH}${TREE_CHARS.HORIZONTAL}${TREE_CHARS.HORIZONTAL}`
        : `${TREE_CHARS.BRANCH}${TREE_CHARS.HORIZONTAL}${TREE_CHARS.HORIZONTAL}`;

      const indicator = STATUS_INDICATORS[child.status] ?? '?';
      const spawnInfo = child.spawnId ? ` [${child.spawnId}]` : '';
      const laneInfo = child.lane ? ` (${child.lane})` : '';

      lines.push(`${prefix}${branch} ${indicator} ${child.wuId}${spawnInfo}${laneInfo}`);

      // Child prefix: use vertical bar if not last, space if last
      const childPrefix = prefix + (isLast ? '    ' : `${TREE_CHARS.VERTICAL}   `);
      formatChildren(child.children, childPrefix);
    });
  }

  formatChildren(tree.children, '');
  return lines.join('\n');
}

/**
 * Gets all spawns for a WU (both where WU is parent and descendants).
 *
 * Returns all spawns needed to build the full tree from this WU.
 *
 * @param {string} wuId - WU ID to get spawns for
 * @param {string} baseDir - Directory containing spawn-registry.jsonl
 * @returns {Promise<import('./spawn-registry-schema.js').SpawnEvent[]>} Array of spawn events
 *
 * @example
 * const spawns = await getSpawnsByWU('WU-1000', '.lumenflow/state');
 */
export async function getSpawnsByWU(wuId, baseDir) {
  const store = new SpawnRegistryStore(baseDir);

  try {
    await store.load();
  } catch (error) {
    // Registry doesn't exist or is invalid
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  // Get all spawns
  const allSpawns = store.getAllSpawns();

  if (allSpawns.length === 0) {
    return [];
  }

  // Find all spawns in the tree rooted at wuId
  // Start with direct children of wuId
  const result = [];
  const visited = new Set();
  const queue = [wuId];

  while (queue.length > 0) {
    const currentWuId = queue.shift();
    if (visited.has(currentWuId)) continue;
    visited.add(currentWuId);

    // Find spawns where current WU is the parent
    const childSpawns = store.getByParent(currentWuId);
    for (const spawn of childSpawns) {
      if (!result.some((s) => s.id === spawn.id)) {
        result.push(spawn);
        queue.push(spawn.targetWuId);
      }
    }
  }

  return result;
}

/**
 * Gets all spawns for an initiative.
 *
 * Reads WU YAML files to find which WUs belong to the initiative,
 * then returns all spawns where parent or target WU belongs to initiative.
 *
 * @param {string} initiativeId - Initiative ID (e.g., 'INIT-001')
 * @param {string} registryDir - Directory containing spawn-registry.jsonl
 * @param {string} wuDir - Directory containing WU YAML files
 * @returns {Promise<import('./spawn-registry-schema.js').SpawnEvent[]>} Array of spawn events
 *
 * @example
 * const spawns = await getSpawnsByInitiative('INIT-001', '.lumenflow/state', 'docs/04-operations/tasks/wu');
 */
export async function getSpawnsByInitiative(initiativeId, registryDir, wuDir) {
  // Get all WUs belonging to initiative
  const initiativeWuIds = await getWUsForInitiative(initiativeId, wuDir);

  if (initiativeWuIds.size === 0) {
    return [];
  }

  // Load spawn registry
  const store = new SpawnRegistryStore(registryDir);

  try {
    await store.load();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  // Filter spawns where parent belongs to initiative
  const allSpawns = store.getAllSpawns();
  return allSpawns.filter((spawn) => initiativeWuIds.has(spawn.parentWuId));
}

/**
 * Reads WU YAML files to find WUs belonging to an initiative.
 *
 * @param {string} initiativeId - Initiative ID
 * @param {string} wuDir - Directory containing WU YAML files
 * @returns {Promise<Set<string>>} Set of WU IDs belonging to initiative
 */
async function getWUsForInitiative(initiativeId, wuDir) {
  const wuIds = new Set();

  let files;
  try {
    files = await fs.readdir(wuDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return wuIds;
    }
    throw error;
  }

  const wuFiles = files.filter((f) => f.startsWith('WU-') && f.endsWith('.yaml'));

  for (const file of wuFiles) {
    try {
      const content = await fs.readFile(path.join(wuDir, file), 'utf-8');
      const doc = parseYAML(content);

      if (doc.initiative === initiativeId) {
        wuIds.add(doc.id);
      }
    } catch {
      // Skip files that can't be parsed
      continue;
    }
  }

  return wuIds;
}

/**
 * Converts a spawn tree to JSON format.
 *
 * @param {SpawnTreeNode} tree - Tree to convert
 * @returns {object} JSON-serializable tree
 *
 * @example
 * const json = treeToJSON(tree);
 * console.log(JSON.stringify(json, null, 2));
 */
export function treeToJSON(tree) {
  return {
    wuId: tree.wuId,
    spawnId: tree.spawnId,
    status: tree.status,
    lane: tree.lane,
    spawnedAt: tree.spawnedAt,
    children: tree.children.map((child) => treeToJSON(child)),
  };
}
