// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file incremental-lint.ts
 * @description Incremental linting utilities for gates
 * WU-1304: Optimise ESLint gates performance
 *
 * Provides utilities to determine which files need linting based on
 * changes since branching from main, enabling faster gate execution.
 */

import { getGitForCwd } from './git-adapter.js';
import { GIT_REFS, STRING_LITERALS } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';

function ensureTrailingSlash(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function getConfiguredWorktreesDir(): string {
  return ensureTrailingSlash(createWuPaths({ projectRoot: process.cwd() }).WORKTREES_DIR());
}

/**
 * File extensions that should be linted by ESLint
 * @type {string[]}
 */
export const LINTABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Directory patterns that should be ignored
 * Matches ESLint ignores in apps/web/eslint.config.ts
 * @type {string[]}
 */
const IGNORED_DIRECTORIES = [
  'node_modules/',
  '.next/',
  '.expo/',
  'dist/',
  'build/',
  '.turbo/',
  'coverage/',
];

/**
 * Check if a file path should be linted
 * @param {string} filePath - File path to check
 * @returns {boolean} True if file should be linted
 */
export function isLintableFile(filePath: string) {
  const ignoredDirectories = [...IGNORED_DIRECTORIES, getConfiguredWorktreesDir()];

  // Check if in ignored directory
  for (const ignored of ignoredDirectories) {
    if (filePath.includes(ignored)) {
      return false;
    }
  }

  // Check if has lintable extension
  for (const ext of LINTABLE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse git output into a list of file paths
 * @param {string} output - Git command output
 * @returns {string[]} List of file paths
 */
function parseGitFileList(output: string): string[] {
  return output
    .split(STRING_LITERALS.NEWLINE)
    .map((f: string) => f.trim())
    .filter((f: string) => f.length > 0);
}

/**
 * Git adapter interface for testing
 */
interface GitAdapter {
  mergeBase: (ref1: string, ref2: string) => Promise<string>;
  raw: (args: string[]) => Promise<string>;
}

/**
 * Options for getting changed lintable files
 */
export interface GetChangedLintableFilesOptions {
  /** GitAdapter instance (for testing) */
  git?: GitAdapter;
  /** Base branch to compare against */
  baseBranch?: string;
  /** Optional path prefix to filter files */
  filterPath?: string;
}

/**
 * Get list of changed files that should be linted
 * Includes:
 * - Committed changes since branching from main (git diff merge-base...HEAD)
 * - Modified but unstaged files (git diff --name-only)
 * - Untracked files (git ls-files --others --exclude-standard)
 *
 * WU-1784: Extended to include untracked and unstaged files to prevent
 * lint gaps when gates are run before staging/committing changes.
 *
 * @param {GetChangedLintableFilesOptions} [options] - Options
 * @returns {Promise<string[]>} List of file paths to lint
 *
 * @example
 * // Get all changed lintable files
 * const files = await getChangedLintableFiles();
 *
 * @example
 * // Get only files in apps/web/
 * const files = await getChangedLintableFiles({ filterPath: 'apps/web/' });
 */
export async function getChangedLintableFiles(options: GetChangedLintableFilesOptions = {}) {
  const { git = getGitForCwd(), baseBranch = GIT_REFS.ORIGIN_MAIN, filterPath } = options;

  // Get the merge base (common ancestor) with the base branch
  const mergeBase = await git.mergeBase('HEAD', baseBranch);

  // 1. Get committed changes since the merge base
  const committedOutput = await git.raw(['diff', '--name-only', `${mergeBase}...HEAD`]);
  const committedFiles = parseGitFileList(committedOutput);

  // 2. Get modified but unstaged files (WU-1784)
  const unstagedOutput = await git.raw(['diff', '--name-only']);
  const unstagedFiles = parseGitFileList(unstagedOutput);

  // 3. Get untracked files (WU-1784)
  const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard']);
  const untrackedFiles = parseGitFileList(untrackedOutput);

  // Combine all sources and deduplicate using Set
  const allFiles = [...new Set([...committedFiles, ...unstagedFiles, ...untrackedFiles])];

  // Filter to lintable files
  let lintableFiles = allFiles.filter(isLintableFile);

  // Apply path filter if specified
  if (filterPath) {
    lintableFiles = lintableFiles.filter((f) => f.startsWith(filterPath));
  }

  return lintableFiles;
}

/**
 * Convert repo-relative file paths to package-relative paths
 *
 * WU-2571: ESLint runs from package directory (e.g., apps/web/) where
 * repo-relative paths (e.g., apps/web/src/file.ts) don't exist.
 * This function strips the package prefix to produce paths that
 * work correctly when ESLint is run from the package directory.
 *
 * @param {string[]} repoRelativePaths - Paths relative to repo root (e.g., ['apps/web/src/app.ts'])
 * @param {string} packagePrefix - Package directory prefix (e.g., 'apps/web/' or 'apps/web')
 * @returns {string[]} Paths relative to package directory (e.g., ['src/app.ts'])
 *
 * @example
 * const repoRelative = ['apps/web/src/app.ts', 'apps/web/src/lib.tsx'];
 * const packageRelative = convertToPackageRelativePaths(repoRelative, 'apps/web/');
 * // Returns: ['src/app.ts', 'src/lib.tsx']
 */
export function convertToPackageRelativePaths(
  repoRelativePaths: readonly string[],
  packagePrefix: string,
): string[] {
  // Normalize the prefix to ensure it ends with a slash
  const normalizedPrefix = packagePrefix.endsWith('/') ? packagePrefix : `${packagePrefix}/`;

  return repoRelativePaths
    .filter((filePath: string) => filePath.startsWith(normalizedPrefix))
    .map((filePath: string) => filePath.slice(normalizedPrefix.length));
}
