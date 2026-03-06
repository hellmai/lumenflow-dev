// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lane inference derived directly from workspace lane definitions.
 *
 * Suggestions are based on the canonical `workspace.yaml`
 * `software_delivery.lanes.definitions` block. There is no secondary
 * lane taxonomy artifact.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import YAML from 'yaml';
import { WORKSPACE_V2_KEYS } from './config-contract.js';
import { createError, ErrorCodes } from './error-handler.js';
import { getConfig, findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from './lumenflow-config.js';
import { asRecord } from './object-guards.js';
import { CONFIDENCE, WEIGHTS } from './wu-validation-constants.js';

interface LaneDefinition {
  name: string;
  description?: string;
  code_paths?: string[];
}

interface LaneScore {
  lane: string;
  confidence: number;
  parent: string;
}

interface LaneInferenceResult {
  lane: string;
  confidence: number;
}

const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
const DEFAULT_FALLBACK_PARENT = 'Operations';

function extractParentFromLaneName(laneName: string): string {
  const trimmed = laneName.trim();
  const colonIndex = trimmed.indexOf(':');
  return colonIndex === -1 ? trimmed : trimmed.substring(0, colonIndex).trim();
}

function normalizeDefinitionsFromLanes(lanes: unknown): LaneDefinition[] {
  if (Array.isArray(lanes)) {
    return lanes.filter((lane): lane is LaneDefinition => {
      const record = asRecord(lane);
      return typeof record?.name === 'string';
    });
  }

  const lanesRecord = asRecord(lanes);
  if (!lanesRecord) {
    return [];
  }

  const definitions: LaneDefinition[] = [];
  for (const key of ['definitions', 'engineering', 'business']) {
    const value = lanesRecord[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const lane of value) {
      const record = asRecord(lane);
      if (typeof record?.name === 'string') {
        definitions.push(record as unknown as LaneDefinition);
      }
    }
  }

  return definitions;
}

function parseWorkspaceLaneDefinitions(configPath: string): LaneDefinition[] {
  const rawConfig = readFileSync(configPath, { encoding: 'utf-8' });
  const parsedWorkspace = asRecord(YAML.parse(rawConfig));
  if (!parsedWorkspace) {
    throw createError(
      ErrorCodes.YAML_PARSE_ERROR,
      `Failed to parse workspace config: ${configPath}\n\n` +
        `${WORKSPACE_CONFIG_FILE_NAME} must contain an object root.`,
      { path: configPath },
    );
  }

  const softwareDelivery = asRecord(parsedWorkspace[SOFTWARE_DELIVERY_KEY]);
  if (!softwareDelivery) {
    throw createError(
      ErrorCodes.CONFIG_ERROR,
      `Missing ${SOFTWARE_DELIVERY_KEY} block in ${configPath}.\n\n` +
        'Run `pnpm workspace-init --yes` and configure lanes in workspace.yaml.',
      { path: configPath },
    );
  }

  return normalizeDefinitionsFromLanes(softwareDelivery.lanes);
}

function loadLaneDefinitions(configPath: string | null = null): LaneDefinition[] {
  if (configPath) {
    if (!existsSync(configPath)) {
      throw createError(
        ErrorCodes.FILE_NOT_FOUND,
        `Workspace config not found: ${configPath}\n\n` +
          `Run \`pnpm workspace-init --yes\` and \`pnpm lane:setup\` to scaffold ` +
          `${SOFTWARE_DELIVERY_KEY}.lanes.definitions.`,
        { path: configPath },
      );
    }

    const definitions = parseWorkspaceLaneDefinitions(configPath);
    if (definitions.length === 0) {
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `No lane definitions found in ${configPath}.\n\n` +
          `Configure ${SOFTWARE_DELIVERY_KEY}.lanes.definitions or run \`pnpm lane:setup\`.`,
        { path: configPath },
      );
    }
    return definitions;
  }

  const projectRoot = findProjectRoot();
  const config = getConfig({
    projectRoot,
    reload: true,
    strictWorkspace: true,
  });
  const definitions = normalizeDefinitionsFromLanes(config.lanes);

  if (definitions.length === 0) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `No lane definitions found in ${path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME)}.\n\n` +
        `Configure ${SOFTWARE_DELIVERY_KEY}.lanes.definitions or run \`pnpm lane:setup\`.`,
      { path: path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME) },
    );
  }

  return definitions;
}

function matchesPattern(codePath: string, pattern: string): boolean {
  return micromatch.isMatch(codePath, pattern, { nocase: true });
}

function containsKeyword(description: string, keyword: string): boolean {
  const normalizedDesc = description.toLowerCase().trim();
  const normalizedKeyword = keyword.toLowerCase().trim();
  return normalizedKeyword.length > 0 && normalizedDesc.includes(normalizedKeyword);
}

function buildLaneKeywords(definition: LaneDefinition): string[] {
  const keywords = new Set<string>();
  const sources = [definition.name, definition.description ?? ''];

  for (const source of sources) {
    for (const token of source.split(/[^a-zA-Z0-9/+-]+/)) {
      const normalized = token.trim().toLowerCase();
      if (normalized.length >= 3) {
        keywords.add(normalized);
      }
    }
  }

  return [...keywords];
}

function calculateConfidence(
  codePaths: string[],
  description: string,
  definition: LaneDefinition,
): number {
  let score = 0;

  for (const pattern of definition.code_paths ?? []) {
    if (codePaths.some((codePath) => matchesPattern(codePath, pattern))) {
      score += WEIGHTS.CODE_PATH_MATCH;
    }
  }

  for (const keyword of buildLaneKeywords(definition)) {
    if (containsKeyword(description, keyword)) {
      score += WEIGHTS.KEYWORD_MATCH;
    }
  }

  return score;
}

export function inferSubLane(
  codePaths: string[],
  description: string,
  configPath: string | null = null,
): LaneInferenceResult {
  if (!Array.isArray(codePaths)) {
    throw createError(ErrorCodes.VALIDATION_ERROR, 'codePaths must be an array of strings', {
      codePaths,
      type: typeof codePaths,
    });
  }
  if (typeof description !== 'string') {
    throw createError(ErrorCodes.VALIDATION_ERROR, 'description must be a string', {
      description,
      type: typeof description,
    });
  }

  const definitions = loadLaneDefinitions(configPath);
  const scores: LaneScore[] = definitions.map((definition) => ({
    lane: definition.name,
    confidence: calculateConfidence(codePaths, description, definition),
    parent: extractParentFromLaneName(definition.name),
  }));

  scores.sort((left, right) => right.confidence - left.confidence);
  const best = scores[0];

  if (!best || best.confidence === CONFIDENCE.MIN) {
    return {
      lane: DEFAULT_FALLBACK_PARENT,
      confidence: CONFIDENCE.MIN,
    };
  }

  if (best.confidence < CONFIDENCE.THRESHOLD) {
    return {
      lane: best?.parent ?? DEFAULT_FALLBACK_PARENT,
      confidence: CONFIDENCE.MIN,
    };
  }

  return {
    lane: best.lane,
    confidence: best.confidence,
  };
}

export function getAllSubLanes(configPath: string | null = null): string[] {
  try {
    return loadLaneDefinitions(configPath)
      .map((definition) => definition.name)
      .filter((laneName) => laneName.includes(':'))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export function getSubLanesForParent(parent: string, configPath: string | null = null): string[] {
  try {
    const normalizedParent = parent.toLowerCase().trim();
    const subLanes = new Set<string>();

    for (const definition of loadLaneDefinitions(configPath)) {
      const laneName = definition.name.trim();
      const colonIndex = laneName.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }

      const laneParent = laneName.substring(0, colonIndex).trim().toLowerCase();
      if (laneParent !== normalizedParent) {
        continue;
      }

      const subLane = laneName.substring(colonIndex + 1).trim();
      if (subLane.length > 0) {
        subLanes.add(subLane);
      }
    }

    return [...subLanes];
  } catch {
    return [];
  }
}
