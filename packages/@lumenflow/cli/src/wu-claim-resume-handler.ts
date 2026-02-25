// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim-resume-handler.ts
 * @description Resume/handoff mode handler for wu:claim --resume.
 *
 * WU-1649: Extracted from wu-claim.ts to reduce orchestration complexity.
 * All functions are mechanical extractions preserving original behavior.
 */

import path from 'node:path';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { toKebab, LOG_PREFIX, EMOJI } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';
import { emitWUFlowEvent } from '@lumenflow/core/telemetry';
import {
  resumeClaimForHandoff,
  getWorktreeUncommittedChanges,
  formatUncommittedChanges,
  createHandoffCheckpoint,
} from '@lumenflow/core/wu-claim-resume';

const PREFIX = LOG_PREFIX.CLAIM;

/**
 * WU-2411: Handle --resume flag for agent handoff
 *
 * When an agent crashes or is killed, the --resume flag allows a new agent
 * to take over by:
 * 1. Verifying the old PID is dead (safety check)
 * 2. Updating the lock file with the new PID
 * 3. Preserving the existing worktree
 * 4. Printing uncommitted changes summary
 * 5. Creating a checkpoint in the memory layer
 *
 * @param {Object} args - CLI arguments
 * @param {string} id - WU ID
 */
export async function handleResumeMode(args: Record<string, unknown>, id: string) {
  const lane = typeof args.lane === 'string' ? args.lane : '';
  const laneK = toKebab(lane);
  const idK = id.toLowerCase();
  const configuredWorktreesDir = getConfig({ projectRoot: process.cwd() }).directories.worktrees;
  const worktreeArg = typeof args.worktree === 'string' ? args.worktree : undefined;
  const worktree = worktreeArg || path.join(configuredWorktreesDir, `${laneK}-${idK}`);
  const worktreePath = path.resolve(worktree);

  console.log(`${PREFIX} Attempting to resume ${id} in lane "${lane}"...`);

  // Attempt the resume/handoff
  const result = await resumeClaimForHandoff({
    wuId: id,
    lane,
    worktreePath,
    agentSession: null, // Will be populated by session system
  });

  if (!result.success) {
    die(
      `Cannot resume ${id}: ${result.error}\n\n` +
        `If you need to start a fresh claim, use: pnpm wu:claim --id ${id} --lane "${args.lane}"`,
    );
  }

  console.log(`${PREFIX} ${EMOJI.SUCCESS} Handoff successful`);
  console.log(`${PREFIX} Previous PID: ${result.previousPid}`);
  console.log(`${PREFIX} New PID: ${process.pid}`);

  // Get and display uncommitted changes in the worktree
  const wtGit = createGitForPath(worktreePath);
  const uncommittedStatus = await getWorktreeUncommittedChanges(wtGit);

  if (uncommittedStatus) {
    const formatted = formatUncommittedChanges(uncommittedStatus);
    console.log(`\n${PREFIX} ${formatted}`);
  } else {
    console.log(`\n${PREFIX} No uncommitted changes in worktree.`);
  }

  // Create handoff checkpoint in memory layer
  const checkpointResult = await createHandoffCheckpoint({
    wuId: id,
    previousPid: result.previousPid!,
    newPid: process.pid,
    previousSession: result.previousSession,
    uncommittedSummary: uncommittedStatus,
  });

  if (checkpointResult.success && checkpointResult.checkpointId) {
    console.log(
      `${PREFIX} ${EMOJI.SUCCESS} Handoff checkpoint created: ${checkpointResult.checkpointId}`,
    );
  }

  // Emit telemetry event for handoff
  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    lane,
    step: 'resume_handoff',
    previousPid: result.previousPid,
    newPid: process.pid,
    uncommittedChanges: uncommittedStatus ? 'present' : 'none',
  });

  // Print summary
  console.log(`\n${PREFIX} Resume complete. Worktree preserved at: ${worktree}`);
  console.log(`${PREFIX} Next: cd ${worktree} and continue work.`);
  console.log(
    `\n${PREFIX} Tip: Run 'pnpm mem:ready --wu ${id}' to check for pending context from previous session.`,
  );
}
