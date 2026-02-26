// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU List Helper (WU-1411)
 *
 * Provides a consistent list of WUs by merging WUStateStore with YAML metadata.
 * MCP server and other tools can use this instead of duplicating listing logic.
 *
 * Key behaviors:
 * - Status from state store takes precedence over YAML status (more current)
 * - Falls back to YAML status when WU is not in state store
 * - Supports filtering by status and lane
 * - Gracefully handles errors (missing files, invalid YAML)
 *
 * @module wu-list
 * @see {@link ./wu-state-store.ts} - State store for runtime status
 * @see {@link ./wu-yaml.ts} - YAML operations
 * @see {@link ./wu-paths.ts} - Path utilities
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';
import { WUStateStore, type WUStateEntry } from './wu-state-store.js';
import { getConfig } from './lumenflow-config.js';
import { WU_STATUS } from './wu-constants.js';

/**
 * WU list entry returned by listWUs.
 * Contains essential fields for display and filtering.
 */
export interface WUListEntry {
  /** WU identifier (e.g., 'WU-100') */
  id: string;
  /** Short title describing the work */
  title: string;
  /** Lane assignment (e.g., 'Framework: Core') */
  lane: string;
  /** Current status (from state store or YAML) */
  status: string;
  /** Work type (feature, bug, documentation, etc.) */
  type: string;
  /** Priority level (P0-P3) */
  priority: string;
  /** Parent initiative reference (optional) */
  initiative?: string;
  /** Phase number within parent initiative (optional) */
  phase?: number;
  /** Creation date (YYYY-MM-DD) */
  created?: string;
}

/**
 * Options for listWUs function.
 */
export interface ListWUsOptions {
  /** Project root directory (default: cwd) */
  projectRoot?: string;
  /** Filter by status (e.g., 'in_progress', 'blocked', 'done') */
  status?: string;
  /** Filter by lane (e.g., 'Framework: Core') */
  lane?: string;
  /**
   * Direct path to WU directory (overrides config-based path).
   * Useful for testing with virtual filesystems.
   */
  wuDir?: string;
  /**
   * Direct path to state directory (overrides config-based path).
   * Useful for testing with virtual filesystems.
   */
  stateDir?: string;
}

/**
 * Lists WUs by merging state store status with YAML metadata.
 *
 * The state store contains the most current status (claim, block, complete events),
 * while YAML files contain the full metadata (title, lane, type, etc.).
 *
 * Status precedence:
 * 1. State store status (if WU has events)
 * 2. YAML status (fallback if not in state store)
 *
 * @param options - Listing options
 * @returns Array of WU list entries
 *
 * @example
 * // List all WUs
 * const allWUs = await listWUs();
 *
 * @example
 * // Filter by status
 * const inProgress = await listWUs({ status: 'in_progress' });
 *
 * @example
 * // Filter by lane
 * const coreWUs = await listWUs({ lane: 'Framework: Core' });
 *
 * @example
 * // Filter by both
 * const blockedCore = await listWUs({ status: 'blocked', lane: 'Framework: Core' });
 */
export async function listWUs(options: ListWUsOptions = {}): Promise<WUListEntry[]> {
  const {
    projectRoot = process.cwd(),
    status: filterStatus,
    lane: filterLane,
    wuDir: wuDirOverride,
    stateDir: stateDirOverride,
  } = options;

  // Determine paths: use overrides if provided, otherwise use config
  let wuDir: string;
  let stateDir: string;

  if (wuDirOverride && stateDirOverride) {
    // Direct paths provided (e.g., for testing)
    wuDir = wuDirOverride;
    stateDir = stateDirOverride;
  } else {
    // Get configuration for paths
    const config = getConfig({ projectRoot });
    wuDir = wuDirOverride ?? join(projectRoot, config.directories.wuDir);
    stateDir = stateDirOverride ?? join(projectRoot, config.state.stateDir);
  }

  // Load state store for runtime statuses
  const stateMap = await loadStateStore(stateDir);

  // Read all WU YAML files
  const wuEntries = await readWUYamlFiles(wuDir);

  // Merge state store status with YAML data
  const entries: WUListEntry[] = [];

  for (const yamlData of wuEntries) {
    // Skip invalid entries
    if (!yamlData.id || typeof yamlData.id !== 'string') {
      continue;
    }

    const wuId = yamlData.id;

    // Get status: state store takes precedence
    const stateEntry = stateMap.get(wuId);
    const yamlStatus = typeof yamlData.status === 'string' ? yamlData.status : WU_STATUS.READY;
    const status = stateEntry?.status ?? yamlStatus;

    // Get lane: prefer state store (more current), fall back to YAML
    const yamlLane = typeof yamlData.lane === 'string' ? yamlData.lane : '';
    const lane = stateEntry?.lane ?? yamlLane;

    // Extract string fields with type guards
    const yamlTitle = typeof yamlData.title === 'string' ? yamlData.title : '';
    const yamlType = typeof yamlData.type === 'string' ? yamlData.type : 'feature';
    const yamlPriority = typeof yamlData.priority === 'string' ? yamlData.priority : 'P2';

    // Build entry
    const entry: WUListEntry = {
      id: wuId,
      title: stateEntry?.title ?? yamlTitle,
      lane,
      status,
      type: yamlType,
      priority: yamlPriority,
    };

    // Add optional fields if present with type guards
    if (typeof yamlData.initiative === 'string') {
      entry.initiative = yamlData.initiative;
    }
    if (typeof yamlData.phase === 'number') {
      entry.phase = yamlData.phase;
    }
    if (typeof yamlData.created === 'string') {
      entry.created = yamlData.created;
    }

    // Apply filters
    if (filterStatus && status !== filterStatus) {
      continue;
    }
    if (filterLane && lane !== filterLane) {
      continue;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Loads state store and returns a map of WU ID to state entry.
 * Returns empty map on errors (graceful degradation).
 */
async function loadStateStore(stateDir: string): Promise<Map<string, WUStateEntry>> {
  const map = new Map<string, WUStateEntry>();

  try {
    const store = new WUStateStore(stateDir);
    await store.load();

    // Collect all known statuses
    const statuses = [WU_STATUS.IN_PROGRESS, WU_STATUS.BLOCKED, WU_STATUS.DONE, WU_STATUS.READY];

    for (const status of statuses) {
      const wuIds = store.getByStatus(status);
      for (const wuId of wuIds) {
        const state = store.getWUState(wuId);
        if (state) {
          map.set(wuId, state);
        }
      }
    }
  } catch {
    // Graceful degradation: return empty map on errors
  }

  return map;
}

/**
 * Reads all WU YAML files from the WU directory.
 * Skips invalid files (graceful degradation).
 */
async function readWUYamlFiles(wuDir: string): Promise<Array<Record<string, unknown>>> {
  const entries: Array<Record<string, unknown>> = [];

  try {
    const files = await readdir(wuDir);

    for (const file of files) {
      // Only process WU-*.yaml files
      if (!file.startsWith('WU-') || !file.endsWith('.yaml')) {
        continue;
      }

      try {
        const content = await readFile(join(wuDir, file), 'utf-8');
        const parsed = parseYaml(content);

        if (parsed && typeof parsed === 'object') {
          entries.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Skip invalid YAML files
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return entries;
}
