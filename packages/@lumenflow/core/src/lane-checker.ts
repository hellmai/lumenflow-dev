#!/usr/bin/env node
/**
 * Lane Occupancy Checker
 *
 * Enforces one-WU-per-lane rule by checking status.md for active WUs in a given lane.
 * Used by wu-claim.mjs and wu-unblock.mjs to prevent WIP violations.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { getSubLanesForParent } from './lane-inference.js';
import { createError, ErrorCodes } from './error-handler.js';
import { isInProgressHeader, WU_LINK_PATTERN } from './constants/backlog-patterns.js';
import { CONFIG_FILES, FILE_SYSTEM, STRING_LITERALS } from './wu-constants.js';
import { WU_PATHS } from './wu-paths.js';
import { findProjectRoot } from './lumenflow-config.js';

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
  /** Path to .lumenflow.config.yaml (for testing) */
  configPath?: string;
}

/** WU-1016: Options for getWipLimitForLane */
interface GetWipLimitOptions {
  /** Path to .lumenflow.config.yaml (for testing) */
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
interface LaneConfigWithWip extends LaneConfig {
  wip_limit?: number;
}

interface WUDoc {
  lane?: string;
}

// Re-export for test access
export { getSubLanesForParent };

/** Log prefix for lane-checker messages */
const PREFIX = '[lane-checker]';

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
    const taxonomy = yaml.load(taxonomyContent) as Record<string, unknown>;

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
    const taxonomy = yaml.load(taxonomyContent) as Record<string, Record<string, unknown>>;

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

  // Check for colon
  const colonIndex = trimmed.indexOf(LANE_SEPARATOR);

  if (colonIndex !== -1) {
    // Sub-lane format validation

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

    // Extract parent and subdomain (colonIndex + 2 = skip colon and space)
    const parent = trimmed.substring(0, colonIndex).trim();
    const subdomain = trimmed.substring(colonIndex + LANE_SEPARATOR.length + SPACE.length).trim();

    // Validate parent exists in config
    if (!isValidParentLane(parent, configPath)) {
      throw createError(
        ErrorCodes.INVALID_LANE,
        `Unknown parent lane: "${parent}". Check ${CONFIG_FILES.LUMENFLOW_CONFIG} for valid lanes.`,
        { parent, lane },
      );
    }

    // Validate sub-lane exists in taxonomy
    if (hasSubLaneTaxonomy(parent)) {
      // Parent has taxonomy - validate sub-lane
      if (!isValidSubLane(parent, subdomain)) {
        const validSubLanes = getSubLanesForParent(parent);
        throw createError(
          ErrorCodes.INVALID_LANE,
          `Unknown sub-lane: "${subdomain}" for parent lane "${parent}".\n\n` +
            `Valid sub-lanes: ${validSubLanes.join(', ')}`,
          { parent, subdomain, validSubLanes },
        );
      }
    } else {
      // Parent has no taxonomy - reject sub-lane format
      throw createError(
        ErrorCodes.INVALID_LANE,
        `Parent lane "${parent}" does not support sub-lanes. Use parent-only format or extend ${CONFIG_FILES.LANE_INFERENCE}.`,
        { parent, lane },
      );
    }

    return { valid: true, parent, error: null };
  } else {
    // Parent-only format
    if (!isValidParentLane(trimmed, configPath)) {
      throw createError(
        ErrorCodes.INVALID_LANE,
        `Unknown parent lane: "${trimmed}". Check ${CONFIG_FILES.LUMENFLOW_CONFIG} for valid lanes.`,
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
        // Strict mode (default): throw error for new WUs
        throw createError(ErrorCodes.INVALID_LANE, message, { lane: trimmed, validSubLanes });
      } else {
        // Non-strict mode: warn only for existing WU validation
        console.warn(`${PREFIX} ⚠️  ${message}`);
      }
    }

    return { valid: true, parent: trimmed, error: null };
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
  // Determine config path
  let resolvedConfigPath = configPath;
  if (!resolvedConfigPath) {
    const projectRoot = findProjectRoot();
    resolvedConfigPath = path.join(projectRoot, CONFIG_FILES.LUMENFLOW_CONFIG);
  }

  // Read and parse config
  if (!existsSync(resolvedConfigPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Config file not found: ${resolvedConfigPath}`, {
      path: resolvedConfigPath,
    });
  }

  const configContent = readFileSync(resolvedConfigPath, { encoding: 'utf-8' });
  const config = yaml.load(configContent) as LumenflowConfig;

  // Extract all lane names - handle multiple config formats
  const allLanes: string[] = [];
  const parentLanes = new Set<string>();

  if (config.lanes) {
    if (Array.isArray(config.lanes)) {
      // Flat array format: lanes: [{name: "Core"}, {name: "CLI"}, ...]
      allLanes.push(...config.lanes.map((l) => l.name));
    } else {
      // WU-1022: New format with lanes.definitions containing full "Parent: Sublane" names
      if (config.lanes.definitions) {
        for (const lane of config.lanes.definitions) {
          allLanes.push(lane.name);
          // Extract parent from full lane name for parent validation
          const extractedParent = extractParent(lane.name);
          parentLanes.add(extractedParent.toLowerCase().trim());
        }
      }

      // Legacy nested format: lanes: {engineering: [...], business: [...]}
      if (config.lanes.engineering) {
        allLanes.push(...config.lanes.engineering.map((l) => l.name));
      }
      if (config.lanes.business) {
        allLanes.push(...config.lanes.business.map((l) => l.name));
      }
    }
  }

  // Case-insensitive comparison
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
 * Reads the wip_limit field from .lumenflow.config.yaml for the specified lane.
 * Returns DEFAULT_WIP_LIMIT (1) if the lane is not found or wip_limit is not specified.
 *
 * @param {string} lane - Lane name (e.g., "Core", "CLI")
 * @param {GetWipLimitOptions} options - Options including configPath for testing
 * @returns {number} The WIP limit for the lane (default: 1)
 */
export function getWipLimitForLane(lane: string, options: GetWipLimitOptions = {}): number {
  // Determine config path
  let resolvedConfigPath = options.configPath;
  if (!resolvedConfigPath) {
    const projectRoot = findProjectRoot();
    resolvedConfigPath = path.join(projectRoot, CONFIG_FILES.LUMENFLOW_CONFIG);
  }

  // Check if config file exists
  if (!existsSync(resolvedConfigPath)) {
    return DEFAULT_WIP_LIMIT;
  }

  try {
    const configContent = readFileSync(resolvedConfigPath, { encoding: 'utf-8' });
    const config = yaml.load(configContent) as LumenflowConfig;

    if (!config.lanes) {
      return DEFAULT_WIP_LIMIT;
    }

    // Normalize lane name for case-insensitive comparison
    const normalizedLane = lane.toLowerCase().trim();

    // Extract all lanes with their wip_limit
    let allLanes: LaneConfigWithWip[] = [];
    if (Array.isArray(config.lanes)) {
      // Flat array format: lanes: [{name: "Core", wip_limit: 2}, ...]
      allLanes = config.lanes;
    } else {
      // Nested format: lanes: {engineering: [...], business: [...]}
      if (config.lanes.engineering) {
        allLanes.push(...config.lanes.engineering);
      }
      if (config.lanes.business) {
        allLanes.push(...config.lanes.business);
      }
    }

    // Find matching lane (case-insensitive)
    const matchingLane = allLanes.find((l) => l.name.toLowerCase().trim() === normalizedLane);

    if (!matchingLane) {
      return DEFAULT_WIP_LIMIT;
    }

    // Return wip_limit if specified, otherwise default
    return matchingLane.wip_limit ?? DEFAULT_WIP_LIMIT;
  } catch {
    // If config parsing fails, return default
    return DEFAULT_WIP_LIMIT;
  }
}

/**
 * Check if a lane is free (in_progress WU count is below wip_limit)
 *
 * WU-1016: Now respects configurable wip_limit per lane from .lumenflow.config.yaml.
 * Lane is considered "free" if current in_progress count < wip_limit.
 * Default wip_limit is 1 if not specified in config (backward compatible).
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
  /** Section heading marker for H2 headings */
  const SECTION_HEADING_PREFIX = '## ';

  try {
    // Read status.md
    if (!existsSync(statusPath)) {
      return { free: false, occupiedBy: null, error: `status.md not found: ${statusPath}` };
    }

    const content = readFileSync(statusPath, { encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);

    // Find "## In Progress" section
    const inProgressIdx = lines.findIndex((l) => isInProgressHeader(l));

    if (inProgressIdx === -1) {
      return {
        free: false,
        occupiedBy: null,
        error: 'Could not find "## In Progress" section in status.md',
      };
    }

    // Find end of In Progress section (next ## heading or end of file)
    let endIdx = lines
      .slice(inProgressIdx + 1)
      .findIndex((l) => l.startsWith(SECTION_HEADING_PREFIX));
    if (endIdx === -1) endIdx = lines.length - inProgressIdx - 1;
    else endIdx = inProgressIdx + 1 + endIdx;

    // Extract WU links from In Progress section
    const section = lines.slice(inProgressIdx + 1, endIdx).join(STRING_LITERALS.NEWLINE);

    // WU-1016: Get WIP limit for this lane from config
    const wipLimit = getWipLimitForLane(lane, { configPath: options.configPath });

    // Check for "No items" marker
    if (section.includes(NO_ITEMS_MARKER)) {
      return {
        free: true,
        occupiedBy: null,
        error: null,
        inProgressWUs: [],
        wipLimit,
        currentCount: 0,
      };
    }

    // Extract WU IDs from links like [WU-334 — Title](wu/WU-334.yaml)
    WU_LINK_PATTERN.lastIndex = 0; // Reset global regex state
    const matches = [...section.matchAll(WU_LINK_PATTERN)];

    if (matches.length === 0) {
      return {
        free: true,
        occupiedBy: null,
        error: null,
        inProgressWUs: [],
        wipLimit,
        currentCount: 0,
      };
    }

    // Get project root from statusPath (docs/04-operations/tasks/status.md)
    // Use path.dirname 4 times: status.md -> tasks -> 04-operations -> docs -> root
    const projectRoot = path.dirname(path.dirname(path.dirname(path.dirname(statusPath))));

    // WU-1016: Collect all WUs in the target lane
    const inProgressWUs: string[] = [];
    const targetLane = lane.toString().trim().toLowerCase();

    for (const match of matches) {
      const activeWuid = match[1]; // e.g., "WU-334"

      // Skip if it's the same WU we're trying to claim (shouldn't happen, but be safe)
      if (activeWuid === wuid) continue;

      // Use WU_PATHS to build the path consistently
      const wuPath = path.join(projectRoot, WU_PATHS.WU(activeWuid));

      if (!existsSync(wuPath)) {
        console.warn(
          `${PREFIX} Warning: ${activeWuid} referenced in status.md but ${wuPath} not found`,
        );
        continue;
      }

      try {
        const wuContent = readFileSync(wuPath, { encoding: 'utf-8' });
        const wuDoc = yaml.load(wuContent) as WUDoc;

        if (!wuDoc || !wuDoc.lane) {
          console.warn(`${PREFIX} Warning: ${activeWuid} has no lane field`);
          continue;
        }

        // Normalize lane names for comparison (case-insensitive, trim whitespace)
        const activeLane = wuDoc.lane.toString().trim().toLowerCase();

        if (activeLane === targetLane) {
          // WU-1016: Add to list of in-progress WUs in this lane
          inProgressWUs.push(activeWuid);
        }
      } catch (e) {
        const errMessage = e instanceof Error ? e.message : String(e);
        console.warn(`${PREFIX} Warning: Failed to parse ${activeWuid} YAML: ${errMessage}`);
        continue;
      }
    }

    // WU-1016: Check if lane is free based on WIP limit
    const currentCount = inProgressWUs.length;
    const isFree = currentCount < wipLimit;

    return {
      free: isFree,
      occupiedBy: isFree ? null : inProgressWUs[0] || null,
      error: null,
      inProgressWUs,
      wipLimit,
      currentCount,
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { free: false, occupiedBy: null, error: `Unexpected error: ${errMessage}` };
  }
}
