/**
 * Dependency Validator (WU-2202)
 *
 * Validates that required dependencies are available before tool execution.
 * Prevents silent failures when node_modules is corrupted or incomplete.
 *
 * Background: During INIT-038 orchestration, wu:spawn incorrectly reported
 * lanes as occupied when the yaml package was missing from node_modules.
 * The tool read lock files but failed silently and reported wrong data.
 *
 * This module provides:
 * - validateDependencies(): Check if packages can be imported
 * - formatDependencyError(): Generate clear error messages
 * - TOOL_DEPENDENCIES: Map of tools to their required packages
 *
 * @see WU-2202 - Fix false lane occupancy when deps broken
 */

import { EMOJI, LOG_PREFIX } from './wu-constants.js';

/**
 * Map of tools to their required npm packages.
 *
 * Each tool lists the packages it needs to function correctly.
 * These are checked before tool execution to prevent silent failures.
 *
 * @type {Record<string, string[]>}
 */
export const TOOL_DEPENDENCIES = Object.freeze({
  'wu:spawn': ['yaml', 'minimatch', 'commander'],
  'wu:claim': ['yaml', 'commander'],
  'wu:done': ['yaml', 'commander'],
  'wu:block': ['yaml', 'commander'],
  'wu:unblock': ['yaml', 'commander'],
  'mem:inbox': ['ms', 'commander'],
  'mem:signal': ['commander'],
  'mem:ready': ['commander'],
  'mem:checkpoint': ['commander'],
});

/**
 * Check if a package can be imported.
 *
 * Uses dynamic import to test package availability.
 * Returns false if the package cannot be loaded.
 *
 * @param {string} packageName - Name of the package to check
 * @returns {Promise<boolean>} True if package is available
 */
async function canImport(packageName) {
  try {
    await import(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that required dependencies are available.
 *
 * @param {string[]} packages - List of package names to check
 * @returns {Promise<{valid: boolean, missing: string[]}>} Validation result
 *
 * @example
 * const result = await validateDependencies(['yaml', 'ms']);
 * if (!result.valid) {
 *   console.error(`Missing: ${result.missing.join(', ')}`);
 * }
 */
export async function validateDependencies(packages) {
  if (!packages || packages.length === 0) {
    return { valid: true, missing: [] };
  }

  const missing = [];

  for (const pkg of packages) {
    const available = await canImport(pkg);
    if (!available) {
      missing.push(pkg);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Format an error message for missing dependencies.
 *
 * @param {string} toolName - Name of the tool (e.g., 'wu:spawn')
 * @param {string[]} missing - List of missing package names
 * @returns {string} Formatted error message with fix instructions
 *
 * @example
 * const msg = formatDependencyError('wu:spawn', ['yaml']);
 * console.error(msg);
 */
export function formatDependencyError(toolName, missing) {
  const packageList = missing.map((p) => `  - ${p}`).join('\n');

  return `${EMOJI.ERROR} ${toolName} cannot run: missing dependencies

The following packages are required but not available:
${packageList}

This usually means node_modules is corrupted or incomplete.

TO FIX:
  1. Run: pnpm install
  2. If that fails, try: rm -rf node_modules && pnpm install

If the issue persists, check that the packages are listed in package.json
and that there are no pnpm virtual-store errors.

${LOG_PREFIX} Missing packages: ${missing.join(', ')}`;
}

/**
 * Validate dependencies for wu:spawn.
 *
 * Convenience function that validates wu:spawn's required packages.
 * Called before lane lock check to prevent false positives.
 *
 * @returns {Promise<{valid: boolean, missing: string[]}>} Validation result
 */
export async function validateSpawnDependencies() {
  return validateDependencies(TOOL_DEPENDENCIES['wu:spawn']);
}

/**
 * Validate dependencies for mem:inbox.
 *
 * Convenience function that validates mem:inbox's required packages.
 *
 * @returns {Promise<{valid: boolean, missing: string[]}>} Validation result
 */
export async function validateInboxDependencies() {
  return validateDependencies(TOOL_DEPENDENCIES['mem:inbox']);
}

/**
 * Validate dependencies for a specific tool.
 *
 * @param {string} toolName - Name of the tool (e.g., 'wu:spawn', 'mem:inbox')
 * @returns {Promise<{valid: boolean, missing: string[], toolName: string}>} Validation result
 *
 * @example
 * const result = await validateToolDependencies('wu:spawn');
 * if (!result.valid) {
 *   console.error(formatDependencyError(result.toolName, result.missing));
 *   process.exit(1);
 * }
 */
export async function validateToolDependencies(toolName) {
  const deps = TOOL_DEPENDENCIES[toolName] || [];
  const result = await validateDependencies(deps);
  return {
    ...result,
    toolName,
  };
}
