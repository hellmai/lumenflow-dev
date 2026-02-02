/**
 * Lane config resolver helpers.
 *
 * Extracts lane definitions from LumenFlow config while keeping the dependency surface small.
 */

import type { LaneConfig } from './initiative-orchestrator.js';

type LaneConfigDefinition = {
  name?: string;
  lock_policy?: LaneConfig['lock_policy'];
  wip_limit?: number;
};

type LaneConfigContainer = {
  lanes?: unknown;
};

const LANE_SECTION_KEYS = ['definitions', 'engineering', 'business'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLaneConfigContainer(config: unknown): config is LaneConfigContainer {
  return isRecord(config);
}

function isLaneDefinition(value: unknown): value is LaneConfigDefinition {
  return isRecord(value);
}

function collectLaneDefinitions(value: unknown, target: LaneConfigDefinition[]): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (isLaneDefinition(entry)) {
      target.push(entry);
    }
  }
}

function extractLaneDefinitions(config?: unknown): LaneConfigDefinition[] {
  if (!isLaneConfigContainer(config)) {
    return [];
  }

  const lanes = config.lanes;
  if (!lanes) {
    return [];
  }

  if (Array.isArray(lanes)) {
    const flat: LaneConfigDefinition[] = [];
    collectLaneDefinitions(lanes, flat);
    return flat;
  }

  if (!isRecord(lanes)) {
    return [];
  }

  const grouped: LaneConfigDefinition[] = [];
  for (const key of LANE_SECTION_KEYS) {
    collectLaneDefinitions(lanes[key], grouped);
  }

  return grouped;
}

function isLockPolicy(value: unknown): value is LaneConfig['lock_policy'] {
  return value === 'all' || value === 'active' || value === 'none';
}

/**
 * WU-1340: Resolve laneConfigs from LumenFlow config for policy-aware scheduling.
 */
export function resolveLaneConfigsFromConfig(config?: unknown): Record<string, LaneConfig> {
  const result: Record<string, LaneConfig> = {};
  const laneDefinitions = extractLaneDefinitions(config);

  for (const lane of laneDefinitions) {
    if (!lane.name || typeof lane.name !== 'string') {
      continue;
    }

    const entry: LaneConfig = {};

    if (isLockPolicy(lane.lock_policy)) {
      entry.lock_policy = lane.lock_policy;
    }

    if (typeof lane.wip_limit === 'number') {
      entry.wip_limit = lane.wip_limit;
    }

    result[lane.name] = entry;
  }

  return result;
}
