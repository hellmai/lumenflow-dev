#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Release Command (WU-1080)
 *
 * Releases an orphaned WU from in_progress back to ready state.
 * Use when an agent is interrupted mid-WU and the WU needs to be reclaimed.
 *
 * Sequence (micro-worktree pattern):
 * 1) Validate WU is in_progress
 * 2) Create micro-worktree from main
 * 3) Append release event to state store
 * 4) Regenerate backlog.md and status.md
 * 5) Commit in micro-worktree, push directly to origin/main
 * 6) Optionally remove the work worktree
 *
 * Usage:
 *   pnpm wu:release --id WU-1080 --reason "Agent interrupted"
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { generateBacklog, generateStatus } from '@lumenflow/core/backlog-generator';
import { todayISO } from '@lumenflow/core/date-utils';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { readWU, writeWU, appendNote } from '@lumenflow/core/wu-yaml';
import {
  REMOTES,
  BRANCHES,
  WU_STATUS,
  PATTERNS,
  FILE_SYSTEM,
  MICRO_WORKTREE_OPERATIONS,
} from '@lumenflow/core/wu-constants';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import { releaseLaneLock } from '@lumenflow/core/lane-lock';
import { shouldUseBranchPrStatePath } from './wu-state-cloud.js';
import { runCLI } from './cli-entry-point.js';
import { resolveStateDir, resolveWuEventsRelativePath } from './state-path-resolvers.js';

const PREFIX = '[wu-release]';

/**
 * WU-1595: Clear branch claim metadata when releasing WU back to ready.
 *
 * Mutates the provided document.
 */
export function clearClaimMetadataOnRelease(doc: Record<string, unknown>): void {
  delete doc.claimed_mode;
  delete doc.claimed_branch;
}

export function shouldUseBranchPrReleasePath(doc: { claimed_mode?: string }): boolean {
  return shouldUseBranchPrStatePath(doc);
}

export async function main() {
  const args = createWUParser({
    name: 'wu-release',
    description: 'Release an orphaned WU from in_progress back to ready state for reclaiming',
    options: [WU_OPTIONS.id, WU_OPTIONS.reason],
    required: ['id', 'reason'],
    allowPositionalId: true,
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  if (!args.reason) {
    die('Reason is required for releasing a WU. Use --reason "..."');
  }

  // Read WU doc from main to validate state
  const mainWUPath = WU_PATHS.WU(id);
  let doc;
  try {
    doc = readWU(mainWUPath, id);
  } catch (error) {
    die(
      `Failed to read WU ${id}: ${error.message}\n\n` +
        `Options:\n` +
        `  1. Check if WU file exists: ls -la ${mainWUPath}\n` +
        `  2. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  3. Create WU if missing: pnpm wu:create --id ${id} --lane "<lane>" --title "..."`,
    );
  }
  const title = doc.title || '';
  const lane = (doc.lane as string) || 'Unknown';
  const branchPrPath = shouldUseBranchPrReleasePath(doc);

  if (!branchPrPath) {
    await ensureOnMain(getGitForCwd());
  }

  // Validate current status is in_progress
  const currentStatus = doc.status || WU_STATUS.READY;
  if (currentStatus !== WU_STATUS.IN_PROGRESS) {
    die(
      `Cannot release WU ${id}: current status is '${currentStatus}', expected 'in_progress'.\n\n` +
        `The wu:release command is only for releasing orphaned WUs that are stuck in in_progress state.\n\n` +
        `Current state transitions:\n` +
        `  - If status is 'ready': WU has not been claimed yet\n` +
        `  - If status is 'blocked': Use wu:unblock to resume work\n` +
        `  - If status is 'done': WU is already complete`,
    );
  }

  const baseMsg = `wu(${id.toLowerCase()}): release`;
  const commitMsg = `${baseMsg} — ${args.reason}`;

  if (branchPrPath) {
    const currentBranch = await getGitForCwd().getCurrentBranch();
    const claimedBranch = typeof doc.claimed_branch === 'string' ? doc.claimed_branch : '';
    if (claimedBranch && currentBranch !== claimedBranch) {
      die(
        `Cannot release branch-pr WU ${id}: current branch does not match claimed_branch.\n\n` +
          `Current branch: ${currentBranch}\n` +
          `Claimed branch: ${claimedBranch}`,
      );
    }

    doc.status = WU_STATUS.READY;
    clearClaimMetadataOnRelease(doc);
    const noteLine = `Released (${todayISO()}): ${args.reason}`;
    appendNote(doc, noteLine);
    writeWU(mainWUPath, doc);

    const stateDir = resolveStateDir(process.cwd());
    const store = new WUStateStore(stateDir);
    await store.load();
    await store.release(id, args.reason);

    const backlogContent = await generateBacklog(store);
    writeFileSync(WU_PATHS.BACKLOG(), backlogContent, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    });

    const statusContent = await generateStatus(store);
    writeFileSync(WU_PATHS.STATUS(), statusContent, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    });

    await getGitForCwd().add([
      WU_PATHS.WU(id),
      WU_PATHS.STATUS(),
      WU_PATHS.BACKLOG(),
      resolveWuEventsRelativePath(process.cwd()),
    ]);
    await getGitForCwd().commit(commitMsg);
    await getGitForCwd().push(REMOTES.ORIGIN, currentBranch);
  } else {
    // Use micro-worktree pattern to avoid pre-commit hook blocking commits to main
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.WU_BLOCK, // Reuse block operation type
      id,
      logPrefix: PREFIX,
      pushOnly: true, // Push directly to origin/main without touching local main
      execute: async ({ worktreePath }) => {
        // Build paths relative to micro-worktree
        const microWUPath = path.join(worktreePath, WU_PATHS.WU(id));
        const microStatusPath = path.join(worktreePath, WU_PATHS.STATUS());
        const microBacklogPath = path.join(worktreePath, WU_PATHS.BACKLOG());

        // Update WU YAML in micro-worktree - set status back to ready
        const microDoc = readWU(microWUPath, id);
        microDoc.status = WU_STATUS.READY;
        // WU-1595: Clear claim metadata when releasing back to ready.
        clearClaimMetadataOnRelease(microDoc);
        const noteLine = `Released (${todayISO()}): ${args.reason}`;
        appendNote(microDoc, noteLine);
        writeWU(microWUPath, microDoc);

        // Append release event to WUStateStore
        const stateDir = resolveStateDir(worktreePath);
        const store = new WUStateStore(stateDir);
        await store.load();
        await store.release(id, args.reason);

        // Generate backlog.md and status.md from state store
        const backlogContent = await generateBacklog(store);
        writeFileSync(microBacklogPath, backlogContent, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });

        const statusContent = await generateStatus(store);
        writeFileSync(microStatusPath, statusContent, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });

        return {
          commitMessage: commitMsg,
          files: [
            WU_PATHS.WU(id),
            WU_PATHS.STATUS(),
            WU_PATHS.BACKLOG(),
            resolveWuEventsRelativePath(worktreePath),
          ],
        };
      },
    });

    // Fetch to update local main tracking
    await getGitForCwd().fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
  }

  // Release lane lock so another WU can be claimed
  try {
    if (lane) {
      const releaseResult = releaseLaneLock(lane, { wuId: id });
      if (releaseResult.released && !releaseResult.notFound) {
        console.log(`${PREFIX} Lane lock released for "${lane}"`);
      }
    }
  } catch (err) {
    // Non-blocking: lock release failure should not block the release operation
    console.warn(`${PREFIX} Warning: Could not release lane lock: ${err.message}`);
  }

  console.log(`\n${PREFIX} WU released and pushed.`);
  console.log(`- WU: ${id} — ${title}`);
  console.log(`- Status: in_progress → ready`);
  console.log(`- Reason: ${args.reason}`);
  console.log(
    `\n${PREFIX} The WU can now be reclaimed with: pnpm wu:claim --id ${id} --lane "${lane}"`,
  );
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
