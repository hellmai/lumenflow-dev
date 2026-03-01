// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1650: Validation helpers for wu:edit command
 *
 * Extracted from wu-edit.ts to dedicated module.
 * All validation logic used by the wu:edit orchestrator lives here.
 */

import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync } from 'node:fs';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { defaultWorktreeFrom, WU_PATHS } from '@lumenflow/core/wu-paths';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import { getConfig } from '@lumenflow/core/config';
import { FILE_SYSTEM, WU_STATUS, WU_EXPOSURE_VALUES } from '@lumenflow/core/wu-constants';
import { INIT_PATTERNS } from '@lumenflow/initiatives/constants';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import {
  BRANCH_PR_EDIT_MODE,
  BLOCKED_EDIT_MODE,
  resolveInProgressEditMode,
} from './wu-state-cloud.js';

/**
 * Edit modes for WU editing
 * WU-1365: Worktree-aware editing support
 */
export const EDIT_MODE = {
  /** Ready WUs: Use micro-worktree on main (existing behavior) */
  MICRO_WORKTREE: 'micro_worktree',
  /** In-progress worktree WUs: Apply edits directly in active worktree (WU-1365) */
  WORKTREE: 'worktree',
  /** In-progress branch-pr WUs: apply edits directly on the claimed branch */
  BRANCH_PR: BRANCH_PR_EDIT_MODE,
};

/**
 * WU-1039: Validate which edits are allowed on done WUs
 *
 * Done WUs only allow metadata reassignment: initiative, phase, and exposure.
 * All other edits are blocked to preserve WU immutability after completion.
 *
 * @param opts - Parsed CLI options
 * @returns { valid: boolean, disallowedEdits: string[] }
 */
export function validateDoneWUEdits(opts: Record<string, unknown>): {
  valid: boolean;
  disallowedEdits: string[];
} {
  const disallowedEdits: string[] = [];

  // Check for disallowed edits on done WUs
  if (opts.specFile) disallowedEdits.push('--spec-file');
  if (opts.description) disallowedEdits.push('--description');
  if (opts.acceptance && Array.isArray(opts.acceptance) && opts.acceptance.length > 0) {
    disallowedEdits.push('--acceptance');
  }
  if (opts.notes) disallowedEdits.push('--notes');
  if (opts.codePaths && Array.isArray(opts.codePaths) && opts.codePaths.length > 0) {
    disallowedEdits.push('--code-paths');
  }
  if (opts.risks && Array.isArray(opts.risks) && opts.risks.length > 0) {
    disallowedEdits.push('--risks');
  }
  if (opts.lane) disallowedEdits.push('--lane');
  if (opts.type) disallowedEdits.push('--type');
  if (opts.priority) disallowedEdits.push('--priority');
  if (
    opts.testPathsManual &&
    Array.isArray(opts.testPathsManual) &&
    opts.testPathsManual.length > 0
  ) {
    disallowedEdits.push('--test-paths-manual');
  }
  if (opts.testPathsUnit && Array.isArray(opts.testPathsUnit) && opts.testPathsUnit.length > 0) {
    disallowedEdits.push('--test-paths-unit');
  }
  if (opts.testPathsE2e && Array.isArray(opts.testPathsE2e) && opts.testPathsE2e.length > 0) {
    disallowedEdits.push('--test-paths-e2e');
  }

  return {
    valid: disallowedEdits.length === 0,
    disallowedEdits,
  };
}

/**
 * WU-1039: Validate exposure value against schema
 *
 * Uses WU_EXPOSURE_VALUES from core constants (Library-First, no magic strings).
 *
 * @param exposure - Exposure value to validate
 * @returns { valid: boolean, error?: string }
 */
export function validateExposureValue(exposure: string): {
  valid: boolean;
  error?: string;
} {
  // WU_EXPOSURE_VALUES is readonly array, need to cast for includes check
  const validValues = WU_EXPOSURE_VALUES as readonly string[];
  if (!validValues.includes(exposure)) {
    return {
      valid: false,
      error: `Invalid exposure value: "${exposure}"\n\nValid values: ${WU_EXPOSURE_VALUES.join(', ')}`,
    };
  }
  return { valid: true };
}

/**
 * WU-1929: Validate initiative ID format
 * @param {string} initId - Initiative ID to validate
 */
export function validateInitiativeFormat(initId: string): void {
  if (!INIT_PATTERNS.INIT_ID.test(initId)) {
    die(
      `Invalid Initiative ID format: "${initId}"\n\n` +
        `Expected format: INIT-<number> or INIT-<NAME> (e.g., INIT-001, INIT-TOOLING)`,
    );
  }
}

/**
 * WU-1929: Validate initiative exists on disk
 * @param {string} initId - Initiative ID to check
 * @returns {string} Path to initiative file
 */
export function validateInitiativeExists(initId: string): string {
  const initPath = INIT_PATHS.INITIATIVE(initId);

  if (!existsSync(initPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initPath}`);
  }
  return initPath;
}

/**
 * Check WU exists and determine edit mode
 * WU-1365: Now supports worktree-aware editing for in_progress WUs
 *
 * @param {string} id - WU ID
 * @returns {{ wu: object, editMode: string, isDone: boolean }} WU object and edit mode
 */
export function validateWUEditable(id: string): {
  wu: Record<string, unknown>;
  editMode: string;
  isDone: boolean;
} {
  const wuPath = WU_PATHS.WU(id);

  if (!existsSync(wuPath)) {
    die(`WU ${id} not found at ${wuPath}\n\nEnsure the WU exists and you're in the repo root.`);
  }

  const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  const wu = parseYAML(content);

  // WU-1929: Done WUs allow initiative/phase edits only (metadata reassignment)
  // WU-1365: Other fields on done WUs are immutable
  if (wu.status === WU_STATUS.DONE) {
    // Return done status - main() will validate allowed fields
    return { wu, editMode: EDIT_MODE.MICRO_WORKTREE, isDone: true };
  }

  // Handle in_progress WUs based on claimed_mode (WU-1365)
  if (wu.status === WU_STATUS.IN_PROGRESS) {
    const editMode = resolveInProgressEditMode(
      typeof wu.claimed_mode === 'string' ? wu.claimed_mode : undefined,
    );

    if (editMode === BLOCKED_EDIT_MODE) {
      die(
        `Cannot edit branch-only WU ${id} via wu:edit.\n\n` +
          `WUs claimed with claimed_mode='branch-only' cannot be edited via wu:edit.\n` +
          `To modify the spec, edit the file directly on the lane branch and commit.`,
      );
    }

    if (editMode === EDIT_MODE.BRANCH_PR) {
      return { wu, editMode: EDIT_MODE.BRANCH_PR, isDone: false };
    }

    // WU-1677: For worktree-mode WUs, re-read YAML from the worktree.
    // The worktree copy is authoritative (it may have prior wu:edit commits
    // that haven't been merged to main yet). Reading from main causes
    // sequential wu:edit calls to silently overwrite each other.
    const worktreeRelPath = defaultWorktreeFrom(wu as { lane?: string; id?: string });
    if (worktreeRelPath) {
      const worktreeWuPath = join(resolve(worktreeRelPath), WU_PATHS.WU(id));
      if (existsSync(worktreeWuPath)) {
        const worktreeContent = readFileSync(worktreeWuPath, {
          encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
        });
        const worktreeWu = parseYAML(worktreeContent);
        return { wu: worktreeWu, editMode: EDIT_MODE.WORKTREE, isDone: false };
      }
    }

    return { wu, editMode: EDIT_MODE.WORKTREE, isDone: false };
  }

  // Ready WUs use micro-worktree (existing behavior)
  if (wu.status === WU_STATUS.READY) {
    return { wu, editMode: EDIT_MODE.MICRO_WORKTREE, isDone: false };
  }

  // Block other statuses (blocked, etc.)
  die(
    `Cannot edit WU ${id}: status is '${wu.status}'.\n\n` +
      `Only WUs in '${WU_STATUS.READY}' or '${WU_STATUS.IN_PROGRESS}' (worktree mode) can be edited.`,
  );
}

/**
 * Validate worktree exists on disk
 * WU-1365: Required check before worktree editing
 *
 * @param {string} worktreePath - Absolute path to worktree
 * @param {string} id - WU ID (for error messages)
 */
export function validateWorktreeExists(worktreePath: string, id: string): void {
  if (!existsSync(worktreePath)) {
    die(
      `Cannot edit WU ${id}: worktree path missing from disk.\n\n` +
        `Expected worktree at: ${worktreePath}\n\n` +
        `The worktree may have been removed or the path is incorrect.\n` +
        `If the worktree was accidentally deleted, you may need to re-claim the WU.`,
    );
  }
}

/**
 * Validate worktree has no uncommitted changes
 * WU-1365: Required check to prevent edit conflicts
 *
 * @param {string} worktreePath - Absolute path to worktree
 * @param {string} id - WU ID (for error messages)
 */
export async function validateWorktreeClean(worktreePath: string, id: string): Promise<void> {
  try {
    const gitAdapter = createGitForPath(worktreePath);
    const status = (await gitAdapter.raw(['status', '--porcelain'])).trim();

    if (status !== '') {
      die(
        `Cannot edit WU ${id}: worktree has uncommitted changes.\n\n` +
          `Uncommitted changes in ${worktreePath}:\n${status}\n\n` +
          `Commit or discard your changes before editing the WU spec:\n` +
          `  cd ${worktreePath}\n` +
          `  git add . && git commit -m "wip: save progress"\n\n` +
          `Then retry wu:edit.`,
      );
    }
  } catch (err) {
    die(
      `Cannot edit WU ${id}: failed to check worktree status.\n\n` +
        `Error: ${err.message}\n\n` +
        `Worktree path: ${worktreePath}`,
    );
  }
}

/**
 * Validate worktree is on expected lane branch
 * WU-1365: Prevents editing WUs in worktrees with mismatched branches
 *
 * @param {string} worktreePath - Absolute path to worktree
 * @param {string} expectedBranch - Expected branch name (e.g., lane/operations-tooling/wu-1365)
 * @param {string} id - WU ID (for error messages)
 */
export async function validateWorktreeBranch(
  worktreePath: string,
  expectedBranch: string,
  id: string,
): Promise<void> {
  try {
    const gitAdapter = createGitForPath(worktreePath);
    const actualBranch = (await gitAdapter.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

    if (actualBranch !== expectedBranch) {
      die(
        `Cannot edit WU ${id}: worktree branch does not match expected lane branch.\n\n` +
          `Expected branch: ${expectedBranch}\n` +
          `Actual branch:   ${actualBranch}\n\n` +
          `This may indicate a corrupted worktree state.\n` +
          `Verify the worktree is correctly set up for this WU.`,
      );
    }
  } catch (err) {
    die(
      `Cannot edit WU ${id}: failed to check worktree branch.\n\n` +
        `Error: ${err.message}\n\n` +
        `Worktree path: ${worktreePath}`,
    );
  }
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}

/**
 * Validate command execution context for in-progress worktree WUs.
 * WU-2290: Block wu:edit invocations from main checkout for worktree-mode WUs.
 *
 * @param currentCwd - Current process working directory
 * @param worktreePath - Claimed worktree absolute path
 * @param id - WU ID
 * @param retryCommand - Optional copy-paste retry command
 */
export function validateWorktreeExecutionContext(
  currentCwd: string,
  worktreePath: string,
  id: string,
  retryCommand?: string,
): void {
  const resolvedCwd = resolve(currentCwd);
  const resolvedWorktreePath = resolve(worktreePath);

  if (isPathWithin(resolvedWorktreePath, resolvedCwd)) {
    return;
  }

  const safeRetryCommand =
    typeof retryCommand === 'string' && retryCommand.trim().length > 0
      ? retryCommand.trim()
      : `pnpm wu:edit --id ${id} <edit-flags>`;

  die(
    `Cannot edit in_progress WU ${id} from this checkout.\n\n` +
      `Current directory: ${resolvedCwd}\n` +
      `Claimed worktree: ${resolvedWorktreePath}\n\n` +
      `Run from the claimed worktree and retry:\n` +
      `  cd ${resolvedWorktreePath}\n` +
      `  ${safeRetryCommand}`,
  );
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function getRuntimePathClassification(projectRoot: string): {
  nonScopeRelevantPaths: Set<string>;
  wuDirPrefix: string;
} {
  const config = getConfig({ projectRoot });
  const stateEventsPath = toPosixPath(`${config.state.stateDir}/wu-events.jsonl`);
  const backlogPath = toPosixPath(config.directories.backlogPath);
  const statusPath = toPosixPath(config.directories.statusPath);
  const wuDirPrefix = toPosixPath(config.directories.wuDir).replace(/\/?$/, '/');

  return {
    nonScopeRelevantPaths: new Set([stateEventsPath, backlogPath, statusPath]),
    wuDirPrefix,
  };
}

/**
 * WU-1618: Treat backlog/state bookkeeping files as non-scope signals.
 */
export function hasScopeRelevantBranchChanges(changedFiles: string[]): boolean {
  const { nonScopeRelevantPaths, wuDirPrefix } = getRuntimePathClassification(process.cwd());
  return changedFiles.some((filePath) => {
    const normalized = toPosixPath(filePath.trim());
    if (!normalized) {
      return false;
    }
    if (nonScopeRelevantPaths.has(normalized)) {
      return false;
    }
    return !normalized.startsWith(wuDirPrefix);
  });
}

/**
 * WU-1618: Support `--replace-code-paths <paths>` shorthand by normalizing to
 * `--replace-code-paths --code-paths <paths>` before Commander parsing.
 */
export function normalizeReplaceCodePathsArgv(argv: string[]): string[] {
  const normalized = [...argv];
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i] !== '--replace-code-paths') {
      continue;
    }
    const next = normalized[i + 1];
    if (next && !next.startsWith('-')) {
      normalized.splice(i + 1, 0, '--code-paths');
      i += 1;
    }
  }
  return normalized;
}
