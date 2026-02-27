#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Delete Helper
 *
 * Race-safe WU deletion using micro-worktree isolation.
 *
 * Uses micro-worktree pattern:
 * 1) Validate inputs (WU exists, status is not in_progress)
 * 2) Ensure main is clean and up-to-date with origin
 * 3) Create temp branch WITHOUT switching (main checkout stays on main)
 * 4) Create micro-worktree in /tmp pointing to temp branch
 * 5) Delete WU artifacts and clean references in micro-worktree
 * 6) Commit, ff-only merge, push
 * 7) Cleanup temp branch and micro-worktree
 *
 * Usage:
 *   pnpm wu:delete --id WU-123            # Single WU deletion
 *   pnpm wu:delete --id WU-123 --dry-run  # Dry run
 *   pnpm wu:delete --batch WU-1,WU-2,WU-3 # Batch deletion
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { getConfig } from '@lumenflow/core/config';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { generateBacklog, generateStatus } from '@lumenflow/core/backlog-generator';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import {
  FILE_SYSTEM,
  EXIT_CODES,
  ENV_VARS,
  MICRO_WORKTREE_OPERATIONS,
  LOG_PREFIX,
  WU_STATUS,
  LUMENFLOW_PATHS,
} from '@lumenflow/core/wu-constants';
import { ensureOnMain, validateWUIDFormat } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import { INIT_PATTERNS } from '@lumenflow/initiatives/constants';
import { readInitiative, writeInitiative } from '@lumenflow/initiatives/yaml';
import { shouldUseBranchPrDeletePath } from './wu-state-cloud.js';
import { runCLI } from './cli-entry-point.js';

const PREFIX = LOG_PREFIX.DELETE || '[wu:delete]';

const DELETE_OPTIONS = {
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Show what would be deleted without making changes',
  },
  batch: {
    name: 'batch',
    flags: '--batch <ids>',
    description: 'Delete multiple WUs atomically (comma-separated: WU-1,WU-2,WU-3)',
  },
};

export interface CleanupDeletedWUsArgs {
  worktreePath: string;
  ids: string[];
}

function parseArgs() {
  return createWUParser({
    name: 'wu-delete',
    description: 'Safely delete WU YAML files with micro-worktree isolation',
    options: [WU_OPTIONS.id, DELETE_OPTIONS.dryRun, DELETE_OPTIONS.batch],
    required: [],
    allowPositionalId: true,
  });
}

function parseBatchIds(batchArg: string): string[] {
  return batchArg
    .split(',')
    .map((id) => id.trim().toUpperCase())
    .filter((id) => id.length > 0);
}

function validateWUDeletable(id: string) {
  const wuPath = WU_PATHS.WU(id);
  if (!existsSync(wuPath)) {
    die(`WU ${id} not found at ${wuPath}\n\nEnsure the WU exists and you're in the repo root.`);
  }

  const content = readFileSync(wuPath, FILE_SYSTEM.ENCODING as BufferEncoding);
  const wu = parseYAML(content);

  if (wu.status === WU_STATUS.IN_PROGRESS) {
    die(
      `Cannot delete WU ${id}: status is '${WU_STATUS.IN_PROGRESS}'.\n\n` +
        `WUs that are actively being worked on cannot be deleted.\n` +
        `If the WU was abandoned, first run: pnpm wu:block --id ${id} --reason "Abandoned"\n` +
        `Then retry the delete operation.`,
    );
  }

  return { wu, wuPath };
}

async function ensureCleanWorkingTree() {
  const status = await getGitForCwd().getStatus();
  if (status.trim()) {
    die(
      `Working tree is not clean. Cannot delete WU.\n\nUncommitted changes:\n${status}\n\nCommit or stash changes before deleting:\n  git add . && git commit -m "..."\n`,
    );
  }
}

function getStampPath(id: string): string {
  return join(WU_PATHS.STAMPS_DIR(), `${id}.done`);
}

function stampExists(id: string): boolean {
  return existsSync(getStampPath(id));
}

function removeEventsForDeletedWUs(eventsPath: string, ids: Set<string>): boolean {
  if (!existsSync(eventsPath)) {
    return false;
  }

  const content = readFileSync(eventsPath, FILE_SYSTEM.ENCODING as BufferEncoding);
  const lines = content.split('\n');

  let changed = false;
  const retained: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as { wuId?: string };
      if (event.wuId && ids.has(event.wuId.toUpperCase())) {
        changed = true;
        continue;
      }
      retained.push(line);
    } catch {
      // Preserve malformed lines to avoid destructive cleanup of unrelated data
      retained.push(line);
    }
  }

  if (!changed) {
    return false;
  }

  const next = retained.length > 0 ? `${retained.join('\n')}\n` : '';
  writeFileSync(eventsPath, next, FILE_SYSTEM.ENCODING as BufferEncoding);
  return true;
}

function getExistingWuIds(worktreePath: string): Set<string> {
  const wuIds = new Set<string>();
  const wuDir = join(worktreePath, WU_PATHS.WU_DIR());

  if (!existsSync(wuDir)) {
    return wuIds;
  }

  for (const file of readdirSync(wuDir)) {
    if (!file.endsWith('.yaml')) {
      continue;
    }
    const id = file.slice(0, -'.yaml'.length).toUpperCase();
    if (id.startsWith('WU-')) {
      wuIds.add(id);
    }
  }

  return wuIds;
}

function removeOrphanedEvents(eventsPath: string, existingWuIds: Set<string>): number {
  if (!existsSync(eventsPath)) {
    return 0;
  }

  const content = readFileSync(eventsPath, FILE_SYSTEM.ENCODING as BufferEncoding);
  const lines = content.split('\n');

  let removed = 0;
  const retained: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as { wuId?: string };
      if (event.wuId && !existingWuIds.has(event.wuId.toUpperCase())) {
        removed++;
        continue;
      }
      retained.push(line);
    } catch {
      // Preserve malformed lines to avoid destructive cleanup of unrelated data
      retained.push(line);
    }
  }

  if (removed === 0) {
    return 0;
  }

  const next = retained.length > 0 ? `${retained.join('\n')}\n` : '';
  writeFileSync(eventsPath, next, FILE_SYSTEM.ENCODING as BufferEncoding);
  return removed;
}

function removeDeletedWUsFromInitiatives(worktreePath: string, ids: Set<string>): string[] {
  const modified: string[] = [];
  const initiativesDir = join(worktreePath, INIT_PATHS.INITIATIVES_DIR());

  if (!existsSync(initiativesDir)) {
    return modified;
  }

  const initiativeFiles = readdirSync(initiativesDir).filter((file) => file.endsWith('.yaml'));

  for (const fileName of initiativeFiles) {
    const initId = fileName.replace(/\.yaml$/, '');
    if (!INIT_PATTERNS.INIT_ID.test(initId)) {
      continue;
    }

    const initiativePath = join(initiativesDir, fileName);

    try {
      const initDoc = readInitiative(initiativePath, initId) as { id?: string; wus?: string[] };
      if (!Array.isArray(initDoc.wus)) {
        continue;
      }

      const before = initDoc.wus.length;
      initDoc.wus = initDoc.wus.filter((wuId) => !ids.has(String(wuId).toUpperCase()));
      if (initDoc.wus.length === before) {
        continue;
      }

      writeInitiative(initiativePath, { ...initDoc, id: initDoc.id || initId });
      modified.push(INIT_PATHS.INITIATIVE(initId));
    } catch (err) {
      // Non-blocking: malformed initiative files should not block WU delete operation
      console.warn(
        `${PREFIX} ⚠️  Could not update initiative ${initId}: ${(err as Error).message}`,
      );
    }
  }

  return modified;
}

export async function cleanupDeletedWUsInWorktree({ worktreePath, ids }: CleanupDeletedWUsArgs) {
  const normalizedIds = new Set(ids.map((id) => id.toUpperCase()));
  // WU-1528: Track existing (modified/created) files separately from deleted files.
  // Only existing files are safe for `git add -A -- <path>` staging; deleted file
  // paths cause 'fatal: pathspec ... did not match UnsafeAny files' when passed individually.
  const existing = new Set<string>();

  for (const id of normalizedIds) {
    const wuRelPath = WU_PATHS.WU(id);
    const wuAbsPath = join(worktreePath, wuRelPath);
    if (existsSync(wuAbsPath)) {
      unlinkSync(wuAbsPath);
      console.log(`${PREFIX} ✅ Deleted ${id}.yaml`);
    }

    const stampRelPath = getStampPath(id);
    const stampAbsPath = join(worktreePath, stampRelPath);
    if (existsSync(stampAbsPath)) {
      unlinkSync(stampAbsPath);
      console.log(`${PREFIX} ✅ Deleted stamp ${id}.done`);
    }
  }

  const eventsRelPath = LUMENFLOW_PATHS.WU_EVENTS;
  const eventsAbsPath = join(worktreePath, eventsRelPath);
  if (removeEventsForDeletedWUs(eventsAbsPath, normalizedIds)) {
    existing.add(eventsRelPath);
    console.log(
      `${PREFIX} ✅ Removed ${normalizedIds.size} WU event stream(s) from wu-events.jsonl`,
    );
  }

  const existingWuIds = getExistingWuIds(worktreePath);
  const orphanedRemoved = removeOrphanedEvents(eventsAbsPath, existingWuIds);
  if (orphanedRemoved > 0) {
    existing.add(eventsRelPath);
    console.log(`${PREFIX} ✅ Removed ${orphanedRemoved} orphaned event(s) for missing WU specs`);
  }

  const initiativeFiles = removeDeletedWUsFromInitiatives(worktreePath, normalizedIds);
  for (const file of initiativeFiles) {
    existing.add(file);
  }
  if (initiativeFiles.length > 0) {
    console.log(
      `${PREFIX} ✅ Removed deleted WU references from ${initiativeFiles.length} initiative file(s)`,
    );
  }

  const stateDir = join(worktreePath, getConfig({ projectRoot: worktreePath }).state.stateDir);
  const store = new WUStateStore(stateDir);
  await store.load();

  const backlogRelPath = WU_PATHS.BACKLOG();
  const statusRelPath = WU_PATHS.STATUS();
  const backlogAbsPath = join(worktreePath, backlogRelPath);
  const statusAbsPath = join(worktreePath, statusRelPath);

  const backlogContent = await generateBacklog(store, { projectRoot: worktreePath });
  writeFileSync(backlogAbsPath, backlogContent, FILE_SYSTEM.ENCODING as BufferEncoding);
  existing.add(backlogRelPath);

  const statusContent = await generateStatus(store);
  writeFileSync(statusAbsPath, statusContent, FILE_SYSTEM.ENCODING as BufferEncoding);
  existing.add(statusRelPath);

  console.log(`${PREFIX} ✅ Regenerated backlog.md and status.md from state store`);

  return Array.from(existing);
}

async function deleteSingleWU(id: string, dryRun: boolean) {
  console.log(`${PREFIX} Starting WU delete for ${id}`);

  validateWUIDFormat(id);
  const { wu, wuPath } = validateWUDeletable(id);
  const branchPrPath = shouldUseBranchPrDeletePath([wu as { claimed_mode?: string }]);

  console.log(`${PREFIX} WU details:`);
  console.log(`${PREFIX}   Title: ${wu.title}`);
  console.log(`${PREFIX}   Lane: ${wu.lane}`);
  console.log(`${PREFIX}   Status: ${wu.status}`);
  console.log(`${PREFIX}   Path: ${wuPath}`);

  if (dryRun) {
    console.log(`\n${PREFIX} 🔍 DRY RUN: Would delete ${id}`);
    console.log(`${PREFIX}   - Delete file: ${wuPath}`);
    console.log(`${PREFIX}   - Delete events from: ${LUMENFLOW_PATHS.WU_EVENTS}`);
    console.log(`${PREFIX}   - Regenerate: ${WU_PATHS.BACKLOG()}`);
    console.log(`${PREFIX}   - Regenerate: ${WU_PATHS.STATUS()}`);
    console.log(`${PREFIX}   - Remove initiative links from: ${INIT_PATHS.INITIATIVES_DIR()}`);
    if (stampExists(id)) {
      console.log(`${PREFIX}   - Delete stamp: ${getStampPath(id)}`);
    }
    console.log(`${PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  await ensureCleanWorkingTree();
  if (!branchPrPath) {
    await ensureOnMain(getGitForCwd());
    // WU-2194: Removed ensureMainUpToDate — withMicroWorktree already handles origin sync
  }

  if (branchPrPath) {
    const currentBranch = await getGitForCwd().getCurrentBranch();
    if (
      typeof wu.claimed_branch === 'string' &&
      wu.claimed_branch &&
      wu.claimed_branch !== currentBranch
    ) {
      die(
        `Cannot delete branch-pr WU ${id}: current branch does not match claimed_branch.\n\n` +
          `Current branch: ${currentBranch}\n` +
          `Claimed branch: ${wu.claimed_branch}`,
      );
    }

    await cleanupDeletedWUsInWorktree({ worktreePath: process.cwd(), ids: [id] });
    await getGitForCwd().addWithDeletions([]);
    await getGitForCwd().commit(`docs: delete ${id.toLowerCase()}`);
    await getGitForCwd().push('origin', currentBranch);
  } else {
    console.log(`${PREFIX} Deleting via micro-worktree...`);

    // WU-1245: Set LUMENFLOW_WU_TOOL for pre-push hook allowlist
    const previousWuTool = process.env[ENV_VARS.WU_TOOL];
    process.env[ENV_VARS.WU_TOOL] = MICRO_WORKTREE_OPERATIONS.WU_DELETE;
    try {
      await withMicroWorktree({
        operation: MICRO_WORKTREE_OPERATIONS.WU_DELETE,
        id: id,
        logPrefix: PREFIX,
        execute: async ({ worktreePath }) => {
          await cleanupDeletedWUsInWorktree({ worktreePath, ids: [id] });

          // WU-1528: Return empty files array so withMicroWorktree uses
          // `git add -A .` to stage all changes atomically (deletions + modifications).
          // Passing specific paths would fail for deleted files with
          // 'fatal: pathspec ... did not match UnsafeAny files'.
          const commitMessage = `docs: delete ${id.toLowerCase()}`;
          return {
            commitMessage,
            files: [],
          };
        },
      });
    } finally {
      // Restore previous LUMENFLOW_WU_TOOL value
      if (previousWuTool === undefined) {
        delete process.env[ENV_VARS.WU_TOOL];
      } else {
        process.env[ENV_VARS.WU_TOOL] = previousWuTool;
      }
    }
  }

  console.log(`${PREFIX} ✅ Successfully deleted ${id}`);
  console.log(`${PREFIX} Changes pushed to origin/main`);
}

async function deleteBatchWUs(ids: string[], dryRun: boolean) {
  console.log(`${PREFIX} Starting batch delete for ${ids.length} WU(s): ${ids.join(', ')}`);

  const wusToDelete: Array<{ id: string; wu: Record<string, unknown>; wuPath: string }> = [];
  const stampsToDelete: string[] = [];

  for (const id of ids) {
    validateWUIDFormat(id);
    const { wu, wuPath } = validateWUDeletable(id);
    wusToDelete.push({ id, wu, wuPath });

    if (stampExists(id)) {
      stampsToDelete.push(id);
    }
  }
  const branchPrPath = shouldUseBranchPrDeletePath(
    wusToDelete.map((entry) => entry.wu as { claimed_mode?: string }),
  );

  console.log(`${PREFIX} WUs to delete:`);
  for (const { id, wu, wuPath } of wusToDelete) {
    console.log(`${PREFIX}   ${id}: ${wu.title} (${wu.status}) - ${wuPath}`);
  }

  if (dryRun) {
    console.log(`\n${PREFIX} 🔍 DRY RUN: Would delete ${ids.length} WU(s)`);
    console.log(`${PREFIX}   - Delete events from: ${LUMENFLOW_PATHS.WU_EVENTS}`);
    console.log(`${PREFIX}   - Regenerate: ${WU_PATHS.BACKLOG()}`);
    console.log(`${PREFIX}   - Regenerate: ${WU_PATHS.STATUS()}`);
    console.log(`${PREFIX}   - Remove initiative links from: ${INIT_PATHS.INITIATIVES_DIR()}`);
    if (stampsToDelete.length > 0) {
      console.log(`${PREFIX}   - Delete ${stampsToDelete.length} stamp(s)`);
    }
    console.log(`${PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  await ensureCleanWorkingTree();
  if (!branchPrPath) {
    await ensureOnMain(getGitForCwd());
    // WU-2194: Removed ensureMainUpToDate — withMicroWorktree already handles origin sync
  }

  if (branchPrPath) {
    const currentBranch = await getGitForCwd().getCurrentBranch();
    const mismatched = wusToDelete.find(
      (entry) =>
        typeof entry.wu.claimed_branch === 'string' &&
        entry.wu.claimed_branch &&
        entry.wu.claimed_branch !== currentBranch,
    );
    if (mismatched) {
      die(
        `Cannot batch-delete branch-pr WUs: current branch does not match claimed_branch.\n\n` +
          `Current branch: ${currentBranch}\n` +
          `WU ${mismatched.id} claimed_branch: ${String(mismatched.wu.claimed_branch)}`,
      );
    }

    await cleanupDeletedWUsInWorktree({ worktreePath: process.cwd(), ids });
    await getGitForCwd().addWithDeletions([]);
    const idList = ids.map((candidateId) => candidateId.toLowerCase()).join(', ');
    await getGitForCwd().commit(`chore(repair): delete ${ids.length} orphaned wus (${idList})`);
    await getGitForCwd().push('origin', currentBranch);
  } else {
    console.log(`${PREFIX} Deleting ${ids.length} WU(s) via micro-worktree...`);

    // WU-1245: Set LUMENFLOW_WU_TOOL for pre-push hook allowlist
    const previousWuTool = process.env[ENV_VARS.WU_TOOL];
    process.env[ENV_VARS.WU_TOOL] = MICRO_WORKTREE_OPERATIONS.WU_DELETE;
    try {
      await withMicroWorktree({
        operation: MICRO_WORKTREE_OPERATIONS.WU_DELETE,
        id: `batch-${ids.length}`,
        logPrefix: PREFIX,
        execute: async ({ worktreePath }) => {
          await cleanupDeletedWUsInWorktree({ worktreePath, ids });

          // WU-1528: Return empty files array so withMicroWorktree uses
          // `git add -A .` to stage all changes atomically (deletions + modifications).
          const idList = ids.map((candidateId) => candidateId.toLowerCase()).join(', ');
          const commitMessage = `chore(repair): delete ${ids.length} orphaned wus (${idList})`;
          return {
            commitMessage,
            files: [],
          };
        },
      });
    } finally {
      // Restore previous LUMENFLOW_WU_TOOL value
      if (previousWuTool === undefined) {
        delete process.env[ENV_VARS.WU_TOOL];
      } else {
        process.env[ENV_VARS.WU_TOOL] = previousWuTool;
      }
    }
  }

  console.log(`${PREFIX} ✅ Successfully deleted ${ids.length} WU(s)`);
  console.log(`${PREFIX} Changes pushed to origin/main`);
}

export async function main() {
  const opts = parseArgs();
  const { id, dryRun, batch } = opts;

  if (!id && !batch) {
    die('Must specify either --id WU-XXX or --batch WU-1,WU-2,WU-3');
  }

  if (id && batch) {
    die('Cannot use both --id and --batch. Use one or the other.');
  }

  if (batch) {
    const ids = parseBatchIds(batch);
    if (ids.length === 0) {
      die('--batch requires at least one WU ID');
    }
    await deleteBatchWUs(ids, dryRun);
  } else {
    await deleteSingleWU(id, dryRun);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
