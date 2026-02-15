#!/usr/bin/env node

/**
 * Initiative Edit Helper
 *
 * Race-safe Initiative editing using micro-worktree isolation (WU-1451).
 *
 * Enables editing Initiative YAML files with atomic commits, perfect for:
 * - Updating initiative status
 * - Setting blocked_by and blocked_reason
 * - Unblocking initiatives
 * - Adding lanes
 * - Renaming phase titles
 * - Appending notes
 * - Fixing malformed created dates (WU-2547)
 *
 * Uses the micro-worktree pattern with pushOnly mode (WU-1435):
 * 1) Validate inputs (Initiative exists, status is valid enum)
 * 2) Ensure main is clean and up-to-date with origin
 * 3) Create temp branch WITHOUT switching (main checkout stays on main)
 * 4) Create micro-worktree in /tmp pointing to temp branch
 * 5) Apply edits in micro-worktree
 * 6) Commit, push directly to origin/main
 * 7) Cleanup temp branch and micro-worktree
 *
 * Usage:
 *   pnpm initiative:edit --id INIT-001 --status in_progress
 *   pnpm initiative:edit --id INIT-001 --blocked-by INIT-002 --blocked-reason "Waiting for Phase 1"
 *   pnpm initiative:edit --id INIT-001 --unblock
 *   pnpm initiative:edit --id INIT-001 --add-lane "Operations: Tooling"
 *   pnpm initiative:edit --id INIT-001 --notes "Phase 2 started"
 *   pnpm initiative:edit --id INIT-001 --phase-id 1 --phase-title "Phase 1: Foundation"
 *
 * Part of WU-1451: Add initiative:edit command for updating initiative status and blockers
 * @see {@link packages/@lumenflow/cli/src/lib/micro-worktree.ts} - Shared micro-worktree logic
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import {
  INIT_STATUSES,
  PHASE_STATUSES,
  INIT_PATTERNS,
  INIT_LOG_PREFIX,
  INIT_COMMIT_FORMATS,
} from '@lumenflow/initiatives/constants';
import { FILE_SYSTEM, MICRO_WORKTREE_OPERATIONS } from '@lumenflow/core/wu-constants';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import {
  withMicroWorktree,
  isRetryExhaustionError as coreIsRetryExhaustionError,
  formatRetryExhaustionError as coreFormatRetryExhaustionError,
} from '@lumenflow/core/micro-worktree';
import { runCLI } from './cli-entry-point.js';
import { validateInitiativeEditCliArgs } from './shared-validators.js';

const PREFIX = INIT_LOG_PREFIX.EDIT;

interface InitiativePhase extends Record<string, unknown> {
  id: number;
  title: string;
  status: string;
}

interface InitiativeDoc extends Record<string, unknown> {
  id: string;
  status?: string;
  blocked_by?: string;
  blocked_reason?: string;
  lanes?: string[];
  notes?: string[];
  description?: string;
  phases?: InitiativePhase[];
  success_metrics?: string[];
  created?: string;
}

interface InitiativeEditOpts extends Record<string, unknown> {
  id: string;
  status?: string;
  blockedBy?: string;
  blockedReason?: string;
  unblock?: boolean;
  addLane?: string[];
  removeLane?: string[];
  notes?: string;
  description?: string;
  addPhase?: string[];
  addSuccessMetric?: string[];
  removeSuccessMetric?: string[];
  phaseId?: string;
  phaseStatus?: string;
  phaseTitle?: string;
  created?: string;
}

/**
 * WU-1621: operation-level push retry override for initiative:edit.
 *
 * initiative metadata updates are often chained with plan-link updates;
 * a slightly wider retry window improves convergence when origin/main moves.
 */
export const INITIATIVE_EDIT_PUSH_RETRY_OVERRIDE = {
  retries: 8,
  min_delay_ms: 300,
  max_delay_ms: 4000,
};

/**
 * Check if an error is a push retry exhaustion error.
 */
export function isRetryExhaustionError(error: Error): boolean {
  return coreIsRetryExhaustionError(error);
}

/**
 * Format retry exhaustion error with actionable command guidance.
 */
export function formatRetryExhaustionError(error: Error, initId: string): string {
  return coreFormatRetryExhaustionError(error, {
    command: `pnpm initiative:edit --id ${initId} --status <status>`,
  });
}

/**
 * Custom options for initiative-edit
 */
const EDIT_OPTIONS = {
  id: {
    name: 'id',
    flags: '-i, --id <initId>',
    description: 'Initiative ID (e.g., INIT-001)',
  },
  status: {
    name: 'status',
    flags: '--status <status>',
    description: `New status (${INIT_STATUSES.join(', ')})`,
  },
  blockedBy: {
    name: 'blockedBy',
    flags: '--blocked-by <initId>',
    description: 'Initiative ID that blocks this initiative',
  },
  blockedReason: {
    name: 'blockedReason',
    flags: '--blocked-reason <text>',
    description: 'Reason for blocking (required with --blocked-by)',
  },
  unblock: {
    name: 'unblock',
    flags: '--unblock',
    description: 'Remove blocked_by and blocked_reason fields',
  },
  addLane: {
    name: 'addLane',
    flags: '--add-lane <lane>',
    description: 'Lane to add (repeatable)',
    isRepeatable: true,
  },
  removeLane: {
    name: 'removeLane',
    flags: '--remove-lane <lane>',
    description: 'Lane to remove (repeatable)',
    isRepeatable: true,
  },
  notes: {
    name: 'notes',
    flags: '--notes <text>',
    description: 'Note to append to notes array',
  },
  // WU-1475: New planning field options
  description: {
    name: 'description',
    flags: '--description <text>',
    description: 'Replace the initiative description field',
  },
  addPhase: {
    name: 'addPhase',
    flags: '--add-phase <title>',
    description: 'Append a new phase with auto-incremented id and pending status (repeatable)',
    isRepeatable: true,
  },
  addSuccessMetric: {
    name: 'addSuccessMetric',
    flags: '--add-success-metric <text>',
    description: 'Append to success_metrics array, avoiding duplicates (repeatable)',
    isRepeatable: true,
  },
  removeSuccessMetric: {
    name: 'removeSuccessMetric',
    flags: '--remove-success-metric <text>',
    description: 'Remove exact match from success_metrics array (repeatable)',
    isRepeatable: true,
  },
  // WU-1836: Phase status update options
  phaseId: {
    name: 'phaseId',
    flags: '--phase-id <id>',
    description: 'Phase ID to update (use with --phase-status)',
  },
  phaseStatus: {
    name: 'phaseStatus',
    flags: '--phase-status <status>',
    description: `Update phase status (${PHASE_STATUSES.join(', ')})`,
  },
  phaseTitle: {
    name: 'phaseTitle',
    flags: '--phase-title <title>',
    description: 'Update phase title (use with --phase-id)',
  },
  // WU-2547: Created date field
  created: {
    name: 'created',
    flags: '--created <date>',
    description: 'Set created date (YYYY-MM-DD format)',
  },
};

/**
 * Parse command line arguments
 */
function parseArgs(): InitiativeEditOpts {
  const opts = createWUParser({
    name: 'initiative-edit',
    description: 'Edit Initiative YAML files with micro-worktree isolation',
    options: [
      EDIT_OPTIONS.id,
      EDIT_OPTIONS.status,
      EDIT_OPTIONS.blockedBy,
      EDIT_OPTIONS.blockedReason,
      EDIT_OPTIONS.unblock,
      EDIT_OPTIONS.addLane,
      EDIT_OPTIONS.removeLane,
      EDIT_OPTIONS.notes,
      // WU-1475: New planning field options
      EDIT_OPTIONS.description,
      EDIT_OPTIONS.addPhase,
      EDIT_OPTIONS.addSuccessMetric,
      EDIT_OPTIONS.removeSuccessMetric,
      // WU-1836: Phase status update options
      EDIT_OPTIONS.phaseId,
      EDIT_OPTIONS.phaseStatus,
      EDIT_OPTIONS.phaseTitle,
      // WU-2547: Created date field
      EDIT_OPTIONS.created,
    ],
    required: [], // Don't mark id as required - we handle it manually to support positional args
    allowPositionalId: true,
  });

  // Validate id is provided (either via --id or positional argument)
  if (!opts.id) {
    die(
      'Missing required option: --id <initId>\n\n' +
        'Usage:\n' +
        '  pnpm initiative:edit --id INIT-001 --status in_progress\n' +
        '  pnpm initiative:edit INIT-001 --status in_progress',
    );
  }

  return opts as InitiativeEditOpts;
}

export function validateEditArgs(opts: InitiativeEditOpts) {
  return validateInitiativeEditCliArgs(opts);
}

/**
 * Validate Initiative ID format
 */
function validateInitIdFormat(id: string): void {
  if (!INIT_PATTERNS.INIT_ID.test(id)) {
    die(
      `Invalid Initiative ID format: "${id}"\n\n` +
        `Expected format: INIT-<number> (e.g., INIT-001) or INIT-<NAME> (e.g., INIT-SAFETY)`,
    );
  }
}

/**
 * Validate status is a valid enum value
 */
function validateStatus(status: string): void {
  if (!INIT_STATUSES.includes(status as (typeof INIT_STATUSES)[number])) {
    die(`Invalid status: "${status}"\n\n` + `Valid statuses: ${INIT_STATUSES.join(', ')}`);
  }
}

/**
 * Validate phase status is a valid enum value (WU-1836)
 */
function validatePhaseStatus(status: string): void {
  if (!PHASE_STATUSES.includes(status as (typeof PHASE_STATUSES)[number])) {
    die(
      `Invalid phase status: "${status}"\n\n` +
        `Valid phase statuses: ${PHASE_STATUSES.join(', ')}`,
    );
  }
}

/**
 * Validate phase ID exists in initiative (WU-1836)
 */
function validatePhaseExists(initiative: InitiativeDoc, phaseId: string | number): number {
  const numericId = Number(phaseId);
  if (Number.isNaN(numericId)) {
    die(`Invalid phase ID: "${phaseId}"\n\nPhase ID must be a number.`);
  }

  const phases = initiative.phases || [];
  const phase = phases.find((p) => p.id === numericId);
  if (!phase) {
    const existingIds = phases.map((p) => p.id).join(', ') || 'none';
    die(
      `Phase ${phaseId} not found in ${initiative.id}.\n\n` + `Existing phase IDs: ${existingIds}`,
    );
  }
  return numericId;
}

/**
 * Validate created date is in YYYY-MM-DD format (WU-2547)
 *
 * @param {string} date - Date string to validate
 */
function validateCreatedDate(date: string): void {
  if (!INIT_PATTERNS.DATE.test(date)) {
    die(`Invalid date format: "${date}"\n\n` + `Expected format: YYYY-MM-DD (e.g., 2026-01-14)`);
  }
}

/**
 * Check Initiative exists and load it
 *
 * @param {string} id - Initiative ID
 * @returns {object} Initiative object
 */
function loadInitiative(id: string): InitiativeDoc {
  const initPath = INIT_PATHS.INITIATIVE(id);

  if (!existsSync(initPath)) {
    die(
      `Initiative ${id} not found at ${initPath}\n\n` +
        `Ensure the Initiative exists and you're in the repo root.`,
    );
  }

  const content = readFileSync(initPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  const parsed = parseYAML(content as string);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die(
      `Invalid Initiative payload in ${initPath}: expected YAML object.\n\n` +
        `Run: pnpm initiative:status ${id} to inspect and repair metadata.`,
    );
  }

  const doc = parsed as Record<string, unknown>;
  if (doc.id !== id) {
    die(`Initiative YAML id mismatch. Expected ${id}, found ${String(doc.id)}`);
  }

  return doc as InitiativeDoc;
}

/**
 * Ensure working tree is clean
 */
async function ensureCleanWorkingTree() {
  const status = await getGitForCwd().getStatus();
  if (status.trim()) {
    die(
      `Working tree is not clean. Cannot edit Initiative.\n\n` +
        `Uncommitted changes:\n${status}\n\n` +
        `Commit or stash changes before editing:\n  git add . && git commit -m "..."\n`,
    );
  }
}

/**
 * Apply blocking edits to Initiative
 */
function applyBlockingEdits(updated: InitiativeDoc, opts: InitiativeEditOpts): void {
  if (opts.blockedBy) {
    if (!opts.blockedReason) {
      die(
        `--blocked-reason is required when using --blocked-by.\n\n` +
          `Usage: pnpm initiative:edit --id ${updated.id} --blocked-by ${opts.blockedBy} --blocked-reason "Reason text"`,
      );
    }
    if (!INIT_PATTERNS.INIT_ID.test(opts.blockedBy)) {
      die(
        `Invalid blocked-by Initiative ID format: "${opts.blockedBy}"\n\n` +
          `Expected format: INIT-<number> (e.g., INIT-001)`,
      );
    }
    updated.blocked_by = opts.blockedBy;
    updated.blocked_reason = opts.blockedReason;
  }
  if (opts.unblock) {
    delete updated.blocked_by;
    delete updated.blocked_reason;
  }
}

/**
 * Apply lane edits (add and remove)
 * Adds first, then removes (WU-2276)
 */
export function applyLaneEdits(updated: InitiativeDoc, opts: InitiativeEditOpts): void {
  if (opts.addLane && opts.addLane.length > 0) {
    updated.lanes = updated.lanes || [];
    for (const lane of opts.addLane) {
      if (!updated.lanes.includes(lane)) {
        updated.lanes.push(lane);
      }
    }
  }
  if (opts.removeLane && opts.removeLane.length > 0) {
    updated.lanes = updated.lanes || [];
    updated.lanes = updated.lanes.filter((lane) => !opts.removeLane.includes(lane));
  }
}

/**
 * Apply array append edits (notes, success metrics)
 */
export function applyArrayEdits(updated: InitiativeDoc, opts: InitiativeEditOpts): void {
  applyLaneEdits(updated, opts);
  if (opts.notes) {
    updated.notes = updated.notes || [];
    updated.notes.push(opts.notes);
  }
  if (opts.addSuccessMetric && opts.addSuccessMetric.length > 0) {
    updated.success_metrics = updated.success_metrics || [];
    for (const metric of opts.addSuccessMetric) {
      if (!updated.success_metrics.includes(metric)) {
        updated.success_metrics.push(metric);
      }
    }
  }
  if (opts.removeSuccessMetric && opts.removeSuccessMetric.length > 0) {
    updated.success_metrics = updated.success_metrics || [];
    updated.success_metrics = updated.success_metrics.filter(
      (metric) => !opts.removeSuccessMetric.includes(metric),
    );
  }
}

/**
 * Apply phase edits with auto-incremented IDs
 */
function applyPhaseEdits(updated: InitiativeDoc, opts: InitiativeEditOpts): void {
  if (!opts.addPhase || opts.addPhase.length === 0) {
    return;
  }
  updated.phases = updated.phases || [];
  for (const title of opts.addPhase) {
    const existingIds = updated.phases.map((p) => (typeof p.id === 'number' ? p.id : 0));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    updated.phases.push({
      id: maxId + 1,
      title: title,
      status: 'pending',
    });
  }
}

/**
 * Apply phase status update (WU-1836)
 */
function applyPhaseStatusEdit(
  updated: InitiativeDoc,
  phaseId: string | number,
  phaseStatus: string,
): void {
  const numericId = Number(phaseId);
  const phase = updated.phases.find((p) => p.id === numericId);
  if (phase) {
    phase.status = phaseStatus;
  }
}

/**
 * Apply phase title update
 */
function applyPhaseTitleEdit(
  updated: InitiativeDoc,
  phaseId: string | number,
  phaseTitle: string,
): void {
  const numericId = Number(phaseId);
  const phase = updated.phases.find((p) => p.id === numericId);
  if (phase) {
    phase.title = phaseTitle;
  }
}

/**
 * Apply edits to Initiative YAML
 * Returns the updated Initiative object
 */
export function applyEdits(initiative: InitiativeDoc, opts: InitiativeEditOpts): InitiativeDoc {
  const updated = { ...initiative };

  if (opts.status) {
    validateStatus(opts.status);
    updated.status = opts.status;
  }

  applyBlockingEdits(updated, opts);
  applyArrayEdits(updated, opts);

  if (opts.description) {
    updated.description = opts.description;
  }

  applyPhaseEdits(updated, opts);

  // WU-1836: Phase status update
  if (opts.phaseId && opts.phaseStatus) {
    applyPhaseStatusEdit(updated, opts.phaseId, opts.phaseStatus);
  }

  if (opts.phaseId && opts.phaseTitle) {
    applyPhaseTitleEdit(updated, opts.phaseId, opts.phaseTitle);
  }

  // WU-2547: Created date update
  if (opts.created) {
    validateCreatedDate(opts.created);
    updated.created = opts.created;
  }

  return updated;
}

/**
 * Check if the command has at least one edit operation
 */
export function hasAnyEdits(opts: InitiativeEditOpts): boolean {
  return Boolean(
    opts.status ||
      opts.blockedBy ||
      opts.unblock ||
      (opts.addLane && opts.addLane.length > 0) ||
      (opts.removeLane && opts.removeLane.length > 0) ||
      opts.notes ||
      opts.description ||
      (opts.addPhase && opts.addPhase.length > 0) ||
      (opts.addSuccessMetric && opts.addSuccessMetric.length > 0) ||
      (opts.removeSuccessMetric && opts.removeSuccessMetric.length > 0) ||
      Boolean(opts.phaseTitle) ||
      (opts.phaseId && opts.phaseStatus) ||
      opts.created,
  );
}

/**
 * Build help message shown when no edits are provided
 */
export function buildNoEditsMessage() {
  return (
    'No edits specified.\n\n' +
    'Provide one of:\n' +
    '  --status <status>           Update initiative status\n' +
    '  --blocked-by <INIT-ID>      Set blocking initiative (requires --blocked-reason)\n' +
    '  --unblock                   Remove blocked_by and blocked_reason\n' +
    '  --add-lane <lane>           Add lane (repeatable)\n' +
    '  --remove-lane <lane>        Remove lane (repeatable)\n' +
    '  --notes <text>              Append note\n' +
    '  --description <text>        Replace description field\n' +
    '  --add-phase <title>         Add phase with auto-incremented id (repeatable)\n' +
    '  --add-success-metric <text> Add success metric (repeatable, deduplicated)\n' +
    '  --remove-success-metric <text> Remove success metric (repeatable, exact match)\n' +
    '  --phase-id <id> --phase-title <title>  Update specific phase title\n' +
    '  --phase-id <id> --phase-status <status>  Update specific phase status\n' +
    '  --created <YYYY-MM-DD>      Set created date'
  );
}

/**
 * Main entry point
 */
async function main() {
  const opts = parseArgs();
  const { id } = opts;

  console.log(`${PREFIX} Starting Initiative edit for ${id}`);

  const validation = validateEditArgs(opts);
  if (!validation.valid) {
    die(`Invalid initiative:edit arguments:\n  - ${validation.errors.join('\n  - ')}`);
  }

  // Validate inputs
  validateInitIdFormat(id);
  const originalInit = loadInitiative(id);

  // WU-1836/WU-1667: Validate phase edit options are used with --phase-id
  const hasPhaseStatusEdit = Boolean(opts.phaseStatus);
  const hasPhaseTitleEdit = Boolean(opts.phaseTitle);
  const hasAnyPhaseEdit = hasPhaseStatusEdit || hasPhaseTitleEdit;

  if (opts.phaseId && !hasAnyPhaseEdit) {
    die(
      `--phase-status or --phase-title is required when using --phase-id.\n\n` +
        `Usage: pnpm initiative:edit --id ${id} --phase-id ${opts.phaseId} --phase-status done\n` +
        `   or: pnpm initiative:edit --id ${id} --phase-id ${opts.phaseId} --phase-title "Phase title"`,
    );
  }
  if (hasAnyPhaseEdit && !opts.phaseId) {
    const usedFlag = hasPhaseTitleEdit ? '--phase-title' : '--phase-status';
    die(
      `--phase-id is required when using ${usedFlag}.\n\n` +
        `Usage: pnpm initiative:edit --id ${id} --phase-id 1 --phase-status ${
          opts.phaseStatus || 'done'
        }\n` +
        `   or: pnpm initiative:edit --id ${id} --phase-id 1 --phase-title "Phase title"`,
    );
  }

  // WU-1836/WU-1667: Validate phase exists and status enum before applying edits
  if (opts.phaseId && hasAnyPhaseEdit) {
    validatePhaseExists(originalInit, opts.phaseId);
  }
  if (opts.phaseStatus) {
    validatePhaseStatus(opts.phaseStatus);
  }

  // Check we have something to edit
  const hasEdits = hasAnyEdits(opts);

  if (!hasEdits) {
    die(buildNoEditsMessage());
  }

  // Apply edits to get updated Initiative
  const updatedInit = applyEdits(originalInit, opts);

  // Pre-flight checks for micro-worktree mode
  // WU-1497: Removed ensureMainUpToDate - withMicroWorktree already handles
  // origin sync and respects git.requireRemote=false (local-only mode)
  await ensureOnMain(getGitForCwd());
  await ensureCleanWorkingTree();

  console.log(`${PREFIX} Applying edits via micro-worktree...`);

  // WU-1255: Set LUMENFLOW_WU_TOOL to allow pre-push hook bypass for micro-worktree pushes
  const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
  process.env.LUMENFLOW_WU_TOOL = MICRO_WORKTREE_OPERATIONS.INITIATIVE_EDIT;
  try {
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.INITIATIVE_EDIT,
      id: id,
      logPrefix: PREFIX,
      pushOnly: true, // WU-1435: Push directly to origin/main without touching local main
      pushRetryOverride: INITIATIVE_EDIT_PUSH_RETRY_OVERRIDE,
      execute: async ({ worktreePath }: { worktreePath: string }) => {
        // Write updated Initiative to micro-worktree
        const initPath = join(worktreePath, INIT_PATHS.INITIATIVE(id));
        const yamlContent = stringifyYAML(updatedInit);

        writeFileSync(initPath, yamlContent, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
        console.log(`${PREFIX} Updated ${id}.yaml in micro-worktree`);

        return {
          commitMessage: INIT_COMMIT_FORMATS.EDIT(id),
          files: [INIT_PATHS.INITIATIVE(id)],
        };
      },
    });

    console.log(`${PREFIX} Successfully edited ${id}`);
    console.log(`${PREFIX} Changes pushed to origin/main`);
  } catch (error) {
    if (error instanceof Error && isRetryExhaustionError(error)) {
      die(formatRetryExhaustionError(error, id));
    }
    throw error;
  } finally {
    // WU-1255: Restore LUMENFLOW_WU_TOOL to previous value
    if (previousWuTool === undefined) {
      delete process.env.LUMENFLOW_WU_TOOL;
    } else {
      process.env.LUMENFLOW_WU_TOOL = previousWuTool;
    }
  }
}

// WU-1476: Use standard CLI entry-point guard to avoid side effects during test imports
if (import.meta.main) {
  void runCLI(main);
}
