#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Block Helper
 *
 * Sequence (micro-worktree pattern):
 * 1) Create micro-worktree from main
 * 2) Auto-update WU YAML/backlog/status to Blocked in micro-worktree
 * 3) Commit in micro-worktree, push directly to origin/main
 * 4) Optionally remove work worktree (default: keep)
 *
 * Uses micro-worktree pattern to avoid pre-commit hook blocking commits to main.
 *
 * Usage:
 *   pnpm wu:block --id WU-334 [--reason "Waiting on policy"] [--worktree ...] [--remove-worktree] [--no-auto]
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { assertTransition } from '@lumenflow/core/state-machine';
// WU-1574: Removed parseBacklogFrontmatter, getSectionHeadings (no longer needed with generator)
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
// WU-1574: Import backlog generator to replace BacklogManager
import { generateBacklog } from '@lumenflow/core/backlog-generator';
import { todayISO } from '@lumenflow/core/date-utils';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import {
  WU_PATHS,
  defaultWorktreeFrom,
  getStateStoreDirFromBacklog,
} from '@lumenflow/core/wu-paths';
import { readWU, writeWU, appendNote } from '@lumenflow/core/wu-yaml';
import {
  BRANCHES,
  REMOTES,
  WU_STATUS,
  STATUS_SECTIONS,
  PATTERNS,
  LOG_PREFIX,
  FILE_SYSTEM,
  STRING_LITERALS,
  MICRO_WORKTREE_OPERATIONS,
} from '@lumenflow/core/wu-constants';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { resolveWuEventsRelativePath } from './state-path-resolvers.js';
import { ensureStaged } from '@lumenflow/core/git-staged-validator';
import { withMicroWorktree, LUMENFLOW_WU_TOOL_ENV } from '@lumenflow/core/micro-worktree';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
// WU-1603: Atomic lane locking - release lock when WU is blocked
import { releaseLaneLock } from '@lumenflow/core/lane-lock';
// WU-1325: Import lock policy getter to determine release behavior
import { getLockPolicyForLane } from '@lumenflow/core/lane-checker';
import { shouldUseBranchPrStatePath } from './wu-state-cloud.js';
import { runCLI } from './cli-entry-point.js';

/** Parsed CLI arguments for wu:block */
interface BlockCliArgs {
  id: string;
  reason?: string;
  worktree?: string;
  removeWorktree?: boolean;
  noAuto?: boolean;
}

// ensureOnMain() moved to wu-helpers.ts (WU-1256)
// ensureStaged() moved to git-staged-validator.ts (WU-1341)
// defaultWorktreeFrom() moved to wu-paths.ts (WU-1341)

/**
 * WU-1365: Execute a function with LUMENFLOW_WU_TOOL set, restoring afterwards
 *
 * Sets the LUMENFLOW_WU_TOOL env var to allow pre-push hook bypass, then
 * restores the original value (or deletes it) after execution completes.
 *
 * @param toolName - Value to set for LUMENFLOW_WU_TOOL
 * @param fn - Async function to execute
 */
async function withWuToolEnv<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  const previousWuTool = process.env[LUMENFLOW_WU_TOOL_ENV];
  process.env[LUMENFLOW_WU_TOOL_ENV] = toolName;
  try {
    return await fn();
  } finally {
    if (previousWuTool === undefined) {
      Reflect.deleteProperty(process.env, LUMENFLOW_WU_TOOL_ENV);
    } else {
      process.env[LUMENFLOW_WU_TOOL_ENV] = previousWuTool;
    }
  }
}

export function shouldUseBranchPrBlockPath(doc: { claimed_mode?: string }): boolean {
  return shouldUseBranchPrStatePath(doc);
}

/**
 * Remove WU entry from in-progress section of lines array
 */
function removeFromInProgressSection(lines: string[], inProgIdx: number, rel: string, id: string) {
  if (inProgIdx === -1) return;

  let endIdx = lines.slice(inProgIdx + 1).findIndex((l) => l.startsWith('## '));
  endIdx = endIdx === -1 ? lines.length : inProgIdx + 1 + endIdx;

  for (let i = inProgIdx + 1; i < endIdx; i++) {
    if (lines[i] && (lines[i].includes(rel) || lines[i].includes(`[${id}`))) {
      lines.splice(i, 1);
      endIdx--;
      i--; // adjust
    }
  }

  const section = lines.slice(inProgIdx + 1, endIdx).filter((l) => l.trim() !== '');
  if (section.length === 0) lines.splice(endIdx, 0, '', '(No items currently in progress)', '');
}

/**
 * WU-1365: Create missing blocked section in status.md
 *
 * Extracts this logic to reduce cognitive complexity of moveFromInProgressToBlocked.
 *
 * @param lines - Array of lines from status.md
 * @param inProgIdx - Index of "## In Progress" header (-1 if not found)
 * @returns Index of the blocked section header after creation
 */
function createMissingBlockedSection(lines: string[], inProgIdx: number): number {
  console.log(
    `${LOG_PREFIX.BLOCK} Creating missing "${STATUS_SECTIONS.BLOCKED}" section in status.md`,
  );
  // Find a good insertion point - after in_progress section or at end
  const insertIdx = inProgIdx !== -1 ? inProgIdx + 1 : lines.length;
  // Skip to end of in_progress section content if it exists
  let insertPoint = insertIdx;
  if (inProgIdx !== -1) {
    // Find where the next section starts
    const nextSectionIdx = lines.slice(inProgIdx + 1).findIndex((l) => l.startsWith('## '));
    insertPoint = nextSectionIdx === -1 ? lines.length : inProgIdx + 1 + nextSectionIdx;
  }
  // Insert the blocked section
  lines.splice(insertPoint, 0, '', STATUS_SECTIONS.BLOCKED, '');
  // Return the index of the newly created section header
  return insertPoint + 1;
}

async function moveFromInProgressToBlocked(
  statusPath: string,
  id: string,
  title: string,
  reason: string | undefined,
) {
  // Check file exists
  const fileExists = await access(statusPath)
    .then(() => true)
    .catch(() => false);
  if (!fileExists) die(`Missing ${statusPath}`);

  const rel = `wu/${id}.yaml`;

  const content = await readFile(statusPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split(/\r?\n/);
  const findHeader = (h: string) =>
    lines.findIndex((l) => l.trim().toLowerCase() === h.toLowerCase());
  const inProgIdx = findHeader(STATUS_SECTIONS.IN_PROGRESS);
  let blockedIdx = findHeader(STATUS_SECTIONS.BLOCKED);

  // WU-1365: Handle missing blocked section gracefully by creating it
  if (blockedIdx === -1) {
    createMissingBlockedSection(lines, inProgIdx);
  }

  removeFromInProgressSection(lines, inProgIdx, rel, id);

  // Add bullet to blocked
  const reasonSuffix = reason ? ` — ${reason}` : '';
  const bullet = `- [${id} — ${title}](${rel})${reasonSuffix}`;
  // Recalculate blockedIdx after removeFromInProgressSection may have changed line positions
  blockedIdx = findHeader(STATUS_SECTIONS.BLOCKED);
  const sectionStart = blockedIdx + 1;
  if (lines.slice(sectionStart).some((l) => l.includes(rel))) return; // already listed
  lines.splice(sectionStart, 0, '', bullet);

  await writeFile(statusPath, lines.join(STRING_LITERALS.NEWLINE), {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
}

// WU-1574: Regenerate backlog.md from state store (replaces BacklogManager manipulation)
async function regenerateBacklogFromState(backlogPath: string) {
  const stateDir = getStateStoreDirFromBacklog(backlogPath);

  const store = new WUStateStore(stateDir);
  await store.load();
  const content = await generateBacklog(store);
  await writeFile(backlogPath, content, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
}

/**
 * Handle worktree removal if requested
 */
async function handleWorktreeRemoval(args: BlockCliArgs, doc: Record<string, unknown>) {
  if (!args.removeWorktree) return;

  const wt = args.worktree || defaultWorktreeFrom(doc);
  // Check if worktree exists
  const wtExists =
    wt &&
    (await access(wt)
      .then(() => true)
      .catch(() => false));

  if (wtExists) {
    try {
      await getGitForCwd().worktreeRemove(wt);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`${LOG_PREFIX.BLOCK} Could not remove worktree ${wt}: ${message}`);
    }
  } else if (wt) {
    console.warn(`${LOG_PREFIX.BLOCK} Worktree path not found; skipping removal`);
  } else {
    console.warn(`${LOG_PREFIX.BLOCK} No worktree path specified; skipping removal`);
  }
}

export async function main() {
  const args = createWUParser({
    name: 'wu-block',
    description: 'Block a work unit and move it from in-progress to blocked status',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.reason,
      WU_OPTIONS.worktree,
      WU_OPTIONS.removeWorktree,
      WU_OPTIONS.noAuto,
    ],
    required: ['id'],
    allowPositionalId: true,
  }) as BlockCliArgs;

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  // Read WU doc from main to get title and validate state transition
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
  const branchPrPath = shouldUseBranchPrBlockPath(doc);

  if (!branchPrPath) {
    await ensureOnMain(getGitForCwd());
  }

  // Validate state transition before micro-worktree
  const currentStatus = (doc.status as string) || WU_STATUS.IN_PROGRESS;
  try {
    assertTransition(currentStatus, WU_STATUS.BLOCKED, id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    die(
      `State transition validation failed: ${message}\n\n` +
        `Options:\n` +
        `  1. Check WU current status: grep status ${mainWUPath}\n` +
        `  2. Only in_progress or waiting WUs can be blocked\n` +
        `  3. If WU is done, it cannot be blocked`,
    );
  }

  const baseMsg = `wu(${id.toLowerCase()}): block`;
  const commitMsg = args.reason ? `${baseMsg} — ${args.reason}` : baseMsg;

  if (!args.noAuto) {
    if (branchPrPath) {
      const currentBranch = await getGitForCwd().getCurrentBranch();
      const claimedBranch = typeof doc.claimed_branch === 'string' ? doc.claimed_branch : '';
      if (claimedBranch && currentBranch !== claimedBranch) {
        die(
          `Cannot block branch-pr WU ${id}: current branch does not match claimed_branch.\n\n` +
            `Current branch: ${currentBranch}\n` +
            `Claimed branch: ${claimedBranch}`,
        );
      }

      doc.status = WU_STATUS.BLOCKED;
      const noteLine = args.reason
        ? `Blocked (${todayISO()}): ${args.reason}`
        : `Blocked (${todayISO()})`;
      appendNote(doc, noteLine);
      writeWU(mainWUPath, doc);

      await moveFromInProgressToBlocked(WU_PATHS.STATUS(), id, title, args.reason);
      await regenerateBacklogFromState(WU_PATHS.BACKLOG());

      const stateDir = getStateStoreDirFromBacklog(WU_PATHS.BACKLOG());
      const store = new WUStateStore(stateDir);
      await store.load();
      await store.block(id, args.reason || 'No reason provided');

      await getGitForCwd().add([
        WU_PATHS.WU(id),
        WU_PATHS.STATUS(),
        WU_PATHS.BACKLOG(),
        resolveWuEventsRelativePath(process.cwd()),
      ]);
      await getGitForCwd().commit(commitMsg);
      await getGitForCwd().push(REMOTES.ORIGIN, currentBranch);
    } else {
      // WU-1365: Set LUMENFLOW_WU_TOOL to allow pre-push hook bypass for micro-worktree pushes
      await withWuToolEnv(MICRO_WORKTREE_OPERATIONS.WU_BLOCK, async () => {
        // Use micro-worktree pattern to avoid pre-commit hook blocking commits to main
        await withMicroWorktree({
          operation: MICRO_WORKTREE_OPERATIONS.WU_BLOCK,
          id,
          logPrefix: LOG_PREFIX.BLOCK,
          pushOnly: true, // Push directly to origin/main without touching local main
          execute: async ({ worktreePath }) => {
            // Build paths relative to micro-worktree
            const microWUPath = path.join(worktreePath, WU_PATHS.WU(id));
            const microStatusPath = path.join(worktreePath, WU_PATHS.STATUS());
            const microBacklogPath = path.join(worktreePath, WU_PATHS.BACKLOG());

            // Update WU YAML in micro-worktree
            const microDoc = readWU(microWUPath, id);
            microDoc.status = WU_STATUS.BLOCKED;
            const noteLine = args.reason
              ? `Blocked (${todayISO()}): ${args.reason}`
              : `Blocked (${todayISO()})`;
            appendNote(microDoc, noteLine);
            writeWU(microWUPath, microDoc);

            // Update status.md in micro-worktree
            await moveFromInProgressToBlocked(microStatusPath, id, title, args.reason);

            // Update backlog.md in micro-worktree (WU-1574: regenerate from state store)
            await regenerateBacklogFromState(microBacklogPath);

            // Append block event to WUStateStore (WU-1573)
            const stateDir = getStateStoreDirFromBacklog(microBacklogPath);
            const store = new WUStateStore(stateDir);
            await store.load();
            await store.block(id, args.reason || 'No reason provided');

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
      });
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

  await handleWorktreeRemoval(args, doc);

  // WU-1325: Release lane lock when WU is blocked (only for lock_policy=active)
  // For policy=all, lock is held through block/unblock cycle
  // For policy=none, no lock exists to release
  try {
    const lane = doc.lane as string | undefined;
    if (lane) {
      const lockPolicy = getLockPolicyForLane(lane);
      if (lockPolicy === 'active') {
        const releaseResult = releaseLaneLock(lane, { wuId: id });
        if (releaseResult.released && !releaseResult.notFound) {
          console.log(`${LOG_PREFIX.BLOCK} Lane lock released for "${lane}" (lock_policy=active)`);
        }
      } else if (lockPolicy === 'all') {
        console.log(`${LOG_PREFIX.BLOCK} Lane lock retained for "${lane}" (lock_policy=all)`);
      }
      // For policy=none, no lock exists - nothing to do
    }
  } catch (err: unknown) {
    // Non-blocking: lock release failure should not block the blocking operation
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX.BLOCK} Warning: Could not release lane lock: ${message}`);
  }

  console.log(`${STRING_LITERALS.NEWLINE}${LOG_PREFIX.BLOCK} Marked blocked and pushed.`);
  console.log(`- WU: ${id} — ${title}`);
  if (args.reason) console.log(`- Reason: ${args.reason}`);
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
