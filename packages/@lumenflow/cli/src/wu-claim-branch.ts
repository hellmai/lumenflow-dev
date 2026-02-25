// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim-branch.ts
 * @description Branch-only mode claim workflow handler.
 *
 * WU-1649: Extracted from wu-claim.ts to reduce orchestration complexity.
 * All functions are mechanical extractions preserving original behavior.
 */

import { readFile } from 'node:fs/promises';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die, getErrorMessage } from '@lumenflow/core/error-handler';
import {
  BRANCHES,
  REMOTES,
  LOG_PREFIX,
  COMMIT_FORMATS,
  FILE_SYSTEM,
} from '@lumenflow/core/wu-constants';
import { shouldSkipRemoteOperations } from '@lumenflow/core/micro-worktree';
import { emitMandatoryAgentAdvisory } from '@lumenflow/core/orchestration-advisory-loader';
import {
  updateWUYaml,
  addOrReplaceInProgressStatus,
  removeFromReadyAndAddToInProgressBacklog,
  maybeProgressInitiativeStatus,
  ensureCleanOrClaimOnlyWhenNoAuto,
} from './wu-claim-state.js';
import { shouldPersistClaimMetadataOnBranch } from './wu-claim-state.js';
import { surfaceUnreadSignalsForDisplay, printLifecycleNudge } from './wu-claim-output.js';
import type { ClaimContext } from './wu-claim-worktree.js';

const PREFIX = LOG_PREFIX.CLAIM;

/**
 * Execute branch-only mode claim workflow
 */
export async function claimBranchOnlyMode(ctx: ClaimContext) {
  const {
    args,
    id,
    laneK,
    title,
    branch,
    WU_PATH,
    STATUS_PATH,
    BACKLOG_PATH,
    claimedMode,
    shouldCreateBranch,
    currentBranch,
    sessionId,
    updatedTitle,
    currentBranchForCloud, // WU-1590: For persisting claimed_branch
  } = ctx;
  const skipRemote = shouldSkipRemoteOperations();

  if (shouldCreateBranch) {
    // Create branch and switch to it from origin/main (avoids local main mutation)
    try {
      const branchStartPoint = skipRemote ? BRANCHES.MAIN : `${REMOTES.ORIGIN}/${BRANCHES.MAIN}`;
      await getGitForCwd().createBranch(branch, branchStartPoint);
    } catch (error) {
      die(
        `Canonical claim state may be updated, but branch creation failed.\n\n` +
          `Error: ${getErrorMessage(error)}\n\n` +
          `Recovery:\n` +
          `  1. Run: git fetch ${REMOTES.ORIGIN} ${BRANCHES.MAIN}\n` +
          `  2. Retry: pnpm wu:claim --id ${id} --lane "${args.lane}"\n` +
          `  3. If needed, delete local branch: git branch -D ${branch}`,
      );
    }
  } else if (currentBranch !== branch) {
    die(
      `Cloud branch-pr claim must run on the active branch.\n\n` +
        `Current branch: ${currentBranch}\n` +
        `Resolved branch: ${branch}\n\n` +
        `Switch to ${branch} and retry, or omit conflicting --branch flags.`,
    );
  }

  let finalTitle = updatedTitle || title;
  const msg = COMMIT_FORMATS.CLAIM(id.toLowerCase(), laneK);
  const shouldPersistClaimMetadata = shouldPersistClaimMetadataOnBranch({
    claimedMode,
    noPush: Boolean(args.noPush),
    skipRemote,
  });

  if (shouldPersistClaimMetadata) {
    if (args.noAuto) {
      await ensureCleanOrClaimOnlyWhenNoAuto();
    } else {
      // WU-1211: updateWUYaml now returns {title, initiative}
      // WU-1590: Pass claimed_branch for branch-pr persistence
      const updateResult = await updateWUYaml(
        WU_PATH,
        id,
        args.lane,
        claimedMode,
        null,
        sessionId,
        null,
        currentBranchForCloud || null,
      );
      finalTitle = updateResult.title || finalTitle;
      await addOrReplaceInProgressStatus(STATUS_PATH, id, finalTitle);
      await removeFromReadyAndAddToInProgressBacklog(
        BACKLOG_PATH,
        STATUS_PATH,
        id,
        finalTitle,
        args.lane,
      );
      const filesToAdd = [WU_PATH, STATUS_PATH, BACKLOG_PATH];
      // WU-1211: Progress initiative status if needed
      if (updateResult.initiative) {
        const initProgress = await maybeProgressInitiativeStatus(
          process.cwd(),
          updateResult.initiative,
          id,
        );
        if (initProgress.initPath) {
          filesToAdd.push(initProgress.initPath);
        }
      }
      await getGitForCwd().add(filesToAdd);
    }

    await getGitForCwd().commit(msg);
  }

  if (args.noPush || skipRemote) {
    if (skipRemote && !args.noPush) {
      console.warn(
        `${PREFIX} Local-only mode (git.requireRemote=false): skipping origin push; claim is local-only.`,
      );
    } else {
      console.warn(
        `${PREFIX} Warning: --no-push enabled. Claim is local-only and NOT visible to other agents.`,
      );
    }
  } else {
    await getGitForCwd().push(REMOTES.ORIGIN, branch, { setUpstream: true });
  }

  // Summary
  console.log(`\n${PREFIX} Claim recorded in Branch-Only mode.`);
  const wuDisplay = finalTitle ? `- WU: ${id} — ${finalTitle}` : `- WU: ${id}`;
  console.log(wuDisplay);
  console.log(`- Lane: ${args.lane}`);
  console.log(`- Mode: Branch-Only (no worktree)`);
  const refDisplay = args.noPush ? `- Commit: ${msg}` : `- Branch: ${branch}`;
  console.log(refDisplay);
  console.log(
    '\n⚠️  LIMITATION: Branch-Only mode does not support parallel WUs (WIP=1 across ALL lanes)',
  );
  console.log('Next: work on this branch in the main checkout.');

  // WU-1360: Print next-steps checklist to prevent common mistakes
  console.log(`\n${PREFIX} Next steps:`);
  console.log(`  1. Work on this branch in the main checkout`);
  console.log(`  2. Implement changes per acceptance criteria`);
  console.log(`  3. Run: pnpm gates`);
  console.log(`  4. pnpm wu:done --id ${id}`);
  console.log(`\n${PREFIX} Common mistakes to avoid:`);
  console.log(`  - Don't manually edit WU YAML status fields`);
  console.log(`  - Don't create PRs (trunk-based development)`);

  // WU-1501: Hint for sub-agent execution context
  console.log(`\n${PREFIX} For sub-agent execution:`);
  console.log(`  /wu-prompt ${id}  (generates full context prompt)`);

  // Emit mandatory agent advisory based on code_paths (WU-1324)

  const wuContent = await readFile(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const wuDoc = parseYAML(wuContent);
  const codePaths = wuDoc.code_paths || [];
  emitMandatoryAgentAdvisory(codePaths, id);

  // WU-1763: Print lifecycle nudge with tips for tool adoption
  printLifecycleNudge(id);

  // WU-1473: Surface unread coordination signals so agents see pending messages
  // Fail-open: surfaceUnreadSignals never throws
  await surfaceUnreadSignalsForDisplay(process.cwd());
}
