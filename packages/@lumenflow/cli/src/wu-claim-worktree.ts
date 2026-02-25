// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim-worktree.ts
 * @description Worktree mode claim workflow handler.
 *
 * WU-1649: Extracted from wu-claim.ts to reduce orchestration complexity.
 * All functions are mechanical extractions preserving original behavior.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import {
  BRANCHES,
  REMOTES,
  LOG_PREFIX,
  COMMIT_FORMATS,
  EMOJI,
  FILE_SYSTEM,
  STRING_LITERALS,
} from '@lumenflow/core/wu-constants';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { shouldSkipRemoteOperations } from '@lumenflow/core/micro-worktree';
import { getStateStoreDirFromBacklog } from '@lumenflow/core/wu-paths';
import { emitMandatoryAgentAdvisory } from '@lumenflow/core/orchestration-advisory-loader';
import { getConfig } from '@lumenflow/core/config';
import { autoFixWUYaml } from '@lumenflow/core/wu-yaml-fixer';
import {
  symlinkNodeModules,
  symlinkNestedNodeModules,
  symlinkWorkspaceBinArtifactRoots,
} from '@lumenflow/core/worktree-symlink';
import {
  updateWUYaml,
  appendClaimEventOnly,
  maybeProgressInitiativeStatus,
  getWorktreeCommitFiles,
  applyStagedChangesToMicroWorktree,
} from './wu-claim-state.js';
import {
  surfaceUnreadSignalsForDisplay,
  printProjectDefaults,
  printLifecycleNudge,
} from './wu-claim-output.js';

/**
 * CLI argument shape used by claim workflow handlers.
 */
export interface ClaimArgs {
  lane: string;
  noPush?: boolean;
  noAuto?: boolean;
  skipSetup?: boolean;
  [key: string]: unknown;
}

/**
 * Parsed staged change entry from git diff --cached --name-status.
 * Mirrors ParsedStagedChange in wu-claim-state.ts (not exported).
 */
interface ParsedStagedChangeLocal {
  status: string;
  from?: string;
  filePath?: string;
}

/**
 * Context object threaded through claim workflow functions.
 * Built in wu-claim.ts and consumed by claimWorktreeMode / claimBranchOnlyMode.
 */
export interface ClaimContext {
  args: ClaimArgs;
  id: string;
  laneK: string;
  title: string;
  branch: string;
  worktree: string;
  WU_PATH: string;
  STATUS_PATH: string;
  BACKLOG_PATH: string;
  claimedMode: string;
  shouldCreateBranch?: boolean;
  currentBranch?: string;
  currentBranchForCloud?: string;
  sessionId: string | null;
  updatedTitle: string | null;
  fixableIssues?: unknown[];
  stagedChanges?: ParsedStagedChangeLocal[];
}

const PREFIX = LOG_PREFIX.CLAIM;
const PNPM_BINARY_NAME = 'pnpm';
const PNPM_FROZEN_LOCKFILE_ARGS = ['install', '--frozen-lockfile'];
const WORKTREE_INSTALL_TIMEOUT_MS = 300000;
const WORKTREE_SETUP_WARNING_PREVIEW_COUNT = 3;

/**
 * WU-1213: Handle local-only claim metadata update (noPush mode).
 * Extracted to reduce cognitive complexity of claimWorktreeMode.
 *
 * @returns {Promise<{finalTitle: string, initPathToCommit: string | null}>}
 */
async function handleNoPushMetadataUpdate(ctx: ClaimContext & { worktreePath: string }): Promise<{
  finalTitle: string;
  initPathToCommit: string | null;
}> {
  const {
    args,
    id,
    worktree,
    worktreePath,
    WU_PATH,
    BACKLOG_PATH,
    claimedMode,
    fixableIssues,
    sessionId,
    title,
    updatedTitle,
    stagedChanges,
  } = ctx;

  let finalTitle = updatedTitle || title;
  let initPathToCommit: string | null = null;

  if (args.noAuto) {
    await applyStagedChangesToMicroWorktree(worktreePath, stagedChanges ?? []);
  } else {
    const wtWUPath = path.join(worktreePath, WU_PATH);
    const wtBacklogPath = path.join(worktreePath, BACKLOG_PATH);

    if (fixableIssues && fixableIssues.length > 0) {
      console.log(`${PREFIX} Applying ${fixableIssues.length} YAML fix(es)...`);
      autoFixWUYaml(wtWUPath);
      console.log(`${PREFIX} YAML fixes applied successfully`);
    }

    const updateResult = await updateWUYaml(
      wtWUPath,
      id,
      args.lane,
      claimedMode,
      worktree,
      sessionId,
    );
    finalTitle = updateResult.title || finalTitle;

    const wtStateDir = getStateStoreDirFromBacklog(wtBacklogPath);
    await appendClaimEventOnly(wtStateDir, id, finalTitle, args.lane);

    if (updateResult.initiative) {
      const initProgress = await maybeProgressInitiativeStatus(
        worktreePath,
        updateResult.initiative,
        id,
      );
      initPathToCommit = initProgress.initPath;
    }
  }

  return { finalTitle, initPathToCommit };
}

/**
 * WU-1213: Setup worktree dependencies (symlink or full install).
 * Extracted to reduce cognitive complexity of claimWorktreeMode.
 */
export async function setupWorktreeDependencies(
  worktreePath: string,
  originalCwd: string,
  skipSetup: boolean,
): Promise<void> {
  // eslint-disable-next-line sonarjs/no-selector-parameter -- skipSetup mirrors CLI flag semantics
  if (skipSetup) {
    // WU-1443: Symlink-only mode for fast claims
    const symlinkResult = symlinkNodeModules(worktreePath, console, originalCwd);
    if (symlinkResult.created) {
      console.log(`${PREFIX} ${EMOJI.SUCCESS} node_modules symlinked (--skip-setup mode)`);
    } else if (symlinkResult.refused) {
      console.warn(`${PREFIX} Warning: symlink refused: ${symlinkResult.reason}`);
      console.warn(`${PREFIX} Run 'pnpm install' manually in the worktree`);
    }

    // WU-1579: Auto-symlink nested package node_modules for turbo typecheck
    if (!symlinkResult.refused) {
      const nestedResult = symlinkNestedNodeModules(worktreePath, originalCwd);
      if (nestedResult.created > 0) {
        console.log(
          `${PREFIX} ${EMOJI.SUCCESS} ${nestedResult.created} nested node_modules symlinked for typecheck`,
        );
      }
    }
  } else {
    const seededBinArtifacts = symlinkWorkspaceBinArtifactRoots(worktreePath, originalCwd, console);
    if (seededBinArtifacts.created > 0) {
      console.log(
        `${PREFIX} ${EMOJI.SUCCESS} Seeded ${seededBinArtifacts.created} workspace bin artifact root(s) from main checkout`,
      );
    }
    if (seededBinArtifacts.errors.length > 0) {
      const previewErrors = seededBinArtifacts.errors
        .slice(0, WORKTREE_SETUP_WARNING_PREVIEW_COUNT)
        .map((error) => error.message)
        .join(STRING_LITERALS.NEWLINE + '  - ');
      console.warn(
        `${PREFIX} Warning: failed to seed ${seededBinArtifacts.errors.length} workspace artifact root(s):${STRING_LITERALS.NEWLINE}  - ${previewErrors}`,
      );
    }

    // WU-1023: Full setup mode (default) - run pnpm install with progress indicator
    console.log(`${PREFIX} Installing worktree dependencies (this may take a moment)...`);
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync(PNPM_BINARY_NAME, PNPM_FROZEN_LOCKFILE_ARGS, {
        cwd: worktreePath,
        stdio: 'inherit',
        timeout: WORKTREE_INSTALL_TIMEOUT_MS, // 5 minute timeout
      });
      console.log(`${PREFIX} ${EMOJI.SUCCESS} Worktree dependencies installed`);
    } catch (installError) {
      console.warn(`${PREFIX} Warning: pnpm install failed: ${installError.message}`);
      console.warn(`${PREFIX} You may need to run 'pnpm install' manually in the worktree`);
      console.log(`${PREFIX} Falling back to symlink approach...`);
      applyFallbackSymlinks(worktreePath, originalCwd, console);
    }
  }
}

/**
 * WU-1029: Apply symlink fallback (root + nested node_modules) after install failure.
 *
 * @param {string} worktreePath - Worktree path
 * @param {string} mainRepoPath - Main repo path
 * @param {Console} logger - Logger (console-compatible)
 */
export function applyFallbackSymlinks(
  worktreePath: string,
  mainRepoPath: string,
  logger = console,
) {
  const symlinkResult = symlinkNodeModules(worktreePath, logger, mainRepoPath);
  if (symlinkResult.created) {
    logger.log(`${PREFIX} ${EMOJI.SUCCESS} node_modules symlinked as fallback`);
  }

  let nestedResult = null;
  if (!symlinkResult.refused) {
    nestedResult = symlinkNestedNodeModules(worktreePath, mainRepoPath);
    if (nestedResult.created > 0) {
      logger.log(
        `${PREFIX} ${EMOJI.SUCCESS} ${nestedResult.created} nested node_modules symlinked for typecheck`,
      );
    }
  }

  return { symlinkResult, nestedResult };
}

/**
 * Execute worktree mode claim workflow
 *
 * WU-1741: Removed micro-worktree pattern that committed to main during claim.
 * Branch existence (e.g. lane/operations/wu-1234) is the coordination lock.
 * Metadata updates happen IN the work worktree, NOT on main.
 *
 * New flow:
 * 1. Create work worktree+branch from main (branch = lock)
 * 2. Update metadata (WU YAML, status.md, backlog.md) IN worktree
 * 3. Commit metadata in worktree
 * 4. Main only changes via wu:done (single merge point)
 *
 * Benefits:
 * - Simpler mental model: main ONLY changes via wu:done
 * - Branch existence is natural coordination (git prevents duplicates)
 * - Less network traffic (no push during claim)
 * - Cleaner rollback: delete worktree+branch = claim undone
 */
export async function claimWorktreeMode(ctx: ClaimContext) {
  const { args, id, laneK, title, branch, worktree, WU_PATH, updatedTitle } = ctx;

  const originalCwd = process.cwd();
  const worktreePath = path.resolve(worktree);
  const skipRemote = shouldSkipRemoteOperations();
  let finalTitle = updatedTitle || title;
  const commitMsg = COMMIT_FORMATS.CLAIM(id.toLowerCase(), laneK);

  // WU-1741: Step 1 - Create work worktree+branch from main
  console.log(`${PREFIX} Creating worktree (branch = coordination lock)...`);
  // WU-1653: Use local main when no remote (requireRemote=false)
  const startPoint =
    args.noPush || skipRemote ? BRANCHES.MAIN : `${REMOTES.ORIGIN}/${BRANCHES.MAIN}`;
  await getGitForCwd().worktreeAdd(worktree, branch, startPoint);
  console.log(`${PREFIX} ${EMOJI.SUCCESS} Worktree created at ${worktree}`);

  // WU-1653: Skip push when requireRemote=false (no remote exists)
  if (!args.noPush && !skipRemote) {
    const wtGit = createGitForPath(worktreePath);
    await wtGit.push(REMOTES.ORIGIN, branch, { setUpstream: true });
  }

  // Handle local-only claim metadata update (--no-push or requireRemote=false)
  if (args.noPush || skipRemote) {
    const metadataResult = await handleNoPushMetadataUpdate({ ...ctx, worktreePath });
    finalTitle = metadataResult.finalTitle;

    // Commit metadata in worktree
    console.log(`${PREFIX} Committing claim metadata in worktree...`);
    const wtGit = createGitForPath(worktreePath);
    const filesToCommit = getWorktreeCommitFiles(id);
    if (metadataResult.initPathToCommit) {
      filesToCommit.push(metadataResult.initPathToCommit);
    }
    await wtGit.add(filesToCommit);
    await wtGit.commit(commitMsg);

    console.log(`${PREFIX} ${EMOJI.SUCCESS} Claim committed: ${commitMsg}`);
    if (skipRemote && !args.noPush) {
      console.log(
        `${PREFIX} Local-only mode (git.requireRemote=false): claim metadata committed in worktree.`,
      );
    } else {
      console.warn(
        `${PREFIX} Warning: --no-push enabled. Claim is local-only and NOT visible to other agents.`,
      );
    }
  }

  // WU-1023: Auto-setup worktree dependencies
  await setupWorktreeDependencies(worktreePath, originalCwd, !!args.skipSetup);

  console.log(`${PREFIX} Claim recorded in worktree`);
  const worktreeWuDisplay = finalTitle ? `- WU: ${id} — ${finalTitle}` : `- WU: ${id}`;
  console.log(worktreeWuDisplay);
  console.log(`- Lane: ${args.lane}`);
  console.log(`- Worktree: ${worktreePath}`);
  console.log(`- Branch: ${branch}`);
  console.log(`- Commit: ${commitMsg}`);

  // Summary
  console.log(`\n${PREFIX} Worktree created and claim committed.`);
  console.log(`Next: cd ${worktree} and begin work.`);

  // WU-1360: Print next-steps checklist to prevent common mistakes
  console.log(`\n${PREFIX} Next steps:`);
  console.log(`  1. cd ${worktree}  (IMPORTANT: work here, not main)`);
  console.log(`  2. Implement changes per acceptance criteria`);
  console.log(`  3. Run: pnpm gates`);
  console.log(`  4. cd ${originalCwd} && pnpm wu:done --id ${id}`);
  console.log(`\n${PREFIX} Common mistakes to avoid:`);
  console.log(`  - Don't edit files on main branch`);
  console.log(`  - Don't manually edit WU YAML status fields`);
  console.log(`  - Don't create PRs (trunk-based development)`);

  // WU-1501: Hint for sub-agent execution context
  console.log(`\n${PREFIX} For sub-agent execution:`);
  console.log(`  /wu-prompt ${id}  (generates full context prompt)`);

  // Emit mandatory agent advisory based on code_paths (WU-1324)
  // Read from worktree since that's where the updated YAML is
  const wtWUPathForAdvisory = path.join(worktreePath, WU_PATH);

  const wuContent = await readFile(wtWUPathForAdvisory, {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
  const wuDoc = parseYAML(wuContent);
  const codePaths = wuDoc.code_paths || [];
  emitMandatoryAgentAdvisory(codePaths, id);

  // WU-1047: Emit agent-only project defaults from config
  const config = getConfig();
  printProjectDefaults(config?.agents?.methodology);

  // WU-1763: Print lifecycle nudge with tips for tool adoption
  printLifecycleNudge(id);

  // WU-1473: Surface unread coordination signals so agents see pending messages
  // Fail-open: surfaceUnreadSignals never throws
  await surfaceUnreadSignalsForDisplay(originalCwd);
}
