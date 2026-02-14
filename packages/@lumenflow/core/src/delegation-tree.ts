/**
 * Delegation Tree Builder (WU-1674)
 *
 * Builds and formats delegation trees for visualization.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYAML } from 'yaml';
import { DelegationRegistryStore } from './delegation-registry-store.js';
import { DelegationStatus } from './delegation-registry-schema.js';

interface RegistryRecord {
  id: string;
  parentWuId: string;
  targetWuId: string;
  lane: string;
  status: string;
  delegatedAt: string;
  completedAt: string | null;
  pickedUpAt?: string;
  pickedUpBy?: string;
}

interface DelegationRecord {
  id: string;
  parentWuId: string;
  targetWuId: string;
  lane: string;
  status: string;
  delegatedAt: string;
  completedAt: string | null;
  pickedUpAt?: string;
  pickedUpBy?: string;
}

interface DelegationTreeNode {
  wuId: string;
  delegationId: string | null;
  status: string | null;
  lane: string | null;
  delegatedAt: string | null;
  children: DelegationTreeNode[];
}

/**
 * Status indicators for terminal output.
 */
export const STATUS_INDICATORS = Object.freeze({
  [DelegationStatus.PENDING]: '\u25CB', // ○
  [DelegationStatus.COMPLETED]: '\u2713', // ✓
  [DelegationStatus.TIMEOUT]: '\u23F1', // ⏱
  [DelegationStatus.CRASHED]: '\u2717', // ✗
  [DelegationStatus.ESCALATED]: '!',
});

const TREE_CHARS = Object.freeze({
  VERTICAL: '\u2502',
  BRANCH: '\u251C',
  LAST_BRANCH: '\u2514',
  HORIZONTAL: '\u2500',
});

function toDelegationRecord(record: RegistryRecord): DelegationRecord {
  return {
    id: record.id,
    parentWuId: record.parentWuId,
    targetWuId: record.targetWuId,
    lane: record.lane,
    status: record.status,
    delegatedAt: record.delegatedAt,
    completedAt: record.completedAt,
    pickedUpAt: record.pickedUpAt,
    pickedUpBy: record.pickedUpBy,
  };
}

/**
 * Builds a delegation tree from flat delegation events.
 */
export function buildDelegationTree(
  delegations: DelegationRecord[],
  rootWuId: string,
): DelegationTreeNode {
  const root: DelegationTreeNode = {
    wuId: rootWuId,
    delegationId: null,
    status: null,
    lane: null,
    delegatedAt: null,
    children: [],
  };

  if (delegations.length === 0) {
    return root;
  }

  const delegationsByParent = new Map<string, DelegationRecord[]>();
  for (const delegation of delegations) {
    const existing = delegationsByParent.get(delegation.parentWuId) ?? [];
    existing.push(delegation);
    delegationsByParent.set(delegation.parentWuId, existing);
  }

  const buildChildren = (parentWuId: string): DelegationTreeNode[] => {
    const childDelegations = delegationsByParent.get(parentWuId) ?? [];
    return childDelegations.map((delegation) => ({
      wuId: delegation.targetWuId,
      delegationId: delegation.id,
      status: delegation.status,
      lane: delegation.lane,
      delegatedAt: delegation.delegatedAt,
      children: buildChildren(delegation.targetWuId),
    }));
  };

  root.children = buildChildren(rootWuId);
  return root;
}

/**
 * Formats a delegation tree for terminal display.
 */
export function formatDelegationTree(tree: DelegationTreeNode): string {
  const lines: string[] = [];
  lines.push(`${tree.wuId} (root)`);

  if (tree.children.length === 0) {
    lines.push('  (no delegations)');
    return lines.join('\n');
  }

  const formatChildren = (children: DelegationTreeNode[], prefix: string): void => {
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const branch = isLast
        ? `${TREE_CHARS.LAST_BRANCH}${TREE_CHARS.HORIZONTAL}${TREE_CHARS.HORIZONTAL}`
        : `${TREE_CHARS.BRANCH}${TREE_CHARS.HORIZONTAL}${TREE_CHARS.HORIZONTAL}`;
      const indicator = child.status ? (STATUS_INDICATORS[child.status] ?? '?') : '?';
      const delegationInfo = child.delegationId ? ` [${child.delegationId}]` : '';
      const laneInfo = child.lane ? ` (${child.lane})` : '';

      lines.push(`${prefix}${branch} ${indicator} ${child.wuId}${delegationInfo}${laneInfo}`);

      const childPrefix = prefix + (isLast ? '    ' : `${TREE_CHARS.VERTICAL}   `);
      formatChildren(child.children, childPrefix);
    });
  };

  formatChildren(tree.children, '');
  return lines.join('\n');
}

/**
 * Gets all delegations for a WU (direct + descendants).
 */
export async function getDelegationsByWU(
  wuId: string,
  baseDir: string,
): Promise<DelegationRecord[]> {
  const store = new DelegationRegistryStore(baseDir);

  try {
    await store.load();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const allRecords = store.getAllDelegations();
  if (allRecords.length === 0) {
    return [];
  }

  const result: DelegationRecord[] = [];
  const seenDelegationIds = new Set<string>();
  const visitedWuIds = new Set<string>();
  const queue = [wuId];

  while (queue.length > 0) {
    const currentWuId = queue.shift();
    if (!currentWuId || visitedWuIds.has(currentWuId)) {
      continue;
    }

    visitedWuIds.add(currentWuId);
    const childRecords = store.getByParent(currentWuId) as RegistryRecord[];
    for (const child of childRecords) {
      if (!seenDelegationIds.has(child.id)) {
        result.push(toDelegationRecord(child));
        seenDelegationIds.add(child.id);
      }
      queue.push(child.targetWuId);
    }
  }

  return result;
}

/**
 * Gets all delegations for an initiative.
 */
export async function getDelegationsByInitiative(
  initiativeId: string,
  registryDir: string,
  wuDir: string,
): Promise<DelegationRecord[]> {
  const initiativeWuIds = await getWUsForInitiative(initiativeId, wuDir);
  if (initiativeWuIds.size === 0) {
    return [];
  }

  const store = new DelegationRegistryStore(registryDir);
  try {
    await store.load();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return (store.getAllDelegations() as RegistryRecord[])
    .filter((record) => initiativeWuIds.has(record.parentWuId))
    .map(toDelegationRecord);
}

async function getWUsForInitiative(initiativeId: string, wuDir: string): Promise<Set<string>> {
  const wuIds = new Set<string>();
  let files: string[] = [];

  try {
    files = await fs.readdir(wuDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return wuIds;
    }
    throw error;
  }

  const wuFiles = files.filter((file) => file.startsWith('WU-') && file.endsWith('.yaml'));
  for (const file of wuFiles) {
    try {
      const content = await fs.readFile(path.join(wuDir, file), 'utf-8');
      const doc = parseYAML(content) as { initiative?: string; id?: string };
      if (doc.initiative === initiativeId && typeof doc.id === 'string') {
        wuIds.add(doc.id);
      }
    } catch {
      continue;
    }
  }

  return wuIds;
}

/**
 * Converts a delegation tree to JSON.
 */
export function treeToJSON(tree: DelegationTreeNode) {
  return {
    wuId: tree.wuId,
    delegationId: tree.delegationId,
    status: tree.status,
    lane: tree.lane,
    delegatedAt: tree.delegatedAt,
    children: tree.children.map((child) => treeToJSON(child)),
  };
}
