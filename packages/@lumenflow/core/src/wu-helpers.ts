#!/usr/bin/env node
/**
 * WU Helpers - Shared utilities for worktree and WU validation hooks
 *
 * Used by:
 * - .husky/prepare-commit-msg
 * - .husky/pre-commit
 * - .husky/pre-push
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { BRANCHES, REMOTES, STDIO, REAL_GIT, PATTERNS } from './wu-constants.js';
import { die } from './error-handler.js';
import { isAgentBranchWithDetails } from './branch-check.js';

/**
 * Validate WU ID format
 *
 * WU-1593: Extracted from duplicate implementations in wu-create.ts and wu-edit.ts (DRY).
 * Uses centralized PATTERNS.WU_ID regex from wu-constants.ts.
 *
 * @param {string} id - WU ID to validate (e.g., 'WU-123')
 * @throws {Error} If ID format is invalid
 *
 * @example
 * validateWUIDFormat('WU-123'); // OK
 * validateWUIDFormat('wu-123'); // throws Error
 * validateWUIDFormat('TICKET-123'); // throws Error
 */
export function validateWUIDFormat(id) {
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU ID format: "${id}"\n\nExpected format: WU-<number> (e.g., WU-706)`);
  }
}

/**
 * Execute a shell command and return the output
 * @param {string} cmd - Command to execute
 * @param {object} opts - Execution options
 * @returns {string} Command output
 */
export function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: STDIO.PIPE, encoding: 'utf-8', ...opts }).trim();
  } catch {
    return '';
  }
}

/**
 * Get the current Git branch name
 * Uses REAL_GIT to bypass shim and prevent recursion.
 * @returns {string|null} Branch name or null if not in a git repo
 */
export function getCurrentBranch() {
  return run(`${REAL_GIT} rev-parse --abbrev-ref HEAD`) || null;
}

/**
 * Get the current working directory relative to repo root
 * Uses REAL_GIT to bypass shim and prevent recursion.
 * @returns {string} Current directory path
 */
export function getCurrentDir() {
  const repoRoot = run(`${REAL_GIT} rev-parse --show-toplevel`);
  const cwd = process.cwd();
  if (!repoRoot) return cwd;
  return path.relative(repoRoot, cwd) || '.';
}

/**
 * Check if we're in the main worktree (not a lane worktree)
 * Uses REAL_GIT to bypass shim and prevent recursion.
 * @returns {boolean} True if in main worktree
 */
export function isMainWorktree() {
  const gitDir = run(`${REAL_GIT} rev-parse --git-dir`);
  if (!gitDir) return true;
  const normalized = gitDir.replace(/\\/g, '/');
  // Lane worktrees live under .git/worktrees/<name>
  return !normalized.includes('/worktrees/');
}

/**
 * Extract WU ID from branch name
 * Expected format: lane/<lane-name>/<wu-id>
 * @param {string} branch - Branch name
 * @returns {string|null} WU ID (e.g., 'WU-401') or null
 */
export function extractWUFromBranch(branch) {
  if (!branch) return null;
  // Match lane/<lane>/<wu-id> format
  const match = branch.match(/^lane\/[^/]+\/(wu-\d+)$/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return null;
}

/**
 * Validate branch name follows lane convention
 * Expected: lane/<lane-name>/<wu-id>
 * @param {string} branch - Branch name to validate
 * @returns {{valid: boolean, lane: string|null, wuid: string|null, error: string|null}}
 */
export function validateBranchName(branch) {
  if (!branch || branch === BRANCHES.MAIN) {
    return { valid: true, lane: null, wuid: null, error: null };
  }

  const match = branch.match(/^lane\/([^/]+)\/(wu-\d+)$/i);
  if (!match) {
    return {
      valid: false,
      lane: null,
      wuid: null,
      error: `Branch '${branch}' doesn't follow lane/<lane>/<wu-id> convention`,
    };
  }

  return {
    valid: true,
    lane: match[1],
    wuid: match[2].toUpperCase(),
    error: null,
  };
}

/**
 * Read WU YAML file and return parsed content
 * Uses REAL_GIT to bypass shim and prevent recursion.
 * @param {string} wuid - WU ID (e.g., 'WU-401')
 * @returns {object|null} Parsed WU YAML or null if not found
 */
export function readWUYaml(wuid) {
  const repoRoot = run(`${REAL_GIT} rev-parse --show-toplevel`);
  if (!repoRoot) return null;

  const wuPath = path.join(repoRoot, 'docs', '04-operations', 'tasks', 'wu', `${wuid}.yaml`);
  if (!existsSync(wuPath)) return null;

  try {
    const content = readFileSync(wuPath, { encoding: 'utf-8' });
    return parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if WU status allows the operation
 * @param {string} wuid - WU ID
 * @param {string[]} allowedStatuses - List of allowed statuses
 * @returns {{allowed: boolean, status: string|null, error: string|null}}
 */
export function checkWUStatus(wuid, allowedStatuses = ['in_progress', 'waiting']) {
  const wu = readWUYaml(wuid);
  if (!wu) {
    return {
      allowed: false,
      status: null,
      error: `WU ${wuid} not found in docs/04-operations/tasks/wu/`,
    };
  }

  const status = wu.status;
  if (!status) {
    return {
      allowed: false,
      status: null,
      error: `WU ${wuid} has no status field`,
    };
  }

  if (!allowedStatuses.includes(status)) {
    return {
      allowed: false,
      status,
      error: `WU ${wuid} status is '${status}' (expected one of: ${allowedStatuses.join(', ')})`,
    };
  }

  return { allowed: true, status, error: null };
}

/**
 * Format an error message for hook output
 * @param {string} hookName - Name of the hook
 * @param {string} message - Error message
 * @returns {string} Formatted error message
 */
export function formatHookError(hookName, message) {
  return `
╔═══════════════════════════════════════════════════════════════════╗
║  ${hookName.toUpperCase()} HOOK ERROR
╠═══════════════════════════════════════════════════════════════════╣
║  ${message}
╚═══════════════════════════════════════════════════════════════════╝
`;
}

/**
 * Extract WU ID from commit message
 * Supports formats:
 * - wu(WU-401): message
 * - chore(wu-401): message
 * - feat(wu-401): message
 * @param {string} message - Commit message
 * @returns {string|null} WU ID or null
 */
export function extractWUFromCommitMessage(message) {
  if (!message) return null;

  // Match wu(WU-401) or type(wu-401) patterns
  const patterns = [
    /wu\((wu-\d+)\)/i, // wu(WU-401)
    /\w+\((wu-\d+)\)/i, // chore(wu-401), feat(wu-401), etc.
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * Ensure current branch is main. Throws if not.
 *
 * Centralized from duplicated ensureOnMain() functions across wu-* scripts (WU-1256).
 * Async version - accepts a git adapter with async getCurrentBranch() method.
 *
 * WU-1091: Agent branches (claude/*, codex/*, copilot/*, cursor/*, agent/*) bypass
 * the main branch requirement for web agent commands. Lane branches still require
 * worktree workflow (no bypass). Protected branches (main/master) remain protected.
 *
 * @param {object} git - Git adapter with async getCurrentBranch() method
 * @throws {Error} If not on main branch and not an agent branch
 */
export async function ensureOnMain(git) {
  const branch = await git.getCurrentBranch();
  if (branch !== BRANCHES.MAIN) {
    // WU-1091: Check if this is an agent branch that can bypass the main requirement
    const agentResult = await isAgentBranchWithDetails(branch);
    if (agentResult.isMatch) {
      console.log(
        `[ensureOnMain] Bypassing for agent branch '${branch}' (${agentResult.patternResult.source})`,
      );
      return;
    }
    throw new Error(`Run from shared checkout on '${BRANCHES.MAIN}' (found '${branch}')`);
  }
}

/**
 * Ensure main branch is up to date with origin.
 *
 * Centralized from duplicated ensureMainUpToDate() functions across wu-* scripts (WU-1256).
 *
 * @param {object} git - Git adapter with async fetch() and getCommitHash() methods
 * @param {string} [scriptName='wu'] - Script name for logging
 * @throws {Error} If main is out of sync with origin
 */
export async function ensureMainUpToDate(git, _scriptName = 'wu') {
  await git.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
  const localMain = await git.getCommitHash(BRANCHES.MAIN);
  const remoteMain = await git.getCommitHash(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);
  if (localMain !== remoteMain) {
    throw new Error(
      `Main branch is out of sync with origin.\n\nRun: git pull ${REMOTES.ORIGIN} ${BRANCHES.MAIN}`,
    );
  }
}
