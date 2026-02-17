/**
 * @file lane-lifecycle-process.ts
 * WU-1748: Process-owned deferred lane lifecycle
 *
 * Lane design is an explicit lifecycle:
 *   unconfigured -> draft -> locked
 *
 * `init` should bootstrap tooling only. Lane artifacts are created/validated/
 * finalized through dedicated lane lifecycle commands.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_FILES, FILE_SYSTEM, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { DEFAULT_LANE_DEFINITIONS, LANE_INFERENCE_TEMPLATE } from './init-templates.js';
import {
  extractConfigLanes,
  extractInferenceParents,
  validateLaneConfigAgainstInference,
  type LaneValidationResult,
} from './init-lane-validation.js';

const LANE_CONFIG_KEY = 'lanes';
const LANE_DEFINITIONS_KEY = 'definitions';
const LANE_LIFECYCLE_KEY = 'lifecycle';
const LANE_LIFECYCLE_STATUS_KEY = 'status';
const LANE_LIFECYCLE_UPDATED_AT_KEY = 'updated_at';
const LANE_LIFECYCLE_MIGRATED_AT_KEY = 'migrated_at';
const LANE_LIFECYCLE_MIGRATION_REASON_KEY = 'migration_reason';
const EMPTY_OBJECT = '{}';
const NEWLINE = '\n';
const EMPTY_STRING = '';

const WU_CREATE_PREFIX = '[wu:create]';
const INITIATIVE_CREATE_PREFIX = '[initiative:create]';
const INIT_PREFIX = '[lumenflow init]';

const LANE_SETUP_COMMAND = 'pnpm lane:setup';
const LANE_LOCK_COMMAND = 'pnpm lane:lock';
const LANE_READY_SENTINEL = 'lanes ready';

const DEFAULT_FRAMEWORK_LANES_TOKEN = '{{FRAMEWORK_LANES}}';

export const LANE_LIFECYCLE_STATUS = {
  UNCONFIGURED: 'unconfigured',
  DRAFT: 'draft',
  LOCKED: 'locked',
} as const;

export type LaneLifecycleStatus =
  (typeof LANE_LIFECYCLE_STATUS)[keyof typeof LANE_LIFECYCLE_STATUS];

export interface LaneLifecycleClassification {
  status: LaneLifecycleStatus;
  source: 'config' | 'migration';
  migrationReason: string | null;
  persisted: boolean;
}

export interface LaneArtifactsValidationResult extends LaneValidationResult {
  missingDefinitions: boolean;
  missingInference: boolean;
}

interface LaneLifecycleDoc {
  status?: string;
  updated_at?: string;
  migrated_at?: string;
  migration_reason?: string;
}

interface LanesDoc {
  definitions?: unknown;
  lifecycle?: LaneLifecycleDoc;
  [key: string]: unknown;
}

interface ConfigDoc {
  lanes?: LanesDoc;
  [key: string]: unknown;
}

function toIsoTimestamp(): string {
  return new Date().toISOString();
}

function isLaneLifecycleStatus(value: unknown): value is LaneLifecycleStatus {
  return (
    value === LANE_LIFECYCLE_STATUS.UNCONFIGURED ||
    value === LANE_LIFECYCLE_STATUS.DRAFT ||
    value === LANE_LIFECYCLE_STATUS.LOCKED
  );
}

function getConfigPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_FILES.LUMENFLOW_CONFIG);
}

function getLaneInferencePath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_FILES.LANE_INFERENCE);
}

function readConfigDoc(projectRoot: string): ConfigDoc {
  const configPath = getConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, FILE_SYSTEM.UTF8 as BufferEncoding);
    const parsed = YAML.parse(content) as ConfigDoc | null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfigDoc(projectRoot: string, config: ConfigDoc): void {
  const configPath = getConfigPath(projectRoot);
  const nextContent = YAML.stringify(config);
  writeFileSync(
    configPath,
    nextContent || EMPTY_OBJECT + NEWLINE,
    FILE_SYSTEM.UTF8 as BufferEncoding,
  );
}

function getLifecycleStatusFromDoc(config: ConfigDoc): LaneLifecycleStatus | null {
  const status = config?.lanes?.lifecycle?.status;
  return isLaneLifecycleStatus(status) ? status : null;
}

function ensureLanesDoc(config: ConfigDoc): LanesDoc {
  if (!config[LANE_CONFIG_KEY] || typeof config[LANE_CONFIG_KEY] !== 'object') {
    config[LANE_CONFIG_KEY] = {};
  }
  return config[LANE_CONFIG_KEY] as LanesDoc;
}

function setLifecycleStatusInDoc(
  config: ConfigDoc,
  status: LaneLifecycleStatus,
  migrationReason?: string,
): void {
  const lanes = ensureLanesDoc(config);
  const existingLifecycle =
    lanes[LANE_LIFECYCLE_KEY] && typeof lanes[LANE_LIFECYCLE_KEY] === 'object'
      ? (lanes[LANE_LIFECYCLE_KEY] as LaneLifecycleDoc)
      : {};

  const now = toIsoTimestamp();
  const lifecycle: LaneLifecycleDoc = {
    ...existingLifecycle,
    [LANE_LIFECYCLE_STATUS_KEY]: status,
    [LANE_LIFECYCLE_UPDATED_AT_KEY]: now,
  };

  if (migrationReason) {
    lifecycle[LANE_LIFECYCLE_MIGRATED_AT_KEY] = now;
    lifecycle[LANE_LIFECYCLE_MIGRATION_REASON_KEY] = migrationReason;
  }

  lanes[LANE_LIFECYCLE_KEY] = lifecycle;
}

function hasLaneDefinitions(config: ConfigDoc): boolean {
  const definitions = config?.lanes?.definitions;
  return Array.isArray(definitions) && definitions.length > 0;
}

function hasLaneInferenceFile(projectRoot: string): boolean {
  return existsSync(getLaneInferencePath(projectRoot));
}

function deepCloneDefaultLaneDefinitions(): unknown[] {
  return JSON.parse(JSON.stringify(DEFAULT_LANE_DEFINITIONS)) as unknown[];
}

function buildDefaultLaneInferenceTemplate(): string {
  return LANE_INFERENCE_TEMPLATE.replace(DEFAULT_FRAMEWORK_LANES_TOKEN, EMPTY_STRING);
}

/**
 * Classify lifecycle status for projects that do not yet have explicit
 * lanes.lifecycle.status in config.
 */
export function classifyLaneLifecycleForProject(projectRoot: string): LaneLifecycleClassification {
  const config = readConfigDoc(projectRoot);
  const configuredStatus = getLifecycleStatusFromDoc(config);
  if (configuredStatus) {
    return {
      status: configuredStatus,
      source: 'config',
      migrationReason: null,
      persisted: false,
    };
  }

  const definitionsPresent = hasLaneDefinitions(config);
  const inferencePresent = hasLaneInferenceFile(projectRoot);

  if (!definitionsPresent && !inferencePresent) {
    return {
      status: LANE_LIFECYCLE_STATUS.UNCONFIGURED,
      source: 'migration',
      migrationReason: 'no lane artifacts',
      persisted: false,
    };
  }

  if (definitionsPresent && inferencePresent) {
    const validation = validateLaneArtifacts(projectRoot);
    if (validation.invalidLanes.length === 0 && validation.warnings.length === 0) {
      return {
        status: LANE_LIFECYCLE_STATUS.LOCKED,
        source: 'migration',
        migrationReason: 'lane artifacts detected and valid',
        persisted: false,
      };
    }

    return {
      status: LANE_LIFECYCLE_STATUS.DRAFT,
      source: 'migration',
      migrationReason: 'lane artifacts detected but validation failed',
      persisted: false,
    };
  }

  return {
    status: LANE_LIFECYCLE_STATUS.DRAFT,
    source: 'migration',
    migrationReason: 'partial lane artifacts detected',
    persisted: false,
  };
}

/**
 * Ensure lifecycle status exists in config.
 *
 * Existing repositories are migrated deterministically from current artifacts:
 * - valid artifacts => locked
 * - invalid/partial artifacts => draft
 * - no artifacts => unconfigured
 */
export function ensureLaneLifecycleForProject(
  projectRoot: string,
  options: { persist?: boolean } = {},
): LaneLifecycleClassification {
  const persist = options.persist ?? true;
  const classification = classifyLaneLifecycleForProject(projectRoot);
  if (!persist || classification.source === 'config') {
    return classification;
  }

  const config = readConfigDoc(projectRoot);
  setLifecycleStatusInDoc(
    config,
    classification.status,
    classification.migrationReason ?? undefined,
  );
  writeConfigDoc(projectRoot, config);

  return {
    ...classification,
    persisted: true,
  };
}

export function setLaneLifecycleStatus(projectRoot: string, status: LaneLifecycleStatus): void {
  const config = readConfigDoc(projectRoot);
  setLifecycleStatusInDoc(config, status);
  writeConfigDoc(projectRoot, config);
}

export function recommendLaneLifecycleNextStep(status: LaneLifecycleStatus): string {
  if (status === LANE_LIFECYCLE_STATUS.UNCONFIGURED) {
    return LANE_SETUP_COMMAND;
  }
  if (status === LANE_LIFECYCLE_STATUS.DRAFT) {
    return LANE_LOCK_COMMAND;
  }
  return LANE_READY_SENTINEL;
}

export function buildWuCreateLaneLifecycleMessage(status: LaneLifecycleStatus): string {
  return [
    `${WU_CREATE_PREFIX} Lane lifecycle status: ${status}`,
    'Cannot create delivery WU until lanes are locked.',
    `Next step: ${recommendLaneLifecycleNextStep(status)}`,
  ].join(NEWLINE);
}

export function buildInitiativeCreateLaneLifecycleMessage(status: LaneLifecycleStatus): string {
  return [
    `${INITIATIVE_CREATE_PREFIX} Lane lifecycle: ${status}`,
    'Initiative creation is allowed before lane setup.',
    `When ready for delivery WUs, run: ${recommendLaneLifecycleNextStep(status)}`,
  ].join(NEWLINE);
}

export function buildInitLaneLifecycleMessage(status: LaneLifecycleStatus): string {
  return [
    `${INIT_PREFIX} Lane lifecycle: ${status}`,
    'Lanes are configured after project context is defined (plan/architecture).',
    `Next step: ${recommendLaneLifecycleNextStep(status)}`,
  ].join(NEWLINE);
}

/**
 * WU-1755: Detect workspace structure and generate project-specific lane definitions.
 * Scans pnpm-workspace.yaml or package.json workspaces to build lanes from actual project layout.
 * Falls back to DEFAULT_LANE_DEFINITIONS if no workspace config is found.
 */
function detectWorkspaceLanes(
  projectRoot: string,
): { name: string; wip_limit: number; code_paths: string[] }[] {
  const lanes: { name: string; wip_limit: number; code_paths: string[] }[] = [];

  // Try pnpm-workspace.yaml first
  const pnpmWorkspacePath = path.join(projectRoot, 'pnpm-workspace.yaml');
  let workspacePatterns: string[] = [];

  if (existsSync(pnpmWorkspacePath)) {
    try {
      const content = readFileSync(pnpmWorkspacePath, FILE_SYSTEM.ENCODING as BufferEncoding);
      const parsed = YAML.parse(content) as { packages?: string[] };
      workspacePatterns = parsed?.packages ?? [];
    } catch {
      // Fall through to package.json check
    }
  }

  // Fall back to package.json workspaces
  if (workspacePatterns.length === 0) {
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const content = readFileSync(pkgJsonPath, FILE_SYSTEM.ENCODING as BufferEncoding);
        const parsed = JSON.parse(content) as { workspaces?: string[] | { packages?: string[] } };
        if (Array.isArray(parsed?.workspaces)) {
          workspacePatterns = parsed.workspaces;
        } else if (parsed?.workspaces?.packages) {
          workspacePatterns = parsed.workspaces.packages;
        }
      } catch {
        // Fall through to defaults
      }
    }
  }

  if (workspacePatterns.length === 0) {
    return deepCloneDefaultLaneDefinitions() as typeof lanes;
  }

  // Scan workspace patterns for actual directories
  for (const pattern of workspacePatterns) {
    const baseDir = pattern.replace(/\/?\*$/, '');
    const fullPath = path.join(projectRoot, baseDir);
    if (!existsSync(fullPath)) continue;

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgPath = path.join(fullPath, entry.name, 'package.json');
        if (!existsSync(pkgPath)) continue;

        // Determine lane category from directory structure
        const isApp = baseDir.includes('app');
        const category = isApp ? 'Experience' : 'Framework';
        const displayName = entry.name.replace(/^@[^/]+\//, '');
        lanes.push({
          name: `${category}: ${displayName.charAt(0).toUpperCase() + displayName.slice(1)}`,
          wip_limit: 1,
          code_paths: [`${baseDir}/${entry.name}/**`],
        });
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // Always include Content: Documentation if docs/ exists
  if (existsSync(path.join(projectRoot, 'docs'))) {
    lanes.push({
      name: 'Content: Documentation',
      wip_limit: 1,
      code_paths: ['docs/**', '*.md'],
    });
  }

  // Always include Operations: CI/CD if .github/ exists
  if (existsSync(path.join(projectRoot, '.github'))) {
    lanes.push({
      name: 'Operations: CI/CD',
      wip_limit: 1,
      code_paths: ['.github/workflows/**', '.github/actions/**'],
    });
  }

  return lanes.length > 0 ? lanes : (deepCloneDefaultLaneDefinitions() as typeof lanes);
}

export function ensureDraftLaneArtifacts(projectRoot: string): {
  createdDefinitions: boolean;
  createdInference: boolean;
  status: LaneLifecycleStatus;
} {
  const config = readConfigDoc(projectRoot);
  const lanes = ensureLanesDoc(config);

  let createdDefinitions = false;
  if (!hasLaneDefinitions(config)) {
    // WU-1755: Detect workspace structure for project-specific lanes
    lanes[LANE_DEFINITIONS_KEY] = detectWorkspaceLanes(projectRoot);
    createdDefinitions = true;
  }

  const laneInferencePath = getLaneInferencePath(projectRoot);
  let createdInference = false;
  if (!existsSync(laneInferencePath)) {
    const inferenceDir = path.dirname(laneInferencePath);
    if (!existsSync(inferenceDir)) {
      mkdirSync(inferenceDir, { recursive: true });
    }
    writeFileSync(
      laneInferencePath,
      buildDefaultLaneInferenceTemplate(),
      FILE_SYSTEM.ENCODING as BufferEncoding,
    );
    createdInference = true;
  }

  setLifecycleStatusInDoc(config, LANE_LIFECYCLE_STATUS.DRAFT);
  writeConfigDoc(projectRoot, config);

  return {
    createdDefinitions,
    createdInference,
    status: LANE_LIFECYCLE_STATUS.DRAFT,
  };
}

export function validateLaneArtifacts(projectRoot: string): LaneArtifactsValidationResult {
  const configPath = getConfigPath(projectRoot);
  const inferencePath = getLaneInferencePath(projectRoot);

  const configLanes = extractConfigLanes(configPath);
  const inferenceParents = extractInferenceParents(inferencePath);

  const missingDefinitions = configLanes.length === 0;
  const missingInference = inferenceParents.length === 0;

  const warnings: string[] = [];
  const invalidLanes: string[] = [];

  if (missingDefinitions) {
    warnings.push(
      `No lane definitions found in ${CONFIG_FILES.LUMENFLOW_CONFIG}. Run: ${LANE_SETUP_COMMAND}`,
    );
  }
  if (missingInference) {
    warnings.push(`Missing or invalid ${CONFIG_FILES.LANE_INFERENCE}. Run: ${LANE_SETUP_COMMAND}`);
  }

  if (!missingDefinitions && !missingInference) {
    const laneValidation = validateLaneConfigAgainstInference(configLanes, inferenceParents);
    warnings.push(...laneValidation.warnings);
    invalidLanes.push(...laneValidation.invalidLanes);
  }

  return {
    warnings,
    invalidLanes,
    missingDefinitions,
    missingInference,
  };
}

export function getLaneLifecycleStatusPath(): string {
  return path.join(LUMENFLOW_PATHS.STATE_DIR, 'lane-lifecycle.json');
}
