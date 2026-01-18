#!/usr/bin/env node
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
 * 5) Delete WU file and update backlog.md in micro-worktree
 * 6) Commit, ff-only merge, push
 * 7) Cleanup temp branch and micro-worktree
 *
 * Usage:
 *   pnpm wu:delete --id WU-123           # Single WU deletion
 *   pnpm wu:delete --id WU-123 --dry-run # Dry run
 *   pnpm wu:delete --batch WU-1,WU-2,WU-3 # Batch deletion
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { parseYAML, stringifyYAML } from '@lumenflow/core/dist/wu-yaml.js';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import {
  FILE_SYSTEM,
  EXIT_CODES,
  MICRO_WORKTREE_OPERATIONS,
  LOG_PREFIX,
  WU_STATUS,
} from '@lumenflow/core/dist/wu-constants.js';
import {
  ensureOnMain,
  ensureMainUpToDate,
  validateWUIDFormat,
} from '@lumenflow/core/dist/wu-helpers.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';

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

function removeFromBacklog(backlogPath: string, id: string): boolean {
  if (!existsSync(backlogPath)) {
    return false;
  }

  const content = readFileSync(backlogPath, FILE_SYSTEM.ENCODING as BufferEncoding);
  const wuLinkPattern = new RegExp(`^.*\\[${id}[^\\]]*\\].*$`, 'gmi');
  const wuSimplePattern = new RegExp(`^.*${id}.*\\.yaml.*$`, 'gmi');

  let updated = content.replace(wuLinkPattern, '');
  updated = updated.replace(wuSimplePattern, '');
  updated = updated.replace(/\n{3,}/g, '\n\n');

  if (updated !== content) {
    writeFileSync(backlogPath, updated, FILE_SYSTEM.ENCODING as BufferEncoding);
    return true;
  }

  return false;
}

async function deleteSingleWU(id: string, dryRun: boolean) {
  console.log(`${PREFIX} Starting WU delete for ${id}`);

  validateWUIDFormat(id);
  const { wu, wuPath } = validateWUDeletable(id);

  console.log(`${PREFIX} WU details:`);
  console.log(`${PREFIX}   Title: ${wu.title}`);
  console.log(`${PREFIX}   Lane: ${wu.lane}`);
  console.log(`${PREFIX}   Status: ${wu.status}`);
  console.log(`${PREFIX}   Path: ${wuPath}`);

  if (dryRun) {
    console.log(`\n${PREFIX} 🔍 DRY RUN: Would delete ${id}`);
    console.log(`${PREFIX}   - Delete file: ${wuPath}`);
    console.log(`${PREFIX}   - Update: ${WU_PATHS.BACKLOG()}`);
    if (stampExists(id)) {
      console.log(`${PREFIX}   - Delete stamp: ${getStampPath(id)}`);
    }
    console.log(`${PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  await ensureOnMain(getGitForCwd());
  await ensureCleanWorkingTree();
  await ensureMainUpToDate(getGitForCwd(), 'wu:delete');

  console.log(`${PREFIX} Deleting via micro-worktree...`);

  await withMicroWorktree({
    operation: MICRO_WORKTREE_OPERATIONS.WU_DELETE,
    id: id,
    logPrefix: PREFIX,
    execute: async ({ worktreePath, gitWorktree }) => {
      const wuFilePath = join(worktreePath, wuPath);
      const backlogFilePath = join(worktreePath, WU_PATHS.BACKLOG());

      unlinkSync(wuFilePath);
      console.log(`${PREFIX} ✅ Deleted ${id}.yaml`);

      const stampPath = join(worktreePath, getStampPath(id));
      if (existsSync(stampPath)) {
        unlinkSync(stampPath);
        console.log(`${PREFIX} ✅ Deleted stamp ${id}.done`);
      }

      const removedFromBacklog = removeFromBacklog(backlogFilePath, id);
      if (removedFromBacklog) {
        console.log(`${PREFIX} ✅ Removed ${id} from backlog.md`);
      } else {
        console.log(`${PREFIX} ℹ️  ${id} was not found in backlog.md`);
      }

      await gitWorktree.add('.');

      const commitMessage = `docs: delete ${id.toLowerCase()}`;
      return {
        commitMessage,
        files: [],
      };
    },
  });

  console.log(`${PREFIX} ✅ Successfully deleted ${id}`);
  console.log(`${PREFIX} Changes pushed to origin/main`);
}

async function deleteBatchWUs(ids: string[], dryRun: boolean) {
  console.log(`${PREFIX} Starting batch delete for ${ids.length} WU(s): ${ids.join(', ')}`);

  const wusToDelete: Array<{ id: string; wu: any; wuPath: string }> = [];
  const stampsToDelete: string[] = [];

  for (const id of ids) {
    validateWUIDFormat(id);
    const { wu, wuPath } = validateWUDeletable(id);
    wusToDelete.push({ id, wu, wuPath });

    if (stampExists(id)) {
      stampsToDelete.push(id);
    }
  }

  console.log(`${PREFIX} WUs to delete:`);
  for (const { id, wu, wuPath } of wusToDelete) {
    console.log(`${PREFIX}   ${id}: ${wu.title} (${wu.status}) - ${wuPath}`);
  }

  if (dryRun) {
    console.log(`\n${PREFIX} 🔍 DRY RUN: Would delete ${ids.length} WU(s)`);
    console.log(`${PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  await ensureOnMain(getGitForCwd());
  await ensureCleanWorkingTree();
  await ensureMainUpToDate(getGitForCwd(), 'wu:delete --batch');

  console.log(`${PREFIX} Deleting ${ids.length} WU(s) via micro-worktree...`);

  await withMicroWorktree({
    operation: MICRO_WORKTREE_OPERATIONS.WU_DELETE,
    id: `batch-${ids.length}`,
    logPrefix: PREFIX,
    execute: async ({ worktreePath, gitWorktree }) => {
      const backlogFilePath = join(worktreePath, WU_PATHS.BACKLOG());

      for (const { id, wuPath } of wusToDelete) {
        const wuFilePath = join(worktreePath, wuPath);
        unlinkSync(wuFilePath);
        console.log(`${PREFIX} ✅ Deleted ${id}.yaml`);
      }

      for (const id of stampsToDelete) {
        const stampPath = join(worktreePath, getStampPath(id));
        if (existsSync(stampPath)) {
          unlinkSync(stampPath);
          console.log(`${PREFIX} ✅ Deleted stamp ${id}.done`);
        }
      }

      for (const { id } of wusToDelete) {
        const removed = removeFromBacklog(backlogFilePath, id);
        if (removed) {
          console.log(`${PREFIX} ✅ Removed ${id} from backlog.md`);
        }
      }

      await gitWorktree.add('.');

      const idList = ids.map((id) => id.toLowerCase()).join(', ');
      const commitMessage = `chore(repair): delete ${ids.length} orphaned wus (${idList})`;
      return {
        commitMessage,
        files: [],
      };
    },
  });

  console.log(`${PREFIX} ✅ Successfully deleted ${ids.length} WU(s)`);
  console.log(`${PREFIX} Changes pushed to origin/main`);
}

async function main() {
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

main().catch((err) => {
  console.error(`${PREFIX} ❌ ${err.message}`);
  process.exit(EXIT_CODES.ERROR);
});
