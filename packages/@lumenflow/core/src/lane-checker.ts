#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lane Occupancy Checker
 *
 * Enforces one-WU-per-lane rule by checking status.md for active WUs in a given lane.
 * Used by wu-claim.ts and wu-unblock.ts to prevent WIP violations.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseYAML } from './wu-yaml.js';
import { getSubLanesForParent } from './lane-inference.js';
import { createError, ErrorCodes } from './error-handler.js';
import { isInProgressHeader, WU_LINK_PATTERN } from './constants/backlog-patterns.js';
import { CONFIG_FILES, STRING_LITERALS } from './wu-constants.js';
import { findProjectRoot, getConfig, WORKSPACE_CONFIG_FILE_NAME } from './lumenflow-config.js';
import { WORKSPACE_V2_KEYS } from './config-contract.js';
import type { LockPolicy } from './lumenflow-config-schema.js';
import { asRecord } from './object-guards.js';

// Type definitions
interface ValidateLaneOptions {
  strict?: boolean;
}

interface ValidateLaneResult {
  valid: boolean;
  parent: string;
  error: string | null;
}

interface CheckLaneFreeResult {
  free: boolean;
  occupiedBy: string | null;
  error: string | null;
  /** WU-1016: List of WU IDs currently in progress in this lane */
  inProgressWUs?: string[];
  /** WU-1016: The configured WIP limit for this lane */
  wipLimit?: number;
  /** WU-1016: Current count of in-progress WUs in this lane */
  currentCount?: number;
}

/** WU-1016: Options for checkLaneFree */
interface CheckLaneFreeOptions {
  /** Optional config path override for testing */
  configPath?: string;
}

/** WU-1016: Options for getWipLimitForLane */
interface GetWipLimitOptions {
  /** Optional config path override for testing */
  configPath?: string;
}

interface LaneConfig {
  name: string;
}

interface LaneEnforcement {
  require_parent?: boolean;
  allow_custom?: boolean;
}

interface LumenflowConfig {
  lanes?:
    | LaneConfigWithWip[]
    | {
        engineering?: LaneConfigWithWip[];
        business?: LaneConfigWithWip[];
        enforcement?: LaneEnforcement;
        definitions?: LaneConfigWithWip[];
      };
}

/** WU-1016: Extended LaneConfig with wip_limit support */
/** WU-1187: Added wip_justification field for soft WIP enforcement */
/** WU-1325: Added lock_policy field for lane-level lock behavior */
interface LaneConfigWithWip extends LaneConfig {
  wip_limit?: number;
  /** WU-1187: Required justification when wip_limit > 1 */
  wip_justification?: string;
  /** WU-1325: Lock policy for this lane */
  lock_policy?: LockPolicy;
}

// WU-2044: Use canonical WUDocBase instead of local definition
type WUDoc = Pick<import('./wu-doc-types.js').WUDocBase, 'lane'>;

// Re-export for test access
export { getSubLanesForParent };

/** Log prefix for lane-checker messages */
const PREFIX = '[lane-checker]';
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
const LANE_DEFINITIONS_HINT = `${WORKSPACE_CONFIG_FILE_NAME} (${SOFTWARE_DELIVERY_KEY}.lanes.definitions)`;

/** Status.md marker for empty In Progress section */
const NO_ITEMS_MARKER = 'No items currently in progress';

/**
 * Extract parent lane from sub-lane or parent-only format
 * @param {string} lane - Lane name (e.g., "Operations: Tooling" or "Operations")
 * @returns {string} Parent lane name
 */
export function extractParent(lane: string): string {
  const trimmed = lane.trim();
  const colonIndex = trimmed.indexOf(':');

  if (colonIndex === -1) {
    // Parent-only format
    return trimmed;
  }

  // Sub-lane format: extract parent before colon
  return trimmed.substring(0, colonIndex).trim();
}

/**
 * WU-1308: Check if lane-inference.yaml file exists
 * @returns {boolean} True if the file exists
 */
function laneInferenceFileExists(): boolean {
  const projectRoot = findProjectRoot();
  const taxonomyPath = path.join(projectRoot, CONFIG_FILES.LANE_INFERENCE);
  return existsSync(taxonomyPath);
}

/**
 * Check if a parent lane has sub-lane taxonomy defined
 * @param {string} parent - Parent lane name
 * @returns {boolean} True if parent has sub-lanes in lane-inference config
 */
function hasSubLaneTaxonomy(parent: string): boolean {
  const projectRoot = findProjectRoot();
  const taxonomyPath = path.join(projectRoot, CONFIG_FILES.LANE_INFERENCE);

  if (!existsSync(taxonomyPath)) {
    return false;
  }

  try {
    const taxonomyContent = readFileSync(taxonomyPath, { encoding: 'utf-8' });
    const taxonomy = parseYAML(taxonomyContent) as Record<string, unknown>;

    // Check if parent exists as top-level key in taxonomy
    const normalizedParent = parent.trim();
    return Object.keys(taxonomy).some(
      (key) => key.toLowerCase().trim() === normalizedParent.toLowerCase(),
    );
  } catch {
    return false;
  }
}

/**
 * Check if a sub-lane exists for a given parent in lane-inference config
 * @param {string} parent - Parent lane name
 * @param {string} subdomain - Sub-lane name
 * @returns {boolean} True if sub-lane exists
 */
function isValidSubLane(parent: string, subdomain: string): boolean {
  const projectRoot = findProjectRoot();
  const taxonomyPath = path.join(projectRoot, CONFIG_FILES.LANE_INFERENCE);

  if (!existsSync(taxonomyPath)) {
    return false;
  }

  try {
    const taxonomyContent = readFileSync(taxonomyPath, { encoding: 'utf-8' });
    const taxonomy = parseYAML(taxonomyContent) as Record<string, Record<string, unknown>>;

    // Find parent key (case-insensitive)
    const normalizedParent = parent.trim().toLowerCase();
    const parentKey = Object.keys(taxonomy).find(
      (key) => key.toLowerCase().trim() === normalizedParent,
    );

    if (!parentKey) {
      return false;
    }

    // Check if subdomain exists under parent
    const subLanes = taxonomy[parentKey];
    if (!subLanes || typeof subLanes !== 'object') {
      return false;
    }

    // Exact match on subdomain (case-sensitive per Codex spec)
    return Object.keys(subLanes).includes(subdomain.trim());
  } catch {
    return false;
  }
}

/**
 * Count occurrences of a character in a string
 * @param {string} str - String to search
 * @param {string} char - Character to count
 * @returns {number} Number of occurrences
 */
function countChar(str: string, char: string): number {
  let count = 0;
  for (const c of str) {
    if (c === char) count++;
  }
  return count;
}

/** Lane format separator character */
const LANE_SEPARATOR = ':';

/** Space character for format validation */
const SPACE = ' ';

/**
 * Validation mode options
 * @typedef {Object} ValidateLaneOptions
 * @property {boolean} [strict=true] - When true, throws error for parent-only lanes with taxonomy.
 *                                     When false, only warns (for existing WU validation).
 */

/**
 * WU-1197: Validate colon format in lane string
 * @throws {LumenflowError} If format is invalid
 */
function validateColonFormat(lane: string, trimmed: string, colonIndex: number): void {
  // Check for space before colon
  if (colonIndex > 0 && trimmed[colonIndex - 1] === SPACE) {
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Invalid lane format: "${lane}" has space before colon. Expected format: "Parent: Subdomain" (space AFTER colon only)`,
      { lane },
    );
  }

  // Check for space after colon
  if (colonIndex + 1 >= trimmed.length || trimmed[colonIndex + 1] !== SPACE) {
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Invalid lane format: "${lane}" is missing space after colon. Expected format: "Parent: Subdomain"`,
      { lane },
    );
  }
}

/**
 * WU-1197: Validate sub-lane format (Parent: Subdomain)
 * @throws {LumenflowError} If validation fails
 */
function validateSubLaneFormat(
  lane: string,
  trimmed: string,
  colonIndex: number,
  configPath: string | null,
): ValidateLaneResult {
  validateColonFormat(lane, trimmed, colonIndex);

  // Extract parent and subdomain (colonIndex + 2 = skip colon and space)
  const parent = trimmed.substring(0, colonIndex).trim();
  const subdomain = trimmed.substring(colonIndex + LANE_SEPARATOR.length + SPACE.length).trim();

  // Validate parent exists in config
  if (!isValidParentLane(parent, configPath)) {
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Unknown parent lane: "${parent}". Check ${LANE_DEFINITIONS_HINT} for valid lanes.`,
      { parent, lane },
    );
  }

  // WU-1308: Check if lane-inference file exists before validating sub-lanes
  // This provides a clear error message when the file is missing
  if (!laneInferenceFileExists()) {
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Sub-lane validation requires ${CONFIG_FILES.LANE_INFERENCE} which is missing.\n\n` +
        `The file "${CONFIG_FILES.LANE_INFERENCE}" defines the lane taxonomy for sub-lane validation.\n\n` +
        `To fix this:\n` +
        `  1. Generate a lane taxonomy from your codebase:\n` +
        `     pnpm lane:suggest --output ${CONFIG_FILES.LANE_INFERENCE}\n\n` +
        `  2. Or copy from an example project and customize.\n\n` +
        `See: LUMENFLOW.md "Setup Notes" section for details.`,
      { lane, parent, subdomain, missingFile: CONFIG_FILES.LANE_INFERENCE },
    );
  }

  // Validate sub-lane exists in taxonomy
  if (hasSubLaneTaxonomy(parent)) {
    validateSubLaneInTaxonomy(parent, subdomain);
  } else {
    // Parent has no taxonomy - reject sub-lane format
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Parent lane "${parent}" does not support sub-lanes. Use parent-only format or extend ${CONFIG_FILES.LANE_INFERENCE}.`,
      { parent, lane },
    );
  }

  return { valid: true, parent, error: null };
}

/**
 * WU-1197: Validate that sub-lane exists in taxonomy
 * @throws {LumenflowError} If sub-lane is not valid
 */
function validateSubLaneInTaxonomy(parent: string, subdomain: string): void {
  if (!isValidSubLane(parent, subdomain)) {
    const validSubLanes = getSubLanesForParent(parent);
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Unknown sub-lane: "${subdomain}" for parent lane "${parent}".\n\n` +
        `Valid sub-lanes: ${validSubLanes.join(', ')}`,
      { parent, subdomain, validSubLanes },
    );
  }
}

/**
 * WU-1197: Validate parent-only lane format
 * @throws {LumenflowError} If validation fails (in strict mode)
 */
function validateParentOnlyFormat(
  trimmed: string,
  configPath: string | null,
  strict: boolean,
): ValidateLaneResult {
  if (!isValidParentLane(trimmed, configPath)) {
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Unknown parent lane: "${trimmed}". Check ${LANE_DEFINITIONS_HINT} for valid lanes.`,
      { lane: trimmed },
    );
  }

  // Block if parent has sub-lane taxonomy (sub-lane required)
  if (hasSubLaneTaxonomy(trimmed)) {
    const validSubLanes = getSubLanesForParent(trimmed);
    const message =
      `Parent-only lane "${trimmed}" blocked. Sub-lane required. ` +
      `Valid: ${validSubLanes.join(', ')}. ` +
      `Format: "${trimmed}: <sublane>"`;

    if (strict) {
      throw createError(ErrorCodes.INVALID_LANE, message, { lane: trimmed, validSubLanes });
    }
    // Non-strict mode: warn only for existing WU validation

    console.warn(`${PREFIX} ⚠️  ${message}`);
  }

  return { valid: true, parent: trimmed, error: null };
}

/**
 * Validate lane format and parent existence
 * @param {string} lane - Lane name (e.g., "Operations: Tooling" or "Operations")
 * @param {string} configPath - Path to config file (optional, defaults to project root)
 * @param {ValidateLaneOptions} options - Validation options
 * @returns {{ valid: boolean, parent: string, error: string | null }}
 */
export function validateLaneFormat(
  lane: string,
  configPath: string | null = null,
  options: ValidateLaneOptions = {},
): ValidateLaneResult {
  const { strict = true } = options;
  const trimmed = lane.trim();

  // Check for multiple colons
  const colonCount = countChar(trimmed, LANE_SEPARATOR);
  if (colonCount > 1) {
    throw createError(
      ErrorCodes.INVALID_LANE,
      `Invalid lane format: "${lane}" contains multiple colons. Expected format: "Parent: Subdomain" or "Parent"`,
      { lane },
    );
  }

  const colonIndex = trimmed.indexOf(LANE_SEPARATOR);
  const isSubLaneFormat = colonIndex !== -1;

  if (isSubLaneFormat) {
    return validateSubLaneFormat(lane, trimmed, colonIndex, configPath);
  }
  return validateParentOnlyFormat(trimmed, configPath, strict);
}

/**
 * WU-1197: Result of extracting lanes from config for parent validation
 */
interface ExtractedLanesForParentCheck {
  allLanes: string[];
  parentLanes: Set<string>;
}

/**
 * WU-1197: Extract lane names and parent lanes from config
 * Handles flat array, definitions, and legacy nested formats
 */
function extractLanesForParentCheck(config: LumenflowConfig): ExtractedLanesForParentCheck {
  const allLanes: string[] = [];
  const parentLanes = new Set<string>();

  if (!config.lanes) {
    return { allLanes, parentLanes };
  }

  if (Array.isArray(config.lanes)) {
    // Flat array format: lanes: [{name: "Core"}, {name: "CLI"}, ...]
    allLanes.push(...config.lanes.map((l) => l.name));
    return { allLanes, parentLanes };
  }

  // WU-1022: New format with lanes.definitions containing full "Parent: Sublane" names
  if (config.lanes.definitions) {
    for (const lane of config.lanes.definitions) {
      allLanes.push(lane.name);
      // Extract parent from full lane name for parent validation
      const extracted = extractParent(lane.name);
      parentLanes.add(extracted.toLowerCase().trim());
    }
  }

  // Legacy nested format: lanes: {engineering: [...], business: [...]}
  if (config.lanes.engineering) {
    allLanes.push(...config.lanes.engineering.map((l) => l.name));
  }
  if (config.lanes.business) {
    allLanes.push(...config.lanes.business.map((l) => l.name));
  }

  return { allLanes, parentLanes };
}

function resolveConfigPath(configPath: string | null): string {
  if (configPath) {
    return configPath;
  }
  const projectRoot = findProjectRoot();
  return path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
}

function readConfigFromPath(configPath: string): LumenflowConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const configContent = readFileSync(configPath, { encoding: 'utf-8' });
    const parsed = parseYAML(configContent) as unknown;
    const workspace = asRecord(parsed);
    if (!workspace) {
      return null;
    }

    const softwareDelivery = asRecord(workspace[SOFTWARE_DELIVERY_KEY]);
    if (!softwareDelivery) {
      return null;
    }

    return softwareDelivery as LumenflowConfig;
  } catch {
    return null;
  }
}

/** Sentinel to distinguish file-missing from parse-failure in readRuntimeConfig */
const CONFIG_PARSE_FAILED = Symbol('CONFIG_PARSE_FAILED');

/** Coerce CONFIG_PARSE_FAILED sentinel to null for callers that degrade gracefully */
function coerceConfig(
  config: LumenflowConfig | null | typeof CONFIG_PARSE_FAILED,
): LumenflowConfig | null {
  return config === CONFIG_PARSE_FAILED ? null : config;
}

function readRuntimeConfig(
  projectRoot: string,
): LumenflowConfig | null | typeof CONFIG_PARSE_FAILED {
  const workspacePath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
  if (!existsSync(workspacePath)) {
    return null;
  }

  try {
    const config = getConfig({
      projectRoot,
      reload: true,
      strictWorkspace: true,
    });
    return { lanes: config.lanes as LumenflowConfig['lanes'] };
  } catch {
    // WU-2223: Return sentinel instead of null so caller can distinguish
    // file-missing (null) from parse-failure (CONFIG_PARSE_FAILED)
    return CONFIG_PARSE_FAILED;
  }
}

/**
 * Check if a parent lane exists in LumenFlow config
 *
 * WU-1022: Updated to support lanes.definitions with full "Parent: Sublane" format.
 * When lanes.definitions exists, parent lanes are extracted from full lane names.
 *
 * @param {string} parent - Parent lane name to check
 * @param {string} configPath - Path to config file (optional)
 * @returns {boolean} True if parent lane exists
 */
function isValidParentLane(parent: string, configPath: string | null = null): boolean {
  const resolvedConfigPath = resolveConfigPath(configPath);
  const config =
    configPath !== null
      ? readConfigFromPath(resolvedConfigPath)
      : readRuntimeConfig(findProjectRoot());

  // WU-2223: Distinguish file-missing from parse-failure
  if (config === CONFIG_PARSE_FAILED) {
    throw createError(
      ErrorCodes.CONFIG_ERROR,
      `workspace.yaml exists but failed validation: ${resolvedConfigPath}\n\n` +
        'The control_plane section may have an incompatible schema.\n' +
        'Run: pnpm lumenflow:doctor  to diagnose config issues.',
      { path: resolvedConfigPath },
    );
  }

  if (!config) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Config file not found: ${resolvedConfigPath}`, {
      path: resolvedConfigPath,
    });
  }

  const { allLanes, parentLanes } = extractLanesForParentCheck(config);
  const normalizedParent = parent.toLowerCase().trim();

  // WU-1022: If we have extracted parent lanes (from full lane names), check against those
  if (parentLanes.size > 0) {
    return parentLanes.has(normalizedParent);
  }

  // Legacy: check against direct lane names
  return allLanes.some((lane) => lane.toLowerCase().trim() === normalizedParent);
}

/** WU-1016: Default WIP limit when not specified in config */
const DEFAULT_WIP_LIMIT = 1;

/**
 * WU-1016: Get WIP limit for a lane from config
 *
 * Reads the wip_limit field from workspace.yaml software_delivery.lanes.definitions.
 * Returns DEFAULT_WIP_LIMIT (1) if the lane is not found or wip_limit is not specified.
 *
 * @param {string} lane - Lane name (e.g., "Core", "CLI")
 * @param {GetWipLimitOptions} options - Options including configPath for testing
 * @returns {number} The WIP limit for the lane (default: 1)
 */
export function getWipLimitForLane(lane: string, options: GetWipLimitOptions = {}): number {
  const config = coerceConfig(
    options.configPath
      ? readConfigFromPath(options.configPath)
      : readRuntimeConfig(findProjectRoot()),
  );
  if (!config?.lanes) {
    return DEFAULT_WIP_LIMIT;
  }

  const normalizedLane = lane.toLowerCase().trim();

  const allLanes = extractAllLanesFromConfig(config);
  const matchingLane = allLanes.find((l) => l.name.toLowerCase().trim() === normalizedLane);
  return matchingLane?.wip_limit ?? DEFAULT_WIP_LIMIT;
}

/** WU-1325: Default lock policy when not specified in config */
const DEFAULT_LOCK_POLICY: LockPolicy = 'all';

/** WU-1325: Options for getLockPolicyForLane */
interface GetLockPolicyOptions {
  /** Optional config path override for testing */
  configPath?: string;
}

/**
 * WU-1325: Get lock policy for a lane from config
 *
 * Reads the lock_policy field from workspace.yaml software_delivery.lanes.definitions.
 * Returns DEFAULT_LOCK_POLICY ('all') if the lane is not found or lock_policy is not specified.
 *
 * Lock policies:
 * - 'all' (default): Lock held through entire WU lifecycle (claim to done)
 * - 'active': Lock released on block, re-acquired on unblock
 * - 'none': No lock files created, WIP checking disabled for this lane
 *
 * @param {string} lane - Lane name (e.g., "Framework: Core", "Content: Documentation")
 * @param {GetLockPolicyOptions} options - Options including configPath for testing
 * @returns {LockPolicy} The lock policy for the lane (default: 'all')
 */
export function getLockPolicyForLane(lane: string, options: GetLockPolicyOptions = {}): LockPolicy {
  const config = coerceConfig(
    options.configPath
      ? readConfigFromPath(options.configPath)
      : readRuntimeConfig(findProjectRoot()),
  );
  if (!config?.lanes) {
    return DEFAULT_LOCK_POLICY;
  }

  const normalizedLane = lane.toLowerCase().trim();
  const allLanes = extractAllLanesFromConfig(config);
  const matchingLane = allLanes.find((l) => l.name.toLowerCase().trim() === normalizedLane);
  const policy = matchingLane?.lock_policy;
  return policy === 'all' || policy === 'active' || policy === 'none'
    ? policy
    : DEFAULT_LOCK_POLICY;
}

/** WU-1197: Section heading marker for H2 headings */
const SECTION_HEADING_PREFIX = '## ';

/**
 * WU-1197: Create an empty lane result (no WUs in progress)
 */
function createEmptyLaneResult(wipLimit: number): CheckLaneFreeResult {
  return {
    free: true,
    occupiedBy: null,
    error: null,
    inProgressWUs: [],
    wipLimit,
    currentCount: 0,
  };
}

/**
 * WU-1197: Extract In Progress section from status.md lines
 * @returns Section content or null if not found
 */
function extractInProgressSection(lines: string[]): { section: string; error: string | null } {
  const inProgressIdx = lines.findIndex((l) => isInProgressHeader(l));

  if (inProgressIdx === -1) {
    return { section: '', error: 'Could not find "## In Progress" section in status.md' };
  }

  // Find end of In Progress section (next ## heading or end of file)
  let endIdx = lines
    .slice(inProgressIdx + 1)
    .findIndex((l) => l.startsWith(SECTION_HEADING_PREFIX));
  if (endIdx === -1) {
    endIdx = lines.length - inProgressIdx - 1;
  } else {
    endIdx = inProgressIdx + 1 + endIdx;
  }

  const section = lines.slice(inProgressIdx + 1, endIdx).join(STRING_LITERALS.NEWLINE);
  return { section, error: null };
}

/** WU-1324: Blocked section header patterns */
const BLOCKED_HEADERS = ['## blocked', '## ⛔ blocked'];

/**
 * WU-1324: Check if a line matches a Blocked section header.
 * @param {string} line - Line to check (will be trimmed and lowercased)
 * @returns {boolean} True if line is a Blocked header
 */
function isBlockedHeader(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return BLOCKED_HEADERS.some((header) => normalized === header || normalized.startsWith(header));
}

/**
 * WU-1324: Extract Blocked section from status.md lines
 * @returns Section content (may be empty if section doesn't exist)
 */
function extractBlockedSection(lines: string[]): { section: string } {
  const blockedIdx = lines.findIndex((l) => isBlockedHeader(l));

  if (blockedIdx === -1) {
    // Blocked section doesn't exist - return empty
    return { section: '' };
  }

  // Find end of Blocked section (next ## heading or end of file)
  let endIdx = lines.slice(blockedIdx + 1).findIndex((l) => l.startsWith(SECTION_HEADING_PREFIX));
  if (endIdx === -1) {
    endIdx = lines.length - blockedIdx - 1;
  } else {
    endIdx = blockedIdx + 1 + endIdx;
  }

  const section = lines.slice(blockedIdx + 1, endIdx).join(STRING_LITERALS.NEWLINE);
  return { section };
}

/**
 * WU-1197: Check if a WU belongs to the target lane
 * @returns The WU ID if it matches the target lane, null otherwise
 */
function checkWuLaneMatch(
  activeWuid: string,
  wuid: string,
  wuDir: string,
  targetLane: string,
): string | null {
  // Skip if it's the same WU we're trying to claim
  if (activeWuid === wuid) {
    return null;
  }

  const wuPath = path.join(wuDir, `${activeWuid}.yaml`);

  if (!existsSync(wuPath)) {
    console.warn(
      `${PREFIX} Warning: ${activeWuid} referenced in status.md but ${wuPath} not found`,
    );
    return null;
  }

  try {
    const wuContent = readFileSync(wuPath, { encoding: 'utf-8' });
    const wuDoc = parseYAML(wuContent) as WUDoc;

    if (!wuDoc || !wuDoc.lane) {
      console.warn(`${PREFIX} Warning: ${activeWuid} has no lane field`);
      return null;
    }

    // Normalize lane names for comparison (case-insensitive, trim whitespace)
    const activeLane = wuDoc.lane.toString().trim().toLowerCase();

    if (activeLane === targetLane) {
      return activeWuid;
    }
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : String(e);

    console.warn(`${PREFIX} Warning: Failed to parse ${activeWuid} YAML: ${errMessage}`);
  }

  return null;
}

/**
 * WU-1197: Collect WUs in the target lane from matched WU links
 */
function collectInProgressWUsForLane(
  matches: RegExpMatchArray[],
  wuid: string,
  wuDir: string,
  targetLane: string,
): string[] {
  const inProgressWUs: string[] = [];

  for (const match of matches) {
    const activeWuid = match[1]; // e.g., "WU-334"
    if (!activeWuid) {
      continue;
    }
    const matchedWu = checkWuLaneMatch(activeWuid, wuid, wuDir, targetLane);
    if (matchedWu) {
      inProgressWUs.push(matchedWu);
    }
  }

  return inProgressWUs;
}

/**
 * WU-1324: Extract WU IDs from a section's WU links and filter by target lane
 * @param section - Section content from status.md
 * @param wuid - WU ID being claimed (excluded from results)
 * @param wuDir - Absolute path to configured WU directory
 * @param targetLane - Target lane name (normalized lowercase)
 * @returns Array of WU IDs in the target lane
 */
function extractWUsFromSection(
  section: string,
  wuid: string,
  wuDir: string,
  targetLane: string,
): string[] {
  if (!section || section.includes(NO_ITEMS_MARKER)) {
    return [];
  }

  // Extract WU IDs from links like [WU-334 — Title](wu/WU-334.yaml)
  WU_LINK_PATTERN.lastIndex = 0; // Reset global regex state
  const matches = [...section.matchAll(WU_LINK_PATTERN)];

  if (matches.length === 0) {
    return [];
  }

  return collectInProgressWUsForLane(matches, wuid, wuDir, targetLane);
}

/**
 * Check if a lane is free (WU count is below wip_limit)
 *
 * WU-1016: Now respects configurable wip_limit per lane from workspace.yaml.
 * Lane is considered "free" if current WU count < wip_limit.
 * Default wip_limit is 1 if not specified in config (backward compatible).
 *
 * WU-1324: Now respects lock_policy for WIP counting:
 * - 'all' (default): Count in_progress + blocked WUs toward WIP limit
 * - 'active': Count only in_progress WUs (blocked WUs release lane lock)
 * - 'none': Disable WIP checking entirely (lane always free)
 *
 * @param {string} statusPath - Path to status.md
 * @param {string} lane - Lane name (e.g., "Operations", "Intelligence")
 * @param {string} wuid - WU ID being claimed (e.g., "WU-419")
 * @param {CheckLaneFreeOptions} options - Options including configPath for testing
 * @returns {{ free: boolean, occupiedBy: string | null, error: string | null, inProgressWUs?: string[], wipLimit?: number, currentCount?: number }}
 */
export function checkLaneFree(
  statusPath: string,
  lane: string,
  wuid: string,
  options: CheckLaneFreeOptions = {},
): CheckLaneFreeResult {
  try {
    // WU-1016: Get WIP limit for this lane from config
    const wipLimit = getWipLimitForLane(lane, { configPath: options.configPath });

    // WU-1324: Get lock policy for this lane from config
    const lockPolicy = getLockPolicyForLane(lane, { configPath: options.configPath });

    // WU-1324: If policy is 'none', WIP checking is disabled - lane is always free
    if (lockPolicy === 'none') {
      return createEmptyLaneResult(wipLimit);
    }

    // Read status.md
    if (!existsSync(statusPath)) {
      return { free: false, occupiedBy: null, error: `status.md not found: ${statusPath}` };
    }

    const content = readFileSync(statusPath, { encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);

    // Extract In Progress section
    const { section: inProgressSection, error } = extractInProgressSection(lines);
    if (error) {
      return { free: false, occupiedBy: null, error };
    }

    // Resolve from statusPath location (config-driven, no fixed-depth path assumptions).
    const resolvedStatusPath = path.resolve(statusPath);
    const projectRoot = findProjectRoot(path.dirname(resolvedStatusPath));
    const wuDir = path.join(projectRoot, getConfig({ projectRoot }).directories.wuDir);
    const targetLane = lane.toString().trim().toLowerCase();

    // Collect in_progress WUs
    const inProgressWUs = extractWUsFromSection(inProgressSection, wuid, wuDir, targetLane);

    // WU-1324: If policy is 'all', also count blocked WUs
    let blockedWUs: string[] = [];
    if (lockPolicy === 'all') {
      const { section: blockedSection } = extractBlockedSection(lines);
      blockedWUs = extractWUsFromSection(blockedSection, wuid, wuDir, targetLane);
    }

    // WU-1324: Calculate total count based on policy
    // - 'all': in_progress + blocked
    // - 'active': in_progress only
    const allCountedWUs = [...inProgressWUs, ...blockedWUs];
    const currentCount = allCountedWUs.length;
    const isFree = currentCount < wipLimit;

    return {
      free: isFree,
      occupiedBy: isFree ? null : allCountedWUs[0] || null,
      error: null,
      inProgressWUs: allCountedWUs, // Include all counted WUs for visibility
      wipLimit,
      currentCount,
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { free: false, occupiedBy: null, error: `Unexpected error: ${errMessage}` };
  }
}

/** WU-1187: Options for checkWipJustification */
interface CheckWipJustificationOptions {
  /** Optional config path override for testing */
  configPath?: string;
}

/** WU-1187: Result of WIP justification check */
interface CheckWipJustificationResult {
  /** Always true - this is soft enforcement (warning only) */
  valid: boolean;
  /** Warning message if WIP > 1 without justification, null otherwise */
  warning: string | null;
  /** True if the lane needs justification but doesn't have one */
  requiresJustification: boolean;
  /** The wip_justification from config, if present */
  justification?: string;
}

/** WU-1187: Default result when no justification is required */
const NO_JUSTIFICATION_REQUIRED: CheckWipJustificationResult = {
  valid: true,
  warning: null,
  requiresJustification: false,
};

/**
 * WU-1187: Extract all lanes from config (handles all config formats)
 * @param config - Parsed LumenFlow config
 * @returns Array of lane configs with wip settings
 */
function extractAllLanesFromConfig(config: LumenflowConfig): LaneConfigWithWip[] {
  if (!config.lanes) {
    return [];
  }

  if (Array.isArray(config.lanes)) {
    // Flat array format: lanes: [{name: "Core", wip_limit: 2}, ...]
    return config.lanes;
  }

  // Nested formats with definitions, engineering, business
  const allLanes: LaneConfigWithWip[] = [];
  if (config.lanes.definitions) {
    allLanes.push(...config.lanes.definitions);
  }
  if (config.lanes.engineering) {
    allLanes.push(...config.lanes.engineering);
  }
  if (config.lanes.business) {
    allLanes.push(...config.lanes.business);
  }
  return allLanes;
}

/**
 * WU-1187: Check if a lane has WIP justification when required
 *
 * Philosophy: If you need WIP > 1, you need better lanes, not higher limits.
 * This is soft enforcement: logs a warning at claim time, but doesn't block.
 *
 * @param {string} lane - Lane name to check
 * @param {CheckWipJustificationOptions} options - Options including configPath for testing
 * @returns {CheckWipJustificationResult} Result with valid=true (always) and optional warning
 */
export function checkWipJustification(
  lane: string,
  options: CheckWipJustificationOptions = {},
): CheckWipJustificationResult {
  const config = coerceConfig(
    options.configPath
      ? readConfigFromPath(options.configPath)
      : readRuntimeConfig(findProjectRoot()),
  );
  if (!config) {
    return NO_JUSTIFICATION_REQUIRED;
  }

  const allLanes = extractAllLanesFromConfig(config);
  if (allLanes.length === 0) {
    return NO_JUSTIFICATION_REQUIRED;
  }

  const normalizedLane = lane.toLowerCase().trim();
  const matchingLane = allLanes.find((l) => l.name.toLowerCase().trim() === normalizedLane);

  if (!matchingLane) {
    return NO_JUSTIFICATION_REQUIRED;
  }

  const wipLimit = matchingLane.wip_limit ?? DEFAULT_WIP_LIMIT;
  if (wipLimit <= 1) {
    return NO_JUSTIFICATION_REQUIRED;
  }

  const justification = matchingLane.wip_justification;
  if (justification && justification.trim().length > 0) {
    return {
      valid: true,
      warning: null,
      requiresJustification: false,
      justification: justification.trim(),
    };
  }

  const warning =
    `Lane "${lane}" has WIP limit of ${wipLimit} but no wip_justification. ` +
    `Philosophy: If you need WIP > 1, you need better lanes, not higher limits. ` +
    `Add wip_justification under ${LANE_DEFINITIONS_HINT} to suppress this warning.`;

  return {
    valid: true,
    warning,
    requiresJustification: true,
  };
}
