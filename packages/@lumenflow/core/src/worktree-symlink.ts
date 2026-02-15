/**
 * Worktree Symlink Utilities
 *
 * WU-1443: Auto-symlink node_modules in new worktrees
 * WU-1579: Extend to symlink nested package node_modules
 * WU-2238: Detect and refuse symlinks when target contains worktree-path symlinks
 *
 * After wu:claim creates a worktree, running pnpm commands fails with
 * 'node_modules missing'. This module provides the symlink helper to
 * auto-create the node_modules symlink pointing to the main repo's
 * node_modules directory, including nested package node_modules.
 *
 * @module tools/lib/worktree-symlink.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOG_PREFIX } from './wu-constants.js';
import { getErrorMessage } from './error-handler.js';

/**
 * Relative path from worktree to main repo's node_modules
 *
 * Worktrees are at: worktrees/<lane>-wu-<id>/
 * node_modules is at: ./node_modules (project root)
 *
 * So from worktree: ../../node_modules
 */
const RELATIVE_NODE_MODULES_PATH = '../../node_modules';

/**
 * node_modules directory name
 */
const NODE_MODULES_DIR = 'node_modules';

/**
 * Pattern to detect paths that are inside a worktrees directory.
 * Used to identify symlinks that may break when worktrees are removed.
 */
const WORKTREES_PATH_SEGMENT = '/worktrees/';

/**
 * pnpm store directory name (contains package symlinks)
 */
const PNPM_DIR = '.pnpm';

/**
 * List of nested package/app paths that have their own node_modules
 *
 * pnpm monorepos create node_modules in each package with symlinks
 * to the .pnpm store. turbo typecheck and tests need these to resolve imports.
 *
 * WU-1068: Removed @exampleapp references. Only @lumenflow packages are
 * relevant to the LumenFlow framework. Project-specific paths should be
 * configured in .lumenflow.config.yaml.
 *
 * @type {string[]}
 */
export const NESTED_PACKAGE_PATHS = [
  // Packages - @lumenflow/*
  'packages/@lumenflow/core',
  'packages/@lumenflow/cli',
  'packages/@lumenflow/memory',
  'packages/@lumenflow/agent',
  'packages/@lumenflow/metrics',
  'packages/@lumenflow/initiatives',
  'packages/@lumenflow/shims',
  // Apps (generic placeholders)
  'apps/web',
  'apps/docs',
];

interface WorktreePathSymlinkCheck {
  isWorktreePath: boolean;
  absoluteTarget: string;
  isBroken: boolean;
}

interface WorktreePathSymlinkResult {
  hasWorktreeSymlinks: boolean;
  brokenSymlinks: string[];
}

interface LoggerLike {
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

interface SymlinkResult {
  created: boolean;
  skipped: boolean;
  refused?: boolean;
  reason?: string;
  error?: Error;
}

interface NestedSymlinkResult {
  created: number;
  skipped: number;
  errors: Error[];
}

/**
 * Check if a symlink target points into a worktrees directory
 *
 * @param {string} linkTarget - The symlink target path (relative or absolute)
 * @param {string} basePath - Base path to resolve relative targets against
 * @returns {{isWorktreePath: boolean, absoluteTarget: string, isBroken: boolean}}
 */
function checkSymlinkTarget(linkTarget: string, basePath: string): WorktreePathSymlinkCheck {
  const absoluteTarget = path.isAbsolute(linkTarget)
    ? linkTarget
    : path.resolve(basePath, linkTarget);

  const isWorktreePath = absoluteTarget.includes(WORKTREES_PATH_SEGMENT);

  const isBroken = isWorktreePath && !fs.existsSync(absoluteTarget);

  return { isWorktreePath, absoluteTarget, isBroken };
}

/**
 * Process a single symlink entry to check for worktree-path references
 *
 * @param {string} entryPath - Full path to the symlink
 * @param {string} basePath - Base path to resolve relative targets
 * @param {{hasWorktreeSymlinks: boolean, brokenSymlinks: string[]}} result - Result object to mutate
 */
function processSymlinkEntry(
  entryPath: string,
  basePath: string,
  result: WorktreePathSymlinkResult,
): void {
  const linkTarget = fs.readlinkSync(entryPath);
  const check = checkSymlinkTarget(linkTarget, basePath);

  if (check.isWorktreePath) {
    result.hasWorktreeSymlinks = true;
    if (check.isBroken) {
      result.brokenSymlinks.push(entryPath);
    }
  }
}

/**
 * Scan .pnpm directory for symlinks pointing into worktrees
 * Only scans top-level entries to avoid deep recursion (performance)
 *
 * @param {string} pnpmPath - Absolute path to node_modules/.pnpm directory
 * @returns {{hasWorktreeSymlinks: boolean, brokenSymlinks: string[]}}
 */
function scanPnpmForWorktreeSymlinks(pnpmPath: string): WorktreePathSymlinkResult {
  const result: WorktreePathSymlinkResult = { hasWorktreeSymlinks: false, brokenSymlinks: [] };

  const entries = fs.readdirSync(pnpmPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      const entryPath = path.join(pnpmPath, entry.name);
      processSymlinkEntry(entryPath, pnpmPath, result);
    }
  }

  return result;
}

/**
 * Check if a node_modules directory contains symlinks pointing into worktrees
 *
 * WU-2238: When pnpm install runs inside a worktree, it can create symlinks
 * that point to the worktree's .pnpm store. When that worktree is removed,
 * these symlinks become broken and cause ERR_MODULE_NOT_FOUND.
 *
 * @param {string} nodeModulesPath - Absolute path to node_modules directory
 * @returns {{hasWorktreeSymlinks: boolean, brokenSymlinks: string[]}}
 */
export function hasWorktreePathSymlinks(nodeModulesPath: string): WorktreePathSymlinkResult {
  const result: WorktreePathSymlinkResult = { hasWorktreeSymlinks: false, brokenSymlinks: [] };

  if (!fs.existsSync(nodeModulesPath)) {
    return result;
  }

  const entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(nodeModulesPath, entry.name);

    if (entry.isSymbolicLink()) {
      processSymlinkEntry(entryPath, nodeModulesPath, result);
    } else if (entry.name === PNPM_DIR && entry.isDirectory()) {
      const pnpmResult = scanPnpmForWorktreeSymlinks(entryPath);
      if (pnpmResult.hasWorktreeSymlinks) {
        result.hasWorktreeSymlinks = true;
        result.brokenSymlinks.push(...pnpmResult.brokenSymlinks);
      }
    }
  }

  return result;
}

/**
 * Check if node_modules already exists at the target path
 *
 * @param {string} targetPath - Path to check
 * @returns {boolean} True if exists (should skip)
 */
function nodeModulesExists(targetPath: string): boolean {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if main repo node_modules has worktree-path symlinks
 *
 * @param {string} mainRepoPath - Path to main repo
 * @param {object} logger - Logger with warn method
 * @returns {{refused: boolean, reason?: string}}
 */
function checkMainNodeModulesHealth(
  mainRepoPath: string,
  logger: LoggerLike,
): { refused: boolean; reason?: string } {
  const mainNodeModulesPath = path.join(mainRepoPath, NODE_MODULES_DIR);
  const check = hasWorktreePathSymlinks(mainNodeModulesPath);

  if (!check.hasWorktreeSymlinks) {
    return { refused: false };
  }

  const reason =
    check.brokenSymlinks.length > 0
      ? `Main node_modules contains broken worktree-path symlinks: ${check.brokenSymlinks.slice(0, 3).join(', ')}${check.brokenSymlinks.length > 3 ? ` (+${check.brokenSymlinks.length - 3} more)` : ''}`
      : 'Main node_modules contains symlinks pointing into worktrees directory';

  if (logger.warn) {
    logger.warn(`${LOG_PREFIX.CLAIM} Refusing to symlink node_modules: ${reason}`);
    logger.warn(
      `${LOG_PREFIX.CLAIM} Run 'pnpm install' in the worktree instead, or heal main with 'pnpm install --force'`,
    );
  }

  return { refused: true, reason };
}

/**
 * Create symlink to node_modules in a newly created worktree
 *
 * This enables immediate pnpm command execution without manual symlink creation.
 * The symlink is relative for portability across different project locations.
 *
 * WU-2238: When mainRepoPath is provided, checks if the target node_modules
 * contains symlinks pointing into worktrees. If so, refuses to create the
 * symlink to prevent inheriting broken module resolution.
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @param {object} [logger] - Logger object with info/warn methods (defaults to console)
 * @param {string} [mainRepoPath] - Optional: Absolute path to main repo for worktree-path check
 * @returns {{created: boolean, skipped: boolean, refused?: boolean, reason?: string, error?: Error}}
 *
 * @example
 * // In wu-claim.ts after worktree creation:
 * symlinkNodeModules('/path/to/worktrees/operations-tooling-wu-1443');
 */
export function symlinkNodeModules(
  worktreePath: string,
  logger: LoggerLike = console,
  mainRepoPath: string | null = null,
): SymlinkResult {
  const targetPath = path.join(worktreePath, NODE_MODULES_DIR);

  // Check if node_modules already exists (idempotent)
  if (nodeModulesExists(targetPath)) {
    return { created: false, skipped: true };
  }

  // WU-2238: Check if main repo's node_modules contains worktree-path symlinks
  if (mainRepoPath) {
    const healthCheck = checkMainNodeModulesHealth(mainRepoPath, logger);
    if (healthCheck.refused) {
      return { created: false, skipped: false, refused: true, reason: healthCheck.reason };
    }
  }

  try {
    fs.symlinkSync(RELATIVE_NODE_MODULES_PATH, targetPath);

    if (logger.info) {
      logger.info(
        `${LOG_PREFIX.CLAIM} node_modules symlink created -> ${RELATIVE_NODE_MODULES_PATH}`,
      );
    }

    return { created: true, skipped: false };
  } catch (error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    if (logger.warn) {
      logger.warn(
        `${LOG_PREFIX.CLAIM} Failed to create node_modules symlink: ${getErrorMessage(error)}`,
      );
    }
    return { created: false, skipped: false, error: normalizedError };
  }
}

/**
 * Check if a directory should be skipped for symlink creation
 *
 * @param {string} targetDir - Target directory path
 * @param {string} sourceNodeModules - Source node_modules path
 * @returns {boolean} True if should skip
 */
function shouldSkipNestedPackage(targetDir: string, sourceNodeModules: string): boolean {
  if (!fs.existsSync(targetDir)) {
    return true;
  }

  if (!fs.existsSync(sourceNodeModules)) {
    return true;
  }
  return false;
}

/**
 * Handle existing node_modules in nested package
 *
 * @param {string} targetNodeModules - Target node_modules path
 * @param {string} pkgPath - Package path for logging
 * @param {object|null} logger - Logger object
 * @param {Error[]} errors - Errors array to mutate
 * @returns {'skip'|'replace'|'create'} Action to take
 */
function handleExistingNestedNodeModules(
  targetNodeModules: string,
  pkgPath: string,
  logger: LoggerLike | null,
  errors: Error[],
): 'skip' | 'replace' | 'create' {
  let targetStat;
  try {
    targetStat = fs.lstatSync(targetNodeModules);
  } catch {
    return 'create'; // Doesn't exist, create symlink
  }

  // If already a symlink, skip (idempotent)
  if (targetStat.isSymbolicLink()) {
    return 'skip';
  }

  // If not a directory, skip
  if (!targetStat.isDirectory()) {
    return 'skip';
  }

  // Check if directory has meaningful content

  const contents = fs.readdirSync(targetNodeModules);
  const hasMeaningfulContent = contents.some(
    (item) => !item.startsWith('.') && item !== '.vite' && item !== '.turbo',
  );

  if (hasMeaningfulContent) {
    return 'skip';
  }

  // Only cache files - remove and replace with symlink
  try {
    fs.rmSync(targetNodeModules, { recursive: true, force: true });
    return 'replace';
  } catch (rmError: unknown) {
    const normalizedError = rmError instanceof Error ? rmError : new Error(String(rmError));
    errors.push(normalizedError);
    if (logger?.warn) {
      logger.warn(
        `${LOG_PREFIX.CLAIM} Failed to remove stale ${pkgPath}/node_modules: ${getErrorMessage(rmError)}`,
      );
    }
    return 'skip';
  }
}

/**
 * Create symlinks for nested package node_modules in a worktree
 *
 * WU-1579: pnpm monorepos have node_modules in each package containing
 * symlinks to the .pnpm store. turbo typecheck needs these to resolve
 * package imports correctly.
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @param {string} mainRepoPath - Absolute path to the main repository root
 * @param {object} [logger] - Logger object with info/warn methods (defaults to silent)
 * @returns {{created: number, skipped: number, errors: Error[]}}
 *
 * @example
 * // In wu-claim.ts after worktree creation:
 * symlinkNestedNodeModules(
 *   '/path/to/worktrees/operations-tooling-wu-1579',
 *   '/path/to/main-repo'
 * );
 */
export function symlinkNestedNodeModules(
  worktreePath: string,
  mainRepoPath: string,
  logger: LoggerLike | null = null,
): NestedSymlinkResult {
  let created = 0;
  let skipped = 0;
  const errors: Error[] = [];

  for (const pkgPath of NESTED_PACKAGE_PATHS) {
    const targetDir = path.join(worktreePath, pkgPath);
    const targetNodeModules = path.join(targetDir, NODE_MODULES_DIR);
    const sourceNodeModules = path.join(mainRepoPath, pkgPath, NODE_MODULES_DIR);

    if (shouldSkipNestedPackage(targetDir, sourceNodeModules)) {
      skipped++;
      continue;
    }

    const action = handleExistingNestedNodeModules(targetNodeModules, pkgPath, logger, errors);
    if (action === 'skip') {
      skipped++;
      continue;
    }

    try {
      const relativePath = path.relative(targetDir, sourceNodeModules);

      fs.symlinkSync(relativePath, targetNodeModules);
      created++;

      if (logger?.info) {
        logger.info(`${LOG_PREFIX.CLAIM} ${pkgPath}/node_modules symlink created`);
      }
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      errors.push(normalizedError);
      if (logger?.warn) {
        logger.warn(
          `${LOG_PREFIX.CLAIM} Failed to create ${pkgPath}/node_modules symlink: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  return { created, skipped, errors };
}
