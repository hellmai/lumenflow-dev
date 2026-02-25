#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Unblock Helper
 *
 * Sequence (micro-worktree pattern):
 * 1) Create micro-worktree from main
 * 2) Auto-update WU YAML/backlog/status to In Progress in micro-worktree
 * 3) Commit in micro-worktree, push directly to origin/main
 * 4) Optionally create a fresh work worktree/branch (default: skip unless --create-worktree)
 *
 * Uses micro-worktree pattern to avoid pre-commit hook blocking commits to main.
 *
 * Usage:
 *   pnpm wu:unblock --id WU-334 [--reason "Dependency cleared"] [--create-worktree] [--worktree ...] [--branch ...] [--no-auto]
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertTransition } from '@lumenflow/core/state-machine';
import { checkLaneFree, getLockPolicyForLane } from '@lumenflow/core/lane-checker';
// WU-1325: Import lane lock functions for policy-based lock acquisition on unblock
import { acquireLaneLock } from '@lumenflow/core/lane-lock';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { todayISO } from '@lumenflow/core/date-utils';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS, defaultWorktreeFrom } from '@lumenflow/core/wu-paths';
import { getConfig } from '@lumenflow/core/config';
import { readWU, writeWU, appendNote } from '@lumenflow/core/wu-yaml';
import {
  STATUS_SECTIONS,
  PATTERNS,
  LOG_PREFIX,
  WU_STATUS,
  REMOTES,
  BRANCHES,
  GIT_REFS,
  FILE_SYSTEM,
  MICRO_WORKTREE_OPERATIONS,
} from '@lumenflow/core/wu-constants';
import { defaultBranchFrom } from '@lumenflow/core/wu-done-validators';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { emitWUFlowEvent } from '@lumenflow/core/telemetry';
import { ensureStaged } from '@lumenflow/core/git-staged-validator';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
// WU-1574: Import backlog generator to replace BacklogManager
import { generateBacklog, generateStatus } from '@lumenflow/core/backlog-generator';
import { shouldUseBranchPrStatePath } from './wu-state-cloud.js';
import { runCLI } from './cli-entry-point.js';
import { resolveStateDir, resolveWuEventsRelativePath } from './state-path-resolvers.js';

// ensureOnMain() moved to wu-helpers.ts (WU-1256)
// ensureStaged() moved to git-staged-validator.ts (WU-1341)
// defaultWorktreeFrom() moved to wu-paths.ts (WU-1341)

const PREFIX = LOG_PREFIX.UNBLOCK;

/** Parsed CLI arguments for wu:unblock */
interface UnblockCliArgs {
  id: string;
  reason?: string;
  createWorktree?: boolean;
  worktree?: string;
  branch?: string;
  noAuto?: boolean;
  force?: boolean;
}

/** Lane occupancy check result from checkLaneFree */
interface LaneCheckResult {
  free: boolean;
  occupiedBy: string | null;
  error: string | null;
}

// WU-1574: Removed legacy backlog manipulation functions
// All backlog/status updates now use WUStateStore + backlog generator

// defaultBranchFrom() consolidated to wu-done-validators.ts (emergency fix)

export function shouldUseBranchPrUnblockPath(doc: { claimed_mode?: string }): boolean {
  return shouldUseBranchPrStatePath(doc);
}

function branchExists(branch: string): boolean {
  try {
    getGitForCwd().run(`git rev-parse --verify ${JSON.stringify(branch)}`);
    return true;
  } catch {
    return false;
  }
}

function createWorktree(
  doc: Record<string, unknown>,
  worktreePath: string | null,
  branchName: string,
) {
  if (!worktreePath) die('Worktree path required to create a worktree');

  if (existsSync(worktreePath)) {
    console.warn(`${PREFIX} Worktree ${worktreePath} already exists; skipping creation.`);
    return;
  }
  getGitForCwd().run(`git fetch ${REMOTES.ORIGIN} ${BRANCHES.MAIN}`);
  if (branchExists(branchName)) {
    getGitForCwd().run(
      `git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(branchName)}`,
    );
  } else {
    getGitForCwd().run(
      `git worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(branchName)} ${GIT_REFS.ORIGIN_MAIN}`,
    );
  }
}

// emitTelemetry() moved to telemetry.ts as emitWUFlowEvent() (WU-1256)

/**
 * Handle lane occupancy check and enforce WIP=1 policy
 */
function handleLaneOccupancy(
  laneCheck: LaneCheckResult,
  lane: string,
  id: string,
  force: boolean | undefined,
) {
  if (laneCheck.free) return;

  if (laneCheck.error) {
    die(`Lane check failed: ${laneCheck.error}`);
  }

  if (!laneCheck.occupiedBy) return;

  if (force) {
    console.warn(`${PREFIX} ⚠️  WARNING: Lane "${lane}" is occupied by ${laneCheck.occupiedBy}`);
    console.warn(`${PREFIX} ⚠️  Forcing WIP=2 in same lane. Risk of worktree collision!`);
    console.warn(`${PREFIX} ⚠️  Use only for P0 emergencies or manual recovery.`);
    return;
  }

  die(
    `Lane "${lane}" is already occupied by ${laneCheck.occupiedBy}.\n\n` +
      `LumenFlow enforces one-WU-per-lane to maintain focus.\n\n` +
      `Options:\n` +
      `  1. Wait for ${laneCheck.occupiedBy} to complete or block\n` +
      `  2. Move ${id} to a different lane\n` +
      `  3. Use --force to override (P0 emergencies only)\n\n` +
      // WU-1311: Use config-based status path
      `To check lane status: grep "${STATUS_SECTIONS.IN_PROGRESS}" ${getConfig().directories.statusPath}`,
  );
}

/**
 * Handle optional worktree creation after unblock
 */
function handleWorktreeCreation(args: UnblockCliArgs, doc: Record<string, unknown>) {
  if (!args.createWorktree) return;

  const worktreePath = args.worktree || defaultWorktreeFrom(doc);
  const branchName = args.branch || defaultBranchFrom(doc);
  if (!branchName) {
    console.warn(`${PREFIX} Cannot derive branch name; skipping worktree creation.`);
    return;
  }
  createWorktree(doc, worktreePath, branchName);
}

export async function main() {
  const args = createWUParser({
    name: 'wu-unblock',
    description: 'Unblock a work unit and move it from blocked to in-progress status',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.reason,
      WU_OPTIONS.createWorktree,
      WU_OPTIONS.worktree,
      WU_OPTIONS.branch,
      WU_OPTIONS.noAuto,
      WU_OPTIONS.force,
    ],
    required: ['id'],
    allowPositionalId: true,
  }) as UnblockCliArgs;

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  // Read WU doc from main to get title, lane, and validate state transition
  const mainWUPath = WU_PATHS.WU(id);
  let doc;
  try {
    doc = readWU(mainWUPath, id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    die(
      `Failed to read WU ${id}: ${message}\n\n` +
        `Options:\n` +
        `  1. Check if WU file exists: ls -la ${mainWUPath}\n` +
        `  2. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  3. Create WU if missing: pnpm wu:create --id ${id} --lane "<lane>" --title "..."`,
    );
  }
  const title = typeof doc.title === 'string' ? doc.title : '';
  const lane = typeof doc.lane === 'string' ? doc.lane : 'Unknown';
  const branchPrPath = shouldUseBranchPrUnblockPath(doc);

  if (!branchPrPath) {
    await ensureOnMain(getGitForCwd());
  }

  // Validate state transition before micro-worktree
  const currentStatus = (doc.status as string) || WU_STATUS.BLOCKED;
  try {
    assertTransition(currentStatus, WU_STATUS.IN_PROGRESS, id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    die(
      `State transition validation failed: ${message}\n\n` +
        `Options:\n` +
        `  1. Check WU current status: grep status ${mainWUPath}\n` +
        `  2. Only blocked or waiting WUs can be unblocked\n` +
        `  3. If WU is done or ready, use wu:claim instead`,
    );
  }

  // Check lane occupancy
  const statusPath = WU_PATHS.STATUS();
  const laneCheck = checkLaneFree(statusPath, lane, id);

  // Emit telemetry
  emitWUFlowEvent({
    script: 'wu-unblock',
    wu_id: id,
    lane: lane,
    step: 'lane_check',
    occupied: !laneCheck.free,
    occupiedBy: laneCheck.occupiedBy,
  });

  handleLaneOccupancy(laneCheck, lane, id, args.force);

  const baseMsg = `wu(${id.toLowerCase()}): unblock`;
  const commitMsg = args.reason ? `${baseMsg} — ${args.reason}` : baseMsg;

  if (!args.noAuto) {
    if (branchPrPath) {
      const currentBranch = await getGitForCwd().getCurrentBranch();
      const claimedBranch = typeof doc.claimed_branch === 'string' ? doc.claimed_branch : '';
      if (claimedBranch && currentBranch !== claimedBranch) {
        die(
          `Cannot unblock branch-pr WU ${id}: current branch does not match claimed_branch.\n\n` +
            `Current branch: ${currentBranch}\n` +
            `Claimed branch: ${claimedBranch}`,
        );
      }

      doc.status = WU_STATUS.IN_PROGRESS;
      const noteLine = args.reason
        ? `Unblocked (${todayISO()}): ${args.reason}`
        : `Unblocked (${todayISO()})`;
      appendNote(doc, noteLine);
      writeWU(mainWUPath, doc);

      const stateDir = resolveStateDir(process.cwd());
      const store = new WUStateStore(stateDir);
      await store.load();
      await store.unblock(id);

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
        operation: MICRO_WORKTREE_OPERATIONS.WU_UNBLOCK,
        id,
        logPrefix: PREFIX,
        pushOnly: true, // Push directly to origin/main without touching local main
        execute: async ({ worktreePath }) => {
          // Build paths relative to micro-worktree
          const microWUPath = path.join(worktreePath, WU_PATHS.WU(id));
          const microStatusPath = path.join(worktreePath, WU_PATHS.STATUS());
          const microBacklogPath = path.join(worktreePath, WU_PATHS.BACKLOG());

          // Update WU YAML in micro-worktree
          const microDoc = readWU(microWUPath, id);
          microDoc.status = WU_STATUS.IN_PROGRESS;
          const noteLine = args.reason
            ? `Unblocked (${todayISO()}): ${args.reason}`
            : `Unblocked (${todayISO()})`;
          appendNote(microDoc, noteLine);
          writeWU(microWUPath, microDoc);

          // WU-1574: Update state store first, then regenerate backlog.md from state
          const stateDir = resolveStateDir(worktreePath);
          const store = new WUStateStore(stateDir);
          await store.load();
          await store.unblock(id);

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
  } else {
    // Manual mode: expect files already staged
    ensureStaged([mainWUPath, WU_PATHS.STATUS(), WU_PATHS.BACKLOG()]);
    await getGitForCwd().commit(commitMsg);
    if (branchPrPath) {
      const currentBranch = await getGitForCwd().getCurrentBranch();
      await getGitForCwd().push(REMOTES.ORIGIN, currentBranch);
    } else {
      await getGitForCwd().push(REMOTES.ORIGIN, BRANCHES.MAIN);
    }
  }

  handleWorktreeCreation(args, doc);

  // WU-1325: Re-acquire lane lock when WU is unblocked (only for lock_policy=active)
  // For policy=all, lock was retained through the block cycle
  // For policy=none, no lock exists to acquire
  try {
    if (lane && lane !== 'Unknown') {
      const lockPolicy = getLockPolicyForLane(lane);
      if (lockPolicy === 'active') {
        const lockResult = acquireLaneLock(lane, id);
        if (lockResult.acquired && !lockResult.skipped) {
          console.log(`${PREFIX} Lane lock re-acquired for "${lane}" (lock_policy=active)`);
        } else if (!lockResult.acquired) {
          // Lock acquisition failed - another WU claimed the lane while we were blocked
          console.warn(`${PREFIX} Warning: Could not re-acquire lane lock: ${lockResult.error}`);
          console.warn(
            `${PREFIX} Another WU may have claimed lane "${lane}" while this WU was blocked.`,
          );
        }
      } else if (lockPolicy === 'all') {
        console.log(`${PREFIX} Lane lock retained for "${lane}" (lock_policy=all)`);
      }
      // For policy=none, no lock exists - nothing to do
    }
  } catch (err: unknown) {
    // Non-blocking: lock acquisition failure should not block the unblocking operation
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${PREFIX} Warning: Could not acquire lane lock: ${message}`);
  }

  console.log(`\n${PREFIX} Marked in progress and pushed.`);
  console.log(`- WU: ${id} — ${title}`);
  if (args.reason) console.log(`- Reason: ${args.reason}`);
  if (args.createWorktree) console.log(`- Worktree: ${args.worktree || defaultWorktreeFrom(doc)}`);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
