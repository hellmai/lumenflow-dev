/**
 * LumenFlow Home Directory Resolution
 *
 * WU-1062: External plan storage and no-main-write mode
 *
 * Provides helpers for resolving the $LUMENFLOW_HOME directory and related paths.
 * Plans are stored externally in $LUMENFLOW_HOME/plans/ instead of in the repo.
 *
 * Default: ~/.lumenflow/
 * Override: Set $LUMENFLOW_HOME environment variable
 *
 * @module
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Environment variable name for LumenFlow home directory
 */
export const LUMENFLOW_HOME_ENV = 'LUMENFLOW_HOME';

/**
 * Default LumenFlow home directory name
 */
export const DEFAULT_LUMENFLOW_DIR = '.lumenflow';

/**
 * Plans subdirectory name
 */
export const PLANS_SUBDIR = 'plans';

/**
 * Custom protocol for external LumenFlow paths
 */
export const LUMENFLOW_PROTOCOL = 'lumenflow://';

/**
 * Environment variable prefix for spec_refs
 */
export const LUMENFLOW_HOME_VAR_PREFIX = '$LUMENFLOW_HOME';

/**
 * Expand ~ to user's home directory
 *
 * @param {string} path - Path that may contain ~
 * @returns {string} Expanded path
 */
function expandTilde(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  if (path === '~') {
    return homedir();
  }
  return path;
}

/**
 * Remove trailing slashes from path
 *
 * @param {string} path - Path that may have trailing slashes
 * @returns {string} Path without trailing slashes
 */
function removeTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * Get the LumenFlow home directory path
 *
 * Resolution order:
 * 1. $LUMENFLOW_HOME environment variable (with ~ expansion)
 * 2. ~/.lumenflow/ default
 *
 * @returns {string} Absolute path to LumenFlow home directory
 *
 * @example
 * // With LUMENFLOW_HOME=/custom/path
 * getLumenflowHome() // '/custom/path'
 *
 * @example
 * // With LUMENFLOW_HOME=~/.custom-lumenflow
 * getLumenflowHome() // '/home/user/.custom-lumenflow'
 *
 * @example
 * // Without LUMENFLOW_HOME set
 * getLumenflowHome() // '/home/user/.lumenflow'
 */
export function getLumenflowHome(): string {
  const envValue = process.env[LUMENFLOW_HOME_ENV];

  if (envValue) {
    const expanded = expandTilde(envValue);
    return removeTrailingSlash(expanded);
  }

  return join(homedir(), DEFAULT_LUMENFLOW_DIR);
}

/**
 * Get the plans directory path
 *
 * Plans are stored in $LUMENFLOW_HOME/plans/
 *
 * @returns {string} Absolute path to plans directory
 *
 * @example
 * getPlansDir() // '/home/user/.lumenflow/plans'
 */
export function getPlansDir(): string {
  return join(getLumenflowHome(), PLANS_SUBDIR);
}

/**
 * Check if a path is an external (non-repo) path
 *
 * External paths include:
 * - Paths starting with ~/
 * - Paths starting with $LUMENFLOW_HOME
 * - Paths using lumenflow:// protocol
 * - Absolute paths (starting with /)
 *
 * @param {string} path - Path to check
 * @returns {boolean} True if path is external
 *
 * @example
 * isExternalPath('~/.lumenflow/plans/plan.md') // true
 * isExternalPath('$LUMENFLOW_HOME/plans/plan.md') // true
 * isExternalPath('lumenflow://plans/plan.md') // true
 * isExternalPath('/home/user/.lumenflow/plans/plan.md') // true
 * isExternalPath('docs/04-operations/plans/plan.md') // false
 */
export function isExternalPath(path: string): boolean {
  // Check for tilde-prefixed paths
  if (path.startsWith('~/')) {
    return true;
  }

  // Check for environment variable reference
  if (path.startsWith(LUMENFLOW_HOME_VAR_PREFIX)) {
    return true;
  }

  // Check for lumenflow:// protocol
  if (path.startsWith(LUMENFLOW_PROTOCOL)) {
    return true;
  }

  // Check for absolute paths (starting with /)
  if (path.startsWith('/')) {
    return true;
  }

  return false;
}

/**
 * Normalize a spec_ref path by expanding variables and protocols
 *
 * Expands:
 * - lumenflow://path -> $LUMENFLOW_HOME/path
 * - ~/path -> /home/user/path
 * - $LUMENFLOW_HOME/path -> actual LUMENFLOW_HOME value
 *
 * Repo-relative paths are returned unchanged.
 *
 * @param {string} specRef - Spec reference path
 * @returns {string} Normalized absolute path or unchanged relative path
 *
 * @example
 * normalizeSpecRef('lumenflow://plans/WU-1062-plan.md')
 * // '/home/user/.lumenflow/plans/WU-1062-plan.md'
 *
 * @example
 * normalizeSpecRef('docs/04-operations/plans/plan.md')
 * // 'docs/04-operations/plans/plan.md' (unchanged)
 */
export function normalizeSpecRef(specRef: string): string {
  // Handle lumenflow:// protocol
  if (specRef.startsWith(LUMENFLOW_PROTOCOL)) {
    const relativePath = specRef.slice(LUMENFLOW_PROTOCOL.length);
    return join(getLumenflowHome(), relativePath);
  }

  // Handle $LUMENFLOW_HOME variable
  if (specRef.startsWith(LUMENFLOW_HOME_VAR_PREFIX)) {
    const relativePath = specRef.slice(LUMENFLOW_HOME_VAR_PREFIX.length);
    // Remove leading slash if present
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return join(getLumenflowHome(), cleanPath);
  }

  // Handle tilde expansion
  if (specRef.startsWith('~/')) {
    return expandTilde(specRef);
  }

  // Return relative paths unchanged
  return specRef;
}

/**
 * Get the full path for a plan file given a WU ID
 *
 * @param {string} wuId - Work Unit ID (e.g., 'WU-1062')
 * @returns {string} Full path to the plan file
 *
 * @example
 * getPlanPath('WU-1062')
 * // '/home/user/.lumenflow/plans/WU-1062-plan.md'
 */
export function getPlanPath(wuId: string): string {
  const filename = `${wuId}-plan.md`;
  return join(getPlansDir(), filename);
}

/**
 * Get the lumenflow:// protocol reference for a plan
 *
 * @param {string} wuId - Work Unit ID (e.g., 'WU-1062')
 * @returns {string} Protocol reference (e.g., 'lumenflow://plans/WU-1062-plan.md')
 *
 * @example
 * getPlanProtocolRef('WU-1062')
 * // 'lumenflow://plans/WU-1062-plan.md'
 */
export function getPlanProtocolRef(wuId: string): string {
  const filename = `${wuId}-plan.md`;
  return `${LUMENFLOW_PROTOCOL}${PLANS_SUBDIR}/${filename}`;
}
