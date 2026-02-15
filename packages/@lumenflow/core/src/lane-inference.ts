/**
 * Lane Inference Module (WU-906)
 *
 * Provides automated sub-lane suggestion based on WU code_paths and description.
 * Uses config-driven pattern matching with confidence scoring.
 *
 * Inference is suggestion only (not enforcement). Track accuracy for future tuning.
 *
 * Uses industry-standard libraries:
 * - micromatch for robust glob matching (28x faster than minimatch)
 * - yaml for modern YAML parsing (actively maintained, YAML 1.2 compliant)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml'; // Modern YAML library (not js-yaml)
import micromatch from 'micromatch'; // Industry-standard glob matching (CommonJS)
import { extractParent } from './lane-checker.js'; // Shared utility (WU-1137: consolidation)
import { createError, ErrorCodes } from './error-handler.js';
import { WEIGHTS, CONFIDENCE } from './wu-validation-constants.js';
import { findProjectRoot } from './lumenflow-config.js';

interface SubLaneConfig {
  code_paths?: string[];
  keywords?: string[];
}

type LaneInferenceConfig = Record<string, Record<string, SubLaneConfig>>;

interface LaneScore {
  lane: string;
  confidence: number;
  parent: string;
  subLane: string;
}

interface LaneInferenceResult {
  lane: string;
  confidence: number;
}

/**
 * Load lane inference config from project root
 * @param {string|null} configPath - Optional path to config file (defaults to project root)
 * @returns {object} Parsed config object
 * @throws {Error} If config file not found or YAML parsing fails
 */
function loadConfig(configPath: string | null = null): LaneInferenceConfig {
  let resolvedConfigPath = configPath;
  if (!resolvedConfigPath) {
    // Use findProjectRoot() to locate config from cwd
    const projectRoot = findProjectRoot();
    resolvedConfigPath = path.join(projectRoot, '.lumenflow.lane-inference.yaml');
  }

  if (!existsSync(resolvedConfigPath)) {
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Lane inference config not found: ${resolvedConfigPath}\n\n` +
        `This file defines the lane taxonomy for sub-lane validation.\n\n` +
        `To fix this:\n` +
        `  1. Generate a lane taxonomy from your codebase:\n` +
        `     pnpm lane:suggest --output .lumenflow.lane-inference.yaml\n\n` +
        `  2. Or copy from an example project and customize.\n\n` +
        `See: LUMENFLOW.md "Setup Notes" section for details.`,
      { path: resolvedConfigPath },
    );
  }

  try {
    const configContent = readFileSync(resolvedConfigPath, { encoding: 'utf-8' });
    const parsed = YAML.parse(configContent) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createError(
        ErrorCodes.YAML_PARSE_ERROR,
        `Failed to parse lane inference config: ${resolvedConfigPath}\n\n` +
          `Config must be a mapping of parent lanes to sub-lane config objects.`,
        { path: resolvedConfigPath },
      );
    }
    return parsed as LaneInferenceConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createError(
      ErrorCodes.YAML_PARSE_ERROR,
      `Failed to parse lane inference config: ${resolvedConfigPath}\n\n${message}\n\n` +
        `Ensure config is valid YAML.`,
      { path: resolvedConfigPath, originalError: message },
    );
  }
}

/**
 * Check if a code path matches a glob pattern using micromatch
 * @param {string} codePath - Actual code path from WU
 * @param {string} pattern - Glob pattern from config (e.g., "tools/**", "*.ts")
 * @returns {boolean} True if path matches pattern
 */
function matchesPattern(codePath: string, pattern: string): boolean {
  // Use micromatch for robust, fast glob matching (industry standard)
  // 28x faster than minimatch, used by webpack/babel/jest
  return micromatch.isMatch(codePath, pattern, { nocase: true });
}

/**
 * Check if description contains a keyword (case-insensitive match)
 * @param {string} description - WU description text
 * @param {string} keyword - Keyword to search for
 * @returns {boolean} True if keyword found in description
 */
function containsKeyword(description: string, keyword: string): boolean {
  const normalizedDesc = description.toLowerCase().trim();
  const normalizedKeyword = keyword.toLowerCase().trim();

  // Simple substring match (sufficient for keyword detection)
  return normalizedDesc.includes(normalizedKeyword);
}

/**
 * Calculate confidence score for a sub-lane match
 *
 * WU-2438: Changed from percentage-based to absolute scoring.
 * Previously, confidence = (score / maxPossibleScore) * 100, which penalized
 * lanes with more patterns/keywords even when they had MORE matches.
 *
 * Now, confidence = raw score, so lanes with more matches win.
 * This is more intuitive: 4 signals beats 1 signal, regardless of config size.
 *
 * @param {string[]} codePaths - WU code paths
 * @param {string} description - WU description
 * @param {object} subLaneConfig - Sub-lane config (code_paths, keywords)
 * @returns {number} Confidence score (raw score, higher = better match)
 */
function calculateConfidence(
  codePaths: string[],
  description: string,
  subLaneConfig: SubLaneConfig,
): number {
  let score = 0;

  // Score code path matches
  const patterns = subLaneConfig.code_paths || [];
  for (const pattern of patterns) {
    const hasMatch = codePaths.some((cp) => matchesPattern(cp, pattern));
    if (hasMatch) {
      score += WEIGHTS.CODE_PATH_MATCH;
    }
  }

  // Score keyword matches
  const keywords = subLaneConfig.keywords || [];
  for (const keyword of keywords) {
    if (containsKeyword(description, keyword)) {
      score += WEIGHTS.KEYWORD_MATCH;
    }
  }

  return score;
}

/**
 * Infer sub-lane from WU code paths and description
 * @param {string[]} codePaths - Array of file paths modified/created by this WU
 * @param {string} description - WU description/title text
 * @param {string|null} configPath - Optional path to config file
 * @returns {{ lane: string, confidence: number }} Suggested sub-lane and confidence (0-100)
 * @throws {Error} If config cannot be loaded
 */
export function inferSubLane(
  codePaths: string[],
  description: string,
  configPath: string | null = null,
): LaneInferenceResult {
  // Validate inputs
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

  // Load config
  const config = loadConfig(configPath);

  // Score all sub-lanes
  const scores: LaneScore[] = [];
  for (const [parentLane, subLanes] of Object.entries(config)) {
    for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
      const confidence = calculateConfidence(codePaths, description, subLaneConfig);
      const fullLaneName = `${parentLane}: ${subLane}`;

      scores.push({
        lane: fullLaneName,
        confidence,
        parent: parentLane,
        subLane,
      });
    }
  }

  // Sort by confidence (descending)
  scores.sort((a, b) => b.confidence - a.confidence);

  // Return highest scoring sub-lane
  const best = scores[0];

  if (!best || best.confidence < CONFIDENCE.THRESHOLD) {
    // No good matches found, return parent-only suggestion
    // This shouldn't happen with CONFIDENCE.THRESHOLD=0, but keep for future tuning
    return {
      lane: best ? best.parent : 'Operations', // Default to Operations if all else fails
      confidence: CONFIDENCE.MIN,
    };
  }

  return {
    lane: best.lane,
    confidence: best.confidence,
  };
}

/**
 * Get all valid sub-lanes from config
 * @param {string|null} configPath - Optional path to config file
 * @returns {string[]} Array of all sub-lane names (format: "Parent: Subdomain")
 */
export function getAllSubLanes(configPath: string | null = null): string[] {
  const config = loadConfig(configPath);
  const subLanes: string[] = [];

  for (const [parentLane, subLaneConfigs] of Object.entries(config)) {
    for (const subLane of Object.keys(subLaneConfigs)) {
      subLanes.push(`${parentLane}: ${subLane}`);
    }
  }

  return subLanes.sort((a, b) => a.localeCompare(b));
}

/**
 * Get valid sub-lanes for a specific parent lane
 * @param {string} parent - Parent lane name (e.g., "Operations", "Core Systems")
 * @param {string|null} configPath - Optional path to config file
 * @returns {string[]} Array of sub-lane names for that parent (e.g., ["Tooling", "CI/CD", ...])
 */
export function getSubLanesForParent(parent: string, configPath: string | null = null): string[] {
  const config = loadConfig(configPath);

  // Find parent key (case-insensitive)
  const normalizedParent = parent.trim().toLowerCase();
  const parentKey = Object.keys(config).find(
    (key) => key.toLowerCase().trim() === normalizedParent,
  );

  if (!parentKey) {
    return [];
  }

  // Return sub-lane names for this parent
  const subLanes = config[parentKey];
  if (!subLanes || typeof subLanes !== 'object') {
    return [];
  }

  return Object.keys(subLanes);
}

// Re-export extractParent from lane-checker for backward compatibility (WU-1137: consolidation)
export { extractParent };
