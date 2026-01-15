import { getGitForCwd } from './git-adapter.js';
import { die } from './error-handler.js';

/**
 * Git Staged Files Validator
 *
 * Centralized validation for staged files requirement.
 * Extracted from duplicate implementations in wu-block and wu-unblock (WU-1341).
 *
 * Used in --no-auto mode to enforce that required files are staged before commit.
 *
 * @module git-staged-validator
 */

/**
 * Ensure all required paths are staged in git index
 *
 * Validates that specified files/directories are staged for commit.
 * Supports exact path matching and directory prefix matching.
 *
 * @param {Array<string|null|undefined>} paths - Paths to check (null/undefined values filtered out)
 * @throws {Error} If any required paths are not staged
 * @returns {Array<string>} List of all staged files
 *
 * @example
 * // All files staged - success
 * ensureStaged(['docs/file.md', 'tools/script.js']);
 *
 * // Directory prefix - matches all files under directory
 * ensureStaged(['docs/04-operations/']);
 *
 * // Missing files - throws error
 * ensureStaged(['docs/file1.md', 'docs/file2.md']);
 * // Error: Stage updates for: docs/file2.md
 */
export function ensureStaged(paths) {
  const git = getGitForCwd();
  const raw = git.run('git diff --cached --name-only');
  const staged = raw ? raw.split(/\r?\n/).filter(Boolean) : [];

  // Filter out null/undefined and check each path
  const missing = paths.filter(Boolean).filter((p) => {
    // Normalize path: remove trailing slash for directory checks
    const pathToCheck = p.endsWith('/') ? p.slice(0, -1) : p;
    return !staged.some((name) => name === pathToCheck || name.startsWith(`${pathToCheck}/`));
  });

  if (missing.length) {
    die(`Stage updates for: ${missing.join(', ')}`);
  }

  return staged;
}
