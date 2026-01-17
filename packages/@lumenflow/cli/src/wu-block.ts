#!/usr/bin/env node
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
import { assertTransition } from '@lumenflow/core/dist/state-machine.js';
// WU-1574: Removed parseBacklogFrontmatter, getSectionHeadings (no longer needed with generator)
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
// WU-1574: Import backlog generator to replace BacklogManager
import { generateBacklog } from '@lumenflow/core/dist/backlog-generator.js';
import { todayISO } from '@lumenflow/core/dist/date-utils.js';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS, defaultWorktreeFrom, getStateStoreDirFromBacklog } from '@lumenflow/core/dist/wu-paths.js';
import { readWU, writeWU, appendNote } from '@lumenflow/core/dist/wu-yaml.js';
import {
  BRANCHES,
  REMOTES,
  WU_STATUS,
  STATUS_SECTIONS,
  PATTERNS,
  LOG_PREFIX,
  FILE_SYSTEM,
  EXIT_CODES,
  STRING_LITERALS,
  MICRO_WORKTREE_OPERATIONS,
} from '@lumenflow/core/dist/wu-constants.js';
import { ensureOnMain } from '@lumenflow/core/dist/wu-helpers.js';
import { ensureStaged } from '@lumenflow/core/dist/git-staged-validator.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
import { WUStateStore } from '@lumenflow/core/dist/wu-state-store.js';
// WU-1603: Atomic lane locking - release lock when WU is blocked
import { releaseLaneLock } from '@lumenflow/core/dist/lane-lock.js';

// ensureOnMain() moved to wu-helpers.mjs (WU-1256)
// ensureStaged() moved to git-staged-validator.mjs (WU-1341)
// defaultWorktreeFrom() moved to wu-paths.mjs (WU-1341)

/**
 * Remove WU entry from in-progress section of lines array
 */
function removeFromInProgressSection(lines, inProgIdx, rel, id) {
  if (inProgIdx === -1) return;

  let endIdx = lines.slice(inProgIdx + 1).findIndex((l) => l.startsWith('## '));
  endIdx = endIdx === -1 ? lines.length : inProgIdx + 1 + endIdx;

  for (let i = inProgIdx + 1; i < endIdx; i++) {
    // eslint-disable-next-line security/detect-object-injection -- array index loop
    if (lines[i] && (lines[i].includes(rel) || lines[i].includes(`[${id}`))) {
      lines.splice(i, 1);
      endIdx--;
      i--; // adjust
    }
  }

  const section = lines.slice(inProgIdx + 1, endIdx).filter((l) => l.trim() !== '');
  if (section.length === 0) lines.splice(endIdx, 0, '', '(No items currently in progress)', '');
}

async function moveFromInProgressToBlocked(statusPath, id, title, reason) {
  // Check file exists
  const fileExists = await access(statusPath)
    .then(() => true)
    .catch(() => false);
  if (!fileExists) die(`Missing ${statusPath}`);

  const rel = `wu/${id}.yaml`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates status file
  const content = await readFile(statusPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split(/\r?\n/);
  const findHeader = (h) => lines.findIndex((l) => l.trim().toLowerCase() === h.toLowerCase());
  const inProgIdx = findHeader(STATUS_SECTIONS.IN_PROGRESS);
  const blockedIdx = findHeader(STATUS_SECTIONS.BLOCKED);
  if (blockedIdx === -1) die(`Could not find "${STATUS_SECTIONS.BLOCKED}" in status.md`);

  removeFromInProgressSection(lines, inProgIdx, rel, id);

  // Add bullet to blocked
  const reasonSuffix = reason ? ` — ${reason}` : '';
  const bullet = `- [${id} — ${title}](${rel})${reasonSuffix}`;
  const sectionStart = blockedIdx + 1;
  if (lines.slice(sectionStart).some((l) => l.includes(rel))) return; // already listed
  lines.splice(sectionStart, 0, '', bullet);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes status file
  await writeFile(statusPath, lines.join(STRING_LITERALS.NEWLINE), { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
}

// WU-1574: Regenerate backlog.md from state store (replaces BacklogManager manipulation)
async function regenerateBacklogFromState(backlogPath) {
  const stateDir = getStateStoreDirFromBacklog(backlogPath);

  const store = new WUStateStore(stateDir);
  await store.load();
  const content = await generateBacklog(store);
  await writeFile(backlogPath, content, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
}

/**
 * Handle worktree removal if requested
 */
async function handleWorktreeRemoval(args, doc) {
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
    } catch (e) {
      console.warn(`${LOG_PREFIX.BLOCK} Could not remove worktree ${wt}: ${e.message}`);
    }
  } else if (wt) {
    console.warn(`${LOG_PREFIX.BLOCK} Worktree path not found; skipping removal`);
  } else {
    console.warn(`${LOG_PREFIX.BLOCK} No worktree path specified; skipping removal`);
  }
}

async function main() {
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
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  await ensureOnMain(getGitForCwd());

  // Read WU doc from main to get title and validate state transition
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
        `  3. Create WU if missing: pnpm wu:create --id ${id} --lane "<lane>" --title "..."`
    );
  }
  const title = doc.title || '';

  // Validate state transition before micro-worktree
  const currentStatus = doc.status || WU_STATUS.IN_PROGRESS;
  try {
    assertTransition(currentStatus, WU_STATUS.BLOCKED, id);
  } catch (error) {
    die(
      `State transition validation failed: ${error.message}\n\n` +
        `Options:\n` +
        `  1. Check WU current status: grep status ${mainWUPath}\n` +
        `  2. Only in_progress or waiting WUs can be blocked\n` +
        `  3. If WU is done, it cannot be blocked`
    );
  }

  const baseMsg = `wu(${id.toLowerCase()}): block`;
  const commitMsg = args.reason ? `${baseMsg} — ${args.reason}` : baseMsg;

  if (!args.noAuto) {
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
        const stateDir = path.join(worktreePath, '.beacon', 'state');
        const store = new WUStateStore(stateDir);
        await store.load();
        await store.block(id, args.reason || 'No reason provided');

        return {
          commitMessage: commitMsg,
          files: [
            WU_PATHS.WU(id),
            WU_PATHS.STATUS(),
            WU_PATHS.BACKLOG(),
            '.beacon/state/wu-events.jsonl',
          ],
        };
      },
    });

    // Fetch to update local main tracking
    await getGitForCwd().fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
  } else {
    // Manual mode: expect files already staged
    ensureStaged([mainWUPath, WU_PATHS.STATUS(), WU_PATHS.BACKLOG()]);
    await getGitForCwd().commit(commitMsg);
    await getGitForCwd().push(REMOTES.ORIGIN, BRANCHES.MAIN);
  }

  await handleWorktreeRemoval(args, doc);

  // WU-1603: Release lane lock when WU is blocked
  // This allows another WU to be claimed in the same lane
  try {
    const lane = doc.lane;
    if (lane) {
      const releaseResult = releaseLaneLock(lane, { wuId: id });
      if (releaseResult.released && !releaseResult.notFound) {
        console.log(`${LOG_PREFIX.BLOCK} Lane lock released for "${lane}"`);
      }
    }
  } catch (err) {
    // Non-blocking: lock release failure should not block the blocking operation
    console.warn(`${LOG_PREFIX.BLOCK} Warning: Could not release lane lock: ${err.message}`);
  }

  console.log(`${STRING_LITERALS.NEWLINE}${LOG_PREFIX.BLOCK} Marked blocked and pushed.`);
  console.log(`- WU: ${id} — ${title}`);
  if (args.reason) console.log(`- Reason: ${args.reason}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(EXIT_CODES.ERROR);
});
