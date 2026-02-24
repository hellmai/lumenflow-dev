#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Rebase operations and conflict resolution for wu:done
 *
 * Extracted from wu-done-worktree.ts to enforce single responsibility.
 * Handles auto-rebase of lane branches onto main, including auto-resolution
 * of conflicts in append-only files (wu-events.jsonl, backlog, status).
 *
 * Functions:
 *   autoRebaseBranch             - Auto-rebase lane branch onto main
 *   autoResolveAppendOnlyConflicts - Resolve conflicts in append-only files
 *   assertNoConflictArtifactsInIndex - Verify no leftover conflict markers
 */

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createGitForPath, type GitAdapter } from './git-adapter.js';
import {
  BRANCHES,
  REMOTES,
  LOG_PREFIX,
  EMOJI,
  COMMIT_FORMATS,
  GIT_COMMANDS,
  LUMENFLOW_PATHS,
} from './wu-constants.js';
import { REBASE } from './wu-done-messages.js';
import { WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import { WU_PATHS } from './wu-paths.js';
// WU-1371: Import rebase artifact cleanup functions
import { detectRebasedArtifacts, cleanupRebasedArtifacts } from './rebase-artifact-cleanup.js';
// WU-1061: Import docs regeneration utilities
import {
  maybeRegenerateAndStageDocs,
  DOC_OUTPUT_FILES,
  formatDocOutputs,
} from './wu-done-docs-generate.js';
import { getErrorMessage, createError, ErrorCodes } from './error-handler.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * List of append-only files that can be auto-resolved during rebase
 * WU-1749 Bug 3: These files can safely have conflicts resolved by keeping both additions
 *
 * Uses WU_PATHS constants and WU_EVENTS_FILE_NAME to avoid hardcoded path strings
 * that would break if paths are rearranged.
 */
const APPEND_ONLY_FILES = [
  // State store events file (append-only by design) - WU-1430: Use centralized constant
  path.join(LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME),
  // Status and backlog are generated from state store but may conflict during rebase
  WU_PATHS.STATUS(),
  WU_PATHS.BACKLOG(),
];

// WU-1430: Use centralized constant
const WU_EVENTS_PATH = path.join(LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);
const WU_EVENTS_PATH_POSIX = WU_EVENTS_PATH.split(path.sep).join('/');

const REBASE_CONFLICT_GIT = {
  DIFF_UNMERGED_ARGS: [GIT_COMMANDS.DIFF, '--name-only', '--diff-filter=U'] as const,
  // Keep whitespace checking disabled intentionally: we only want structural conflict artifacts
  // (leftover merge markers), not generic whitespace findings in this safety check.
  DIFF_CHECK_ARGS: [
    '-c',
    'core.whitespace=',
    GIT_COMMANDS.DIFF,
    '--check',
    '--cached',
    '--',
  ] as const,
  SHOW_OURS: (filePath: string): string[] => ['show', `:2:${filePath}`],
  SHOW_THEIRS: (filePath: string): string[] => ['show', `:3:${filePath}`],
  CHECKOUT_THEIRS: (filePath: string): string[] => ['checkout', '--theirs', filePath],
};

const REBASE_CONFLICT_MESSAGES = {
  UNMERGED_FILES_REMAIN: (files: string): string =>
    `Unmerged files remain in index:\n  ${files}\nResolve conflicts before continuing.`,
  STAGED_ARTIFACTS_OR_CHECK_FAILURE: (details: string): string =>
    `git diff --check reported conflict artifacts or failed to run cleanly. Resolve conflicts before continuing.\n${details}`,
} as const;

const REBASE_CONFLICT_LIMITS = {
  MAX_CONTINUE_ATTEMPTS: 6,
} as const;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isAppendOnlyConflictFile(filePath: string): boolean {
  const normalizedFilePath = toPosixPath(filePath);
  return APPEND_ONLY_FILES.some((appendFile) => {
    const normalizedAppendFile = toPosixPath(appendFile);
    return (
      normalizedFilePath === normalizedAppendFile ||
      normalizedFilePath.endsWith(`/${normalizedAppendFile}`)
    );
  });
}

interface ParsedWuEventLine {
  event: WUEvent;
  line: string;
}

function normalizeEventForKey(event: WUEvent): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(event).sort()) {
    normalized[key] = event[key as keyof WUEvent];
  }
  return normalized;
}

function parseWuEventsJsonl(content: string, sourceLabel: string): ParsedWuEventLine[] {
  const lines = String(content)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error: unknown) {
      throw createError(
        ErrorCodes.PARSE_ERROR,
        `wu-events.jsonl ${sourceLabel} has malformed JSON on line ${index + 1}: ${getErrorMessage(error)}`,
      );
    }

    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `wu-events.jsonl ${sourceLabel} has invalid event on line ${index + 1}: ${issues}`,
      );
    }

    return { event: validation.data, line };
  });
}

async function resolveWuEventsJsonlConflict(
  gitCwd: GitAdapter,
  filePath: string,
  worktreePath: string,
): Promise<void> {
  const ours = await gitCwd.raw(REBASE_CONFLICT_GIT.SHOW_OURS(filePath));
  const theirs = await gitCwd.raw(REBASE_CONFLICT_GIT.SHOW_THEIRS(filePath));

  const theirsEvents = parseWuEventsJsonl(theirs, 'theirs');
  const oursEvents = parseWuEventsJsonl(ours, 'ours');

  const seen = new Set();
  const mergedLines = [];

  for (const { event, line } of theirsEvents) {
    const key = JSON.stringify(normalizeEventForKey(event));
    if (seen.has(key)) continue;
    seen.add(key);
    mergedLines.push(line);
  }

  for (const { event, line } of oursEvents) {
    const key = JSON.stringify(normalizeEventForKey(event));
    if (seen.has(key)) continue;
    seen.add(key);
    mergedLines.push(line);
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(worktreePath, filePath);
  await writeFile(resolvedPath, mergedLines.join('\n') + '\n', 'utf-8');
  await gitCwd.add(filePath);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Assert that no conflict artifacts remain in the git index.
 *
 * Checks for:
 * 1. Unmerged files (UU, AA, AU, UA etc.)
 * 2. Leftover conflict markers in staged files (via git diff --check)
 *
 * @param gitCwd - Git adapter instance
 * @param files - Optional list of specific files to check
 * @param options - Check options
 */
export async function assertNoConflictArtifactsInIndex(
  gitCwd: GitAdapter,
  files?: string[],
  options: { checkStaged?: boolean } = {},
): Promise<void> {
  const unresolvedFilesOutput = await gitCwd.raw([...REBASE_CONFLICT_GIT.DIFF_UNMERGED_ARGS]);
  const unresolvedFiles = unresolvedFilesOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (unresolvedFiles.length > 0) {
    throw createError(
      ErrorCodes.REBASE_CONFLICT,
      REBASE_CONFLICT_MESSAGES.UNMERGED_FILES_REMAIN(unresolvedFiles.join('\n  ')),
    );
  }

  if (options.checkStaged === false) {
    return;
  }

  const checkArgs = [...REBASE_CONFLICT_GIT.DIFF_CHECK_ARGS];
  if (files && files.length > 0) {
    checkArgs.push(...files);
  }

  try {
    const checkOutput = await gitCwd.raw(checkArgs);
    if (checkOutput.trim().length > 0) {
      throw createError(ErrorCodes.REBASE_CONFLICT, checkOutput.trim());
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw createError(
      ErrorCodes.REBASE_CONFLICT,
      REBASE_CONFLICT_MESSAGES.STAGED_ARTIFACTS_OR_CHECK_FAILURE(message),
    );
  }
}

/**
 * Auto-resolve conflicts in append-only files during rebase
 * WU-1749 Bug 3: Keeps both additions for append-only files
 *
 * @param {object} gitCwd - Git adapter instance
 * @param {string} worktreePath - Path to worktree
 * @returns {Promise<{resolved: boolean, files: string[]}>} Resolution result
 */
export async function autoResolveAppendOnlyConflicts(
  gitCwd: GitAdapter,
  worktreePath: string,
): Promise<{ resolved: boolean; files: string[] }> {
  const resolvedFiles: string[] = [];

  try {
    // Use git's unmerged index view so AA/AU/UA/etc are all handled (not only UU).
    const unmergedOutput = await gitCwd.raw([...REBASE_CONFLICT_GIT.DIFF_UNMERGED_ARGS]);
    const conflictFiles = unmergedOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const filePath of conflictFiles) {
      // Check if this is an append-only file
      const isAppendOnly = isAppendOnlyConflictFile(filePath);

      if (isAppendOnly) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-resolving append-only conflict: ${filePath}`,
        );

        if (toPosixPath(filePath).endsWith(WU_EVENTS_PATH_POSIX)) {
          // For the event log we must keep BOTH sides (loss breaks state machine).
          // Merge strategy: union by event identity (validated), prefer theirs ordering then ours additions.
          await resolveWuEventsJsonlConflict(gitCwd, filePath, worktreePath);
        } else {
          // Backlog/status are derived; prefer main's version during rebase and regenerate later.
          await gitCwd.raw(REBASE_CONFLICT_GIT.CHECKOUT_THEIRS(filePath));
          await gitCwd.add(filePath);
        }
        resolvedFiles.push(filePath);
      }
    }

    return { resolved: resolvedFiles.length > 0, files: resolvedFiles };
  } catch (error: unknown) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not auto-resolve conflicts: ${getErrorMessage(error)}`,
    );
    return { resolved: false, files: [] };
  }
}

/**
 * Auto-rebase branch onto main
 * WU-1303: Auto-rebase on wu:done to handle diverged branches automatically
 * WU-1371: Added wuId parameter for post-rebase artifact cleanup
 * WU-1749 Bug 3: Auto-resolve append-only file conflicts during rebase
 *
 * @param {string} branch - Lane branch name
 * @param {string} worktreePath - Path to worktree
 * @param {string} [wuId] - WU ID for artifact cleanup (e.g., 'WU-1371')
 * @returns {Promise<{success: boolean, error?: string}>} Rebase result
 */
export async function autoRebaseBranch(
  branch: string,
  worktreePath: string,
  wuId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  console.log(REBASE.STARTING(branch, BRANCHES.MAIN));

  // WU-1541: Use explicit baseDir instead of process.chdir for git operations
  const gitWorktree = createGitForPath(worktreePath);
  const previousEditor = process.env.GIT_EDITOR;
  process.env.GIT_EDITOR = 'true';

  try {
    // Fetch latest main (using worktree git context)
    await gitWorktree.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    // Attempt rebase
    try {
      await gitWorktree.rebase(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);
    } catch (rebaseError: unknown) {
      // WU-1749 Bug 3: Check if conflicts are in append-only files that can be auto-resolved
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Rebase hit conflicts, checking for auto-resolvable...`,
      );

      const resolution = await autoResolveAppendOnlyConflicts(gitWorktree, worktreePath);

      if (resolution.resolved) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Auto-resolved ${resolution.files.length} append-only conflict(s)`,
        );
        await assertNoConflictArtifactsInIndex(gitWorktree, resolution.files);

        // Continue the rebase after resolving conflicts
        let continueAttempts = 0;
        while (true) {
          try {
            await gitWorktree.raw(['rebase', '--continue']);
            break;
          } catch (continueError) {
            continueAttempts += 1;
            if (continueAttempts >= REBASE_CONFLICT_LIMITS.MAX_CONTINUE_ATTEMPTS) {
              throw continueError;
            }

            const nextResolution = await autoResolveAppendOnlyConflicts(gitWorktree, worktreePath);
            if (!nextResolution.resolved) {
              // Still have non-auto-resolvable conflicts
              throw continueError;
            }

            await assertNoConflictArtifactsInIndex(gitWorktree, nextResolution.files);
          }
        }
      } else {
        // No auto-resolvable conflicts - rethrow original error
        throw rebaseError;
      }
    }

    // WU-1371: Detect and cleanup rebased completion artifacts
    // After rebase, check if main's completion artifacts (stamps, status=done)
    // were pulled into the worktree. These must be cleaned before continuing.
    // WU-1817: Now passes gitCwd to verify artifacts exist on origin/main
    if (wuId) {
      const artifacts = await detectRebasedArtifacts(worktreePath, wuId, gitWorktree);
      if (artifacts.hasArtifacts) {
        console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Detected rebased completion artifacts`);
        const cleanup = await cleanupRebasedArtifacts(worktreePath, wuId);
        if (cleanup.cleaned) {
          // Stage and commit the cleanup
          await gitWorktree.add('.');
          await gitWorktree.commit(COMMIT_FORMATS.REBASE_ARTIFACT_CLEANUP(wuId));
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Cleaned rebased artifacts and committed`,
          );
        }
      }
    }

    // WU-1657: Reconcile generated docs after rebase to avoid format-check loops.
    // A rebase can pull generated docs changes from main that need regeneration and/or formatting.
    if (wuId) {
      const docsResult = await maybeRegenerateAndStageDocs({
        baseBranch: `${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
        repoRoot: worktreePath,
      });

      if (!docsResult.regenerated) {
        const changedDocOutputs = await gitWorktree.raw([
          'diff',
          '--name-only',
          `${REMOTES.ORIGIN}/${BRANCHES.MAIN}...HEAD`,
          '--',
          ...DOC_OUTPUT_FILES,
        ]);

        if (changedDocOutputs.trim().length > 0) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.INFO} Reconciling rebased generated docs outputs...`,
          );
          formatDocOutputs(worktreePath);
          await gitWorktree.add([...DOC_OUTPUT_FILES]);
        }
      }

      const stagedDocOutputs = await gitWorktree.raw([
        'diff',
        '--cached',
        '--name-only',
        '--',
        ...DOC_OUTPUT_FILES,
      ]);

      if (stagedDocOutputs.trim().length > 0) {
        await gitWorktree.commit(COMMIT_FORMATS.REBASE_ARTIFACT_CLEANUP(wuId));
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Committed rebased generated docs reconciliation`,
        );
      }
    }

    // Force-push lane branch with lease (safe force push)
    await gitWorktree.raw(['push', '--force-with-lease', REMOTES.ORIGIN, branch]);

    console.log(REBASE.SUCCESS);
    return { success: true };
  } catch (e: unknown) {
    // Rebase failed (likely conflicts) - abort and report
    console.error(REBASE.FAILED(getErrorMessage(e)));

    try {
      // Abort the failed rebase to leave worktree clean
      await gitWorktree.raw(['rebase', '--abort']);
      console.log(REBASE.ABORTED);
    } catch {
      // Ignore abort errors - may already be clean
    }

    return {
      success: false,
      error: REBASE.MANUAL_FIX(worktreePath, REMOTES.ORIGIN, BRANCHES.MAIN, branch),
    };
  } finally {
    if (previousEditor === undefined) {
      delete process.env.GIT_EDITOR;
    } else {
      process.env.GIT_EDITOR = previousEditor;
    }
  }
}
