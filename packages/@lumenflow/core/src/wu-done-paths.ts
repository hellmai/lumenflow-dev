/**
 * Path and workspace detection helpers for wu:done.
 */

import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { getGitForCwd } from './git-adapter.js';
import { WU_PATHS } from './wu-paths.js';
import { parseYAML, readWU } from './wu-yaml.js';
import { CLAIMED_MODES, EMOJI, LOG_PREFIX, STRING_LITERALS, toKebab } from './wu-constants.js';
import { detectDocsOnlyByPaths } from './wu-done-docs-only.js';

/**
 * Read WU YAML preferring worktree version over main version
 *
 * WU-1584 Fix #4: Added diagnostic logging to confirm which YAML file is being
 * read for code_paths validation. This helps debug issues where worktree YAML
 * differs from main checkout YAML.
 *
 * @param {string} id - WU ID
 * @param {string|null} worktreePath - Worktree path (null if branch-only mode)
 * @param {string} mainWUPath - Path to WU YAML in main checkout
 * @returns {object} Parsed WU document
 */
export function readWUPreferWorktree(id, worktreePath, mainWUPath) {
  if (worktreePath) {
    const wtWUPath = path.join(worktreePath, WU_PATHS.WU(id));
    if (existsSync(wtWUPath)) {
      try {
        const text = readFileSync(wtWUPath, { encoding: 'utf-8' });
        const doc = parseYAML(text);
        if (doc && doc.id === id) {
          // WU-1584: Log source file for validation debugging
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.INFO} Reading WU YAML from worktree: ${wtWUPath}`,
          );
          if (doc.code_paths && doc.code_paths.length > 0) {
            console.log(
              `${LOG_PREFIX.DONE}   code_paths source: worktree (${doc.code_paths.length} path(s))`,
            );
          }
          return doc;
        }
        // If ID mismatch, log warning but continue
        console.warn(
          `${LOG_PREFIX.DONE} Warning: Worktree YAML ID mismatch (expected ${id}, got ${doc?.id})`,
        );
      } catch (err) {
        // Log parse errors for debugging
        console.warn(`${LOG_PREFIX.DONE} Warning: Failed to read worktree YAML: ${err.message}`);
      }
    } else {
      // Log missing worktree YAML for debugging
      console.warn(`${LOG_PREFIX.DONE} Warning: Worktree YAML not found at ${wtWUPath}`);
    }
  }
  // WU-1584: Log when falling back to main checkout YAML
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} Reading WU YAML from main: ${mainWUPath}`);
  const doc = readWU(mainWUPath, id);
  if (doc.code_paths && doc.code_paths.length > 0) {
    console.log(
      `${LOG_PREFIX.DONE}   code_paths source: main checkout (${doc.code_paths.length} path(s))`,
    );
  }
  return doc;
}

/**
 * Detect if currently running inside a worktree
 * Checks for .git file (not directory) which indicates a worktree
 * @returns {string|null} Current directory path if inside worktree, null otherwise
 */
export function detectCurrentWorktree() {
  const cwd = process.cwd();
  const gitPath = path.join(cwd, '.git');

  // Check if .git exists and is a file (worktrees have .git file, main has .git directory)
  if (!existsSync(gitPath)) return null;

  try {
    const stats = statSync(gitPath);
    if (stats.isFile()) {
      // Parse .git file to verify it points to main repo's worktrees
      const gitContent = readFileSync(gitPath, { encoding: 'utf-8' });
      const match = gitContent.match(/^gitdir:\s*(.+)$/m);
      if (match && match[1].includes('.git/worktrees/')) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.TARGET} Auto-detected worktree from process.cwd(): ${cwd}`,
        );
        return cwd;
      }
    }
  } catch (err) {
    // Ignore errors, fall back to calculated path
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Failed to detect worktree: ${err.message}`);
  }

  return null;
}

/**
 * Resolve worktree path from WU YAML
 * Originally implemented in WU-1226, extracted to validators module in WU-1215
 * Priority:
 * 1. Read worktree_path field (set at claim time, immune to lane field changes)
 * 2. Fall back to calculating from lane field (for old WUs without worktree_path)
 * 3. Use git worktree list to find actual path (defensive fallback)
 * @param {object} doc - WU YAML document
 * @returns {Promise<string|null>} - Worktree path or null if not found
 */
export async function defaultWorktreeFrom(doc) {
  // Priority 1 - use recorded worktree_path if available
  if (doc.worktree_path) {
    return doc.worktree_path;
  }

  // Priority 2 - calculate from current lane field (legacy behavior)
  const lane = (doc.lane || '').toString();
  const laneK = toKebab(lane);
  const idK = (doc.id || '').toLowerCase();
  if (!laneK || !idK) return null;

  const calculated = `worktrees/${laneK}-${idK}`;

  // Priority 3 - verify calculated path exists, or find actual path via git worktree list
  let calculatedExists = true;
  try {
    await access(calculated);
  } catch {
    calculatedExists = false;
  }

  if (!calculatedExists) {
    try {
      const worktreeList = await getGitForCwd().worktreeList();
      const lines = worktreeList.split(STRING_LITERALS.NEWLINE);
      const branch = `lane/${laneK}/${idK}`;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          // Found the branch, now get the worktree path from previous line
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              const fullPath = lines[j].substring('worktree '.length);
              // Convert absolute path to relative path from repo root
              const repoRoot = process.cwd();
              const relativePath = path.relative(repoRoot, fullPath);
              console.log(
                `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Worktree path mismatch detected:\n` +
                  `  Expected: ${calculated}\n` +
                  `  Actual:   ${relativePath}\n` +
                  `  Using actual path from git worktree list`,
              );
              return relativePath;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX.DONE} Could not query git worktree list: ${e.message}`);
    }
  }

  return calculated;
}

/**
 * Detect workspace mode from WU YAML
 * @param {object} doc - WU YAML document
 * @returns {'worktree' | 'branch-only' | 'branch-pr'}
 */
export function detectWorkspaceMode(doc) {
  // Explicit mode field takes precedence
  if (doc.claimed_mode === CLAIMED_MODES.BRANCH_ONLY) return CLAIMED_MODES.BRANCH_ONLY;
  if (doc.claimed_mode === CLAIMED_MODES.BRANCH_PR) return CLAIMED_MODES.BRANCH_PR;
  if (doc.claimed_mode === CLAIMED_MODES.WORKTREE) return CLAIMED_MODES.WORKTREE;

  // Backward compatibility: if claimed_mode is missing, assume worktree mode
  // (all WUs claimed before WU-510 used worktree mode)
  return CLAIMED_MODES.WORKTREE;
}

/**
 * Calculate branch name from WU YAML
 *
 * WU-1589: Resolver precedence:
 * 1. claimed_branch (canonical, set at claim time for branch-pr cloud agents)
 * 2. Lane-derived naming (lane/<kebab-lane>/<wu-id>, legacy default)
 *
 * @param {object} doc - WU YAML document
 * @returns {string|null} Branch name or null if neither source available
 */
export function defaultBranchFrom(doc) {
  // Priority 1: Use claimed_branch if present (WU-1589)
  if (doc.claimed_branch && doc.claimed_branch.trim()) {
    return doc.claimed_branch;
  }

  // Priority 2: Fall back to lane-derived naming
  const lane = (doc.lane || '').toString();
  const laneK = toKebab(lane);
  const idK = (doc.id || '').toLowerCase();
  if (!laneK || !idK) return null;
  return `lane/${laneK}/${idK}`;
}

/**
 * Check if a branch exists
 * @param {string} branch - Branch name to check
 * @returns {Promise<boolean>} True if branch exists
 */
export async function branchExists(branch) {
  return await getGitForCwd().branchExists(branch);
}

/**
 * Detect workspace mode and calculate all relevant paths
 * @param {string} id - WU ID
 * @param {object} args - Parsed command-line arguments
 * @returns {Promise<object>} Object containing paths, mode info, and WU document
 */
export async function detectModeAndPaths(id, args) {
  const WU_PATH = WU_PATHS.WU(id);
  const STATUS_PATH = WU_PATHS.STATUS();
  const BACKLOG_PATH = WU_PATHS.BACKLOG();
  const STAMPS_DIR = WU_PATHS.STAMPS_DIR();

  // Read WU YAML to detect workspace mode
  const docMain = readWU(WU_PATH, id);
  const workspaceMode = detectWorkspaceMode(docMain);
  const isBranchOnly = workspaceMode === CLAIMED_MODES.BRANCH_ONLY;
  // WU-1492: branch-pr mode has no worktree (like branch-only) but creates PR instead of merging
  const isBranchPR = workspaceMode === CLAIMED_MODES.BRANCH_PR;
  const isNoWorktreeMode = isBranchOnly || isBranchPR;

  console.log(`\n${LOG_PREFIX.DONE} Detected workspace mode: ${workspaceMode}`);

  // Determine candidate worktree path early (only relevant for Worktree mode)
  // Priority: 1) Auto-detect from cwd 2) Explicit --worktree arg 3) Calculate from YAML
  const detectedWorktree = detectCurrentWorktree();
  const worktreePathGuess = args.worktree || null;

  // For Worktree mode: prefer auto-detected worktree, then explicit arg, then calculated path
  // For Branch-Only / Branch-PR mode: use main checkout version (no worktree exists)
  const derivedWorktree = isNoWorktreeMode
    ? null
    : detectedWorktree || worktreePathGuess || (await defaultWorktreeFrom(docMain));

  if (!isNoWorktreeMode && derivedWorktree && !detectedWorktree) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.FOLDER} Calculated worktree path from YAML: ${derivedWorktree}`,
    );
  }

  // Read the actual WU YAML for validation (prefer worktree version over main)
  const docForValidation = isNoWorktreeMode
    ? docMain
    : readWUPreferWorktree(id, derivedWorktree, WU_PATH);

  // WU-1234: Detect docs-only by type OR by code_paths
  // Auto-detect if all code_paths are under docs/, ai/, .claude/, or are README/CLAUDE files
  const isDocsOnlyByType = docForValidation.type === 'documentation';
  const isDocsOnlyByPaths = detectDocsOnlyByPaths(docForValidation.code_paths);
  const isDocsOnly = isDocsOnlyByType || isDocsOnlyByPaths;

  if (isDocsOnlyByPaths && !isDocsOnlyByType) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-detected docs-only WU from code_paths (type: ${docForValidation.type || 'unset'})`,
    );
  }

  return {
    WU_PATH,
    STATUS_PATH,
    BACKLOG_PATH,
    STAMPS_DIR,
    docMain,
    workspaceMode,
    isBranchOnly,
    // WU-1492: Expose branch-pr flag for routing in wu-done CLI
    isBranchPR,
    derivedWorktree,
    docForValidation,
    isDocsOnly,
  };
}
