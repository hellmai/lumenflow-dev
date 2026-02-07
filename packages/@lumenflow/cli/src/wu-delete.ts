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
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { parseYAML } from '@lumenflow/core/dist/wu-yaml.js';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { generateBacklog, generateStatus } from '@lumenflow/core/dist/backlog-generator.js';
import { WUStateStore } from '@lumenflow/core/dist/wu-state-store.js';
import {
  FILE_SYSTEM,
  EXIT_CODES,
  MICRO_WORKTREE_OPERATIONS,
  LOG_PREFIX,
  WU_STATUS,
  LUMENFLOW_PATHS,
} from '@lumenflow/core/dist/wu-constants.js';
import {
  ensureOnMain,
  ensureMainUpToDate,
  validateWUIDFormat,
} from '@lumenflow/core/dist/wu-helpers.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
import { INIT_PATHS } from '@lumenflow/initiatives/dist/initiative-paths.js';
import { INIT_PATTERNS } from '@lumenflow/initiatives/dist/initiative-constants.js';
import { readInitiative, writeInitiative } from '@lumenflow/initiatives/dist/initiative-yaml.js';

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
  const modified = new Set<string>();

  for (const id of normalizedIds) {
    const wuRelPath = WU_PATHS.WU(id);
    const wuAbsPath = join(worktreePath, wuRelPath);
    if (existsSync(wuAbsPath)) {
      unlinkSync(wuAbsPath);
      modified.add(wuRelPath);
      console.log(`${PREFIX} ✅ Deleted ${id}.yaml`);
    }

    const stampRelPath = getStampPath(id);
    const stampAbsPath = join(worktreePath, stampRelPath);
    if (existsSync(stampAbsPath)) {
      unlinkSync(stampAbsPath);
      modified.add(stampRelPath);
      console.log(`${PREFIX} ✅ Deleted stamp ${id}.done`);
    }
  }

  const eventsRelPath = LUMENFLOW_PATHS.WU_EVENTS;
  const eventsAbsPath = join(worktreePath, eventsRelPath);
  if (removeEventsForDeletedWUs(eventsAbsPath, normalizedIds)) {
    modified.add(eventsRelPath);
    console.log(
      `${PREFIX} ✅ Removed ${normalizedIds.size} WU event stream(s) from wu-events.jsonl`,
    );
  }

  const existingWuIds = getExistingWuIds(worktreePath);
  const orphanedRemoved = removeOrphanedEvents(eventsAbsPath, existingWuIds);
  if (orphanedRemoved > 0) {
    modified.add(eventsRelPath);
    console.log(`${PREFIX} ✅ Removed ${orphanedRemoved} orphaned event(s) for missing WU specs`);
  }

  const initiativeFiles = removeDeletedWUsFromInitiatives(worktreePath, normalizedIds);
  for (const file of initiativeFiles) {
    modified.add(file);
  }
  if (initiativeFiles.length > 0) {
    console.log(
      `${PREFIX} ✅ Removed deleted WU references from ${initiativeFiles.length} initiative file(s)`,
    );
  }

  const stateDir = join(worktreePath, '.lumenflow', 'state');
  const store = new WUStateStore(stateDir);
  await store.load();

  const backlogRelPath = WU_PATHS.BACKLOG();
  const statusRelPath = WU_PATHS.STATUS();
  const backlogAbsPath = join(worktreePath, backlogRelPath);
  const statusAbsPath = join(worktreePath, statusRelPath);

  const backlogContent = await generateBacklog(store);
  writeFileSync(backlogAbsPath, backlogContent, FILE_SYSTEM.ENCODING as BufferEncoding);
  modified.add(backlogRelPath);

  const statusContent = await generateStatus(store);
  writeFileSync(statusAbsPath, statusContent, FILE_SYSTEM.ENCODING as BufferEncoding);
  modified.add(statusRelPath);

  console.log(`${PREFIX} ✅ Regenerated backlog.md and status.md from state store`);

  return Array.from(modified);
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

  await ensureOnMain(getGitForCwd());
  await ensureCleanWorkingTree();
  await ensureMainUpToDate(getGitForCwd(), 'wu:delete');

  console.log(`${PREFIX} Deleting via micro-worktree...`);

  // WU-1245: Set LUMENFLOW_WU_TOOL for pre-push hook allowlist
  const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
  process.env.LUMENFLOW_WU_TOOL = MICRO_WORKTREE_OPERATIONS.WU_DELETE;
  try {
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.WU_DELETE,
      id: id,
      logPrefix: PREFIX,
      execute: async ({ worktreePath, gitWorktree }) => {
        const files = await cleanupDeletedWUsInWorktree({ worktreePath, ids: [id] });

        await gitWorktree.add('.');

        const commitMessage = `docs: delete ${id.toLowerCase()}`;
        return {
          commitMessage,
          files,
        };
      },
    });
  } finally {
    // Restore previous LUMENFLOW_WU_TOOL value
    if (previousWuTool === undefined) {
      delete process.env.LUMENFLOW_WU_TOOL;
    } else {
      process.env.LUMENFLOW_WU_TOOL = previousWuTool;
    }
  }

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

  await ensureOnMain(getGitForCwd());
  await ensureCleanWorkingTree();
  await ensureMainUpToDate(getGitForCwd(), 'wu:delete --batch');

  console.log(`${PREFIX} Deleting ${ids.length} WU(s) via micro-worktree...`);

  // WU-1245: Set LUMENFLOW_WU_TOOL for pre-push hook allowlist
  const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
  process.env.LUMENFLOW_WU_TOOL = MICRO_WORKTREE_OPERATIONS.WU_DELETE;
  try {
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.WU_DELETE,
      id: `batch-${ids.length}`,
      logPrefix: PREFIX,
      execute: async ({ worktreePath, gitWorktree }) => {
        const files = await cleanupDeletedWUsInWorktree({ worktreePath, ids });

        await gitWorktree.add('.');

        const idList = ids.map((id) => id.toLowerCase()).join(', ');
        const commitMessage = `chore(repair): delete ${ids.length} orphaned wus (${idList})`;
        return {
          commitMessage,
          files,
        };
      },
    });
  } finally {
    // Restore previous LUMENFLOW_WU_TOOL value
    if (previousWuTool === undefined) {
      delete process.env.LUMENFLOW_WU_TOOL;
    } else {
      process.env.LUMENFLOW_WU_TOOL = previousWuTool;
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

if (import.meta.main) {
  void main().catch((err) => {
    console.error(`${PREFIX} ❌ ${err.message}`);
    process.exit(EXIT_CODES.ERROR);
  });
}
