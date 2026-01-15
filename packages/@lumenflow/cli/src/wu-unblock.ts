#!/usr/bin/env node
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
import { assertTransition } from '@lumenflow/core/dist/state-machine.js';
import { checkLaneFree } from '@lumenflow/core/dist/lane-checker.js';
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { todayISO } from '@lumenflow/core/dist/date-utils.js';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS, defaultWorktreeFrom } from '@lumenflow/core/dist/wu-paths.js';
import { readWU, writeWU, appendNote } from '@lumenflow/core/dist/wu-yaml.js';
import {
  STATUS_SECTIONS,
  PATTERNS,
  LOG_PREFIX,
  WU_STATUS,
  REMOTES,
  BRANCHES,
  GIT_REFS,
  FILE_SYSTEM,
  EXIT_CODES,
  MICRO_WORKTREE_OPERATIONS,
} from '@lumenflow/core/dist/wu-constants.js';
import { defaultBranchFrom } from '@lumenflow/core/dist/wu-done-validators.js';
import { ensureOnMain } from '@lumenflow/core/dist/wu-helpers.js';
import { emitWUFlowEvent } from '@lumenflow/core/dist/telemetry.js';
import { ensureStaged } from '@lumenflow/core/dist/git-staged-validator.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
import { WUStateStore } from '@lumenflow/core/dist/wu-state-store.js';
// WU-1574: Import backlog generator to replace BacklogManager
import { generateBacklog, generateStatus } from '@lumenflow/core/dist/backlog-generator.js';

// ensureOnMain() moved to wu-helpers.mjs (WU-1256)
// ensureStaged() moved to git-staged-validator.mjs (WU-1341)
// defaultWorktreeFrom() moved to wu-paths.mjs (WU-1341)

const PREFIX = LOG_PREFIX.UNBLOCK;

// WU-1574: Removed legacy backlog manipulation functions
// All backlog/status updates now use WUStateStore + backlog generator

// defaultBranchFrom() consolidated to wu-done-validators.mjs (emergency fix)

function branchExists(branch) {
  try {
    getGitForCwd().run(`git rev-parse --verify ${JSON.stringify(branch)}`);
    return true;
  } catch {
    return false;
  }
}

function createWorktree(doc, worktreePath, branchName) {
  if (!worktreePath) die('Worktree path required to create a worktree');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool checks worktree
  if (existsSync(worktreePath)) {
    console.warn(`${PREFIX} Worktree ${worktreePath} already exists; skipping creation.`);
    return;
  }
  getGitForCwd().run(`git fetch ${REMOTES.ORIGIN} ${BRANCHES.MAIN}`);
  if (branchExists(branchName)) {
    getGitForCwd().run(
      `git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(branchName)}`
    );
  } else {
    getGitForCwd().run(
      `git worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(branchName)} ${GIT_REFS.ORIGIN_MAIN}`
    );
  }
}

// emitTelemetry() moved to telemetry.mjs as emitWUFlowEvent() (WU-1256)

/**
 * Handle lane occupancy check and enforce WIP=1 policy
 */
function handleLaneOccupancy(laneCheck, lane, id, force) {
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
      `To check lane status: grep "${STATUS_SECTIONS.IN_PROGRESS}" docs/04-operations/tasks/status.md`
  );
}

/**
 * Handle optional worktree creation after unblock
 */
function handleWorktreeCreation(args, doc) {
  if (!args.createWorktree) return;

  const worktreePath = args.worktree || defaultWorktreeFrom(doc);
  const branchName = args.branch || defaultBranchFrom(doc);
  if (!branchName) {
    console.warn(`${PREFIX} Cannot derive branch name; skipping worktree creation.`);
    return;
  }
  createWorktree(doc, worktreePath, branchName);
}

async function main() {
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
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  await ensureOnMain(getGitForCwd());

  // Read WU doc from main to get title, lane, and validate state transition
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
  const lane = doc.lane || 'Unknown';

  // Validate state transition before micro-worktree
  const currentStatus = doc.status || WU_STATUS.BLOCKED;
  try {
    assertTransition(currentStatus, WU_STATUS.IN_PROGRESS, id);
  } catch (error) {
    die(
      `State transition validation failed: ${error.message}\n\n` +
        `Options:\n` +
        `  1. Check WU current status: grep status ${mainWUPath}\n` +
        `  2. Only blocked or waiting WUs can be unblocked\n` +
        `  3. If WU is done or ready, use wu:claim instead`
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
        const stateDir = path.join(worktreePath, '.beacon', 'state');
        const store = new WUStateStore(stateDir);
        await store.load();
        await store.unblock(id);

        // Generate backlog.md and status.md from state store
        const backlogContent = await generateBacklog(store);
        writeFileSync(microBacklogPath, backlogContent, FILE_SYSTEM.UTF8);

        const statusContent = await generateStatus(store);
        writeFileSync(microStatusPath, statusContent, FILE_SYSTEM.UTF8);

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
    getGitForCwd().run(`git commit -m ${JSON.stringify(commitMsg)}`);
    getGitForCwd().run(`git push ${REMOTES.ORIGIN} ${BRANCHES.MAIN}`);
  }

  handleWorktreeCreation(args, doc);

  console.log(`\n${PREFIX} Marked in progress and pushed.`);
  console.log(`- WU: ${id} — ${title}`);
  if (args.reason) console.log(`- Reason: ${args.reason}`);
  if (args.createWorktree) console.log(`- Worktree: ${args.worktree || defaultWorktreeFrom(doc)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(EXIT_CODES.ERROR);
});
