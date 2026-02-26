// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Repair Core Module (WU-1826)
 *
 * Unified repair logic for all WU repair operations:
 * - Consistency repair (default mode): detect/repair state inconsistencies
 * - Claim repair (--claim mode): repair missing claim metadata in worktrees
 * - Admin repair (--admin mode): administrative fixes for done WUs
 *
 * This module consolidates logic from:
 * - wu-consistency-checker.ts (consistency checks)
 * - wu-repair-claim.ts (claim metadata repair)
 * - wu-admin-repair.ts (admin fixes)
 * - wu-recovery.ts (zombie state recovery)
 *
 * @see {@link ../wu-repair.ts} - Unified CLI interface
 */

import path from 'node:path';
import { existsSync, writeFileSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import {
  checkWUConsistency,
  checkAllWUConsistency,
  repairWUInconsistency,
} from './wu-consistency-checker.js';
import { readWU, writeWU, parseYAML, stringifyYAML } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import { WUStateStore, WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { WU_EVENT_TYPE } from './wu-state-schema.js';
import { getGitForCwd, createGitForPath } from './git-adapter.js';
import { EXIT_CODES, LOG_PREFIX, EMOJI, WU_STATUS, LUMENFLOW_PATHS } from './wu-constants.js';
import { die, getErrorMessage } from './error-handler.js';
import { ensureOnMain, ensureMainUpToDate, validateWUIDFormat } from './wu-helpers.js';
import { withMicroWorktree } from './micro-worktree.js';
import { validateLaneFormat } from './lane-checker.js';
import { normalizeToDateString } from './date-utils.js';

// Re-export for backwards compatibility
export { checkWUConsistency, checkAllWUConsistency, repairWUInconsistency };

// Re-export recovery utilities from wu-recovery.ts
export {
  detectZombieState,
  recoverZombieState,
  resetWorktreeYAMLForRecovery,
  getRecoveryMarkerPath,
  getRecoveryAttemptCount,
  incrementRecoveryAttempt,
  clearRecoveryAttempts,
  shouldEscalateToManualIntervention,
  MAX_RECOVERY_ATTEMPTS,
} from './wu-recovery.js';

const PREFIX = LOG_PREFIX.REPAIR;

// WU-2044: Use canonical WUDocBase instead of local definition
import type { WUDocBase as WUDoc } from './wu-doc-types.js';

interface ClaimMetadataCheckResult {
  valid: boolean;
  errors: string[];
  yamlStatus: string | null;
  stateStoreHasClaim: boolean;
}

interface ClaimRepairResult {
  success: boolean;
  repaired: string[];
  errors: string[];
}

interface ClaimRepairOptions {
  id: string;
  check?: boolean;
  worktree?: string;
}

interface AdminRepairOptions {
  id: string;
  lane?: string;
  status?: string;
  notes?: string;
  initiative?: string;
}

interface RepairModeResult {
  success: boolean;
  exitCode: number;
}

interface ConsistencyError {
  type: string;
  description: string;
}

interface ConsistencyReport {
  valid: boolean;
  id?: string;
  checked?: number;
  errors: ConsistencyError[];
}

interface ConsistencyRepairResult {
  success: boolean;
  repaired: number;
  failed: number;
}

interface ConsistencyModeOptions {
  id?: string;
  all?: boolean;
  check?: boolean;
  dryRun?: boolean;
}

// ============================================================================
// CLAIM REPAIR MODE
// ============================================================================

/**
 * Detect worktree path from WU ID using git worktree list
 *
 * @param {string} id - WU ID (e.g., 'WU-1804')
 * @returns {Promise<string|null>} Worktree path or null if not found
 */
export async function findWorktreePathForWU(id: string): Promise<string | null> {
  try {
    const git = getGitForCwd();
    const worktreeOutput = await git.worktreeList();
    const lines = worktreeOutput.split('\n');

    // Look for worktree with matching WU ID in branch name
    const idLower = id.toLowerCase();
    for (const line of lines) {
      // Line format: "worktree <path>" followed by "branch refs/heads/lane/<lane>/<id>"
      if (line.includes(idLower)) {
        const worktreeMatch = line.match(/^worktree\s+(.+)$/);
        if (worktreeMatch) {
          const matchedPath = worktreeMatch[1];
          if (matchedPath) {
            return matchedPath.trim();
          }
        }
      }
    }

    // Try porcelain format
    const porcelainOutput = await git.raw(['worktree', 'list', '--porcelain']);
    const entries = porcelainOutput.split('\n\n');
    for (const entry of entries) {
      if (entry.toLowerCase().includes(idLower)) {
        const pathMatch = entry.match(/^worktree\s+(.+)$/m);
        if (pathMatch) {
          const matchedPath = pathMatch[1];
          if (matchedPath) {
            return matchedPath.trim();
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check claim metadata state for a WU worktree
 *
 * @param {string} id - WU ID
 * @param {string} worktreePath - Path to the worktree
 * @returns {Promise<{valid: boolean, errors: string[], yamlStatus: string|null, stateStoreHasClaim: boolean}>}
 */
export async function checkClaimMetadata(
  id: string,
  worktreePath: string,
): Promise<ClaimMetadataCheckResult> {
  const errors: string[] = [];
  let yamlStatus = null;
  let stateStoreHasClaim = false;

  // Check worktree YAML status
  const wuPath = path.join(worktreePath, WU_PATHS.WU(id));
  if (existsSync(wuPath)) {
    try {
      const doc = readWU(wuPath, id);
      yamlStatus = (doc.status as string) ?? null;
      if (yamlStatus !== WU_STATUS.IN_PROGRESS) {
        errors.push(`WU YAML status is '${yamlStatus}', expected '${WU_STATUS.IN_PROGRESS}'`);
      }
    } catch (err: unknown) {
      errors.push(`Failed to read WU YAML: ${getErrorMessage(err)}`);
    }
  } else {
    errors.push(`WU YAML not found at: ${wuPath}`);
  }

  // Check state store
  const stateDir = path.join(worktreePath, LUMENFLOW_PATHS.STATE_DIR);
  const eventsPath = path.join(stateDir, WU_EVENTS_FILE_NAME);
  if (existsSync(eventsPath)) {
    try {
      const store = new WUStateStore(stateDir);
      await store.load();
      const inProgress = store.getByStatus(WU_STATUS.IN_PROGRESS);
      stateStoreHasClaim = inProgress.has(id);
      if (!stateStoreHasClaim) {
        errors.push(`State store does not show ${id} as in_progress`);
      }
    } catch (err: unknown) {
      errors.push(`Failed to read state store: ${getErrorMessage(err)}`);
    }
  } else {
    errors.push(`State store not found at: ${eventsPath}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    yamlStatus,
    stateStoreHasClaim,
  };
}

/**
 * Repair claim metadata in worktree
 *
 * SAFETY: Only modifies files inside the worktree, never main.
 *
 * @param {string} id - WU ID
 * @param {string} worktreePath - Path to the worktree
 * @param {object} checkResult - Result from checkClaimMetadata
 * @returns {Promise<{success: boolean, repaired: string[], errors: string[]}>}
 */
export async function repairClaimMetadata(
  id: string,
  worktreePath: string,
  checkResult: ClaimMetadataCheckResult,
): Promise<ClaimRepairResult> {
  const repaired: string[] = [];
  const errors: string[] = [];

  // Read current WU YAML to get lane and title
  const wuPath = path.join(worktreePath, WU_PATHS.WU(id));
  let doc: WUDoc;
  try {
    doc = readWU(wuPath, id) as WUDoc;
  } catch (err: unknown) {
    return {
      success: false,
      repaired: [],
      errors: [`Cannot read WU YAML to repair: ${getErrorMessage(err)}`],
    };
  }

  const lane = typeof doc.lane === 'string' ? doc.lane : '';
  const title = typeof doc.title === 'string' ? doc.title : `WU ${id}`;

  // Repair 1: Fix YAML status if needed
  if (checkResult.yamlStatus !== WU_STATUS.IN_PROGRESS) {
    try {
      doc.status = WU_STATUS.IN_PROGRESS;
      // Remove done-state fields that shouldn't be present
      delete doc.locked;
      delete doc.completed_at;
      writeWU(wuPath, doc);
      repaired.push(`WU YAML status set to '${WU_STATUS.IN_PROGRESS}'`);
    } catch (err: unknown) {
      errors.push(`Failed to update WU YAML status: ${getErrorMessage(err)}`);
    }
  }

  // Repair 2: Add claim event to state store if missing
  if (!checkResult.stateStoreHasClaim) {
    try {
      const stateDir = path.join(worktreePath, LUMENFLOW_PATHS.STATE_DIR);
      const eventsPath = path.join(stateDir, WU_EVENTS_FILE_NAME);

      // Ensure directory exists
      mkdirSync(stateDir, { recursive: true });

      // Create claim event
      const claimEvent = {
        type: WU_EVENT_TYPE.CLAIM,
        wuId: id,
        lane: lane,
        title: title,
        timestamp: new Date().toISOString(),
      };

      // Append to events file
      const line = `${JSON.stringify(claimEvent)}\n`;
      appendFileSync(eventsPath, line, 'utf-8');
      repaired.push(`Claim event added to state store`);
    } catch (err: unknown) {
      errors.push(`Failed to add claim event to state store: ${getErrorMessage(err)}`);
    }
  }

  // Stage and commit the repairs
  if (repaired.length > 0) {
    try {
      const gitWorktree = createGitForPath(worktreePath);

      // Stage repaired files
      const filesToStage: string[] = [wuPath];
      const stateDir = path.join(worktreePath, LUMENFLOW_PATHS.STATE_DIR);
      const eventsPath = path.join(stateDir, WU_EVENTS_FILE_NAME);
      if (existsSync(eventsPath)) {
        filesToStage.push(eventsPath);
      }

      await gitWorktree.add(filesToStage);

      // Commit with repair message
      const commitMsg = `wu(${id.toLowerCase()}): repair-claim - restore missing claim metadata`;
      await gitWorktree.commit(commitMsg);
      repaired.push(`Committed repair: ${commitMsg}`);

      // Push to remote
      const currentBranch = await gitWorktree.getCurrentBranch();
      await gitWorktree.push('origin', currentBranch);
      repaired.push(`Pushed to origin/${currentBranch}`);
    } catch (err: unknown) {
      // Don't fail the entire repair if commit/push fails
      errors.push(`Git operations failed: ${getErrorMessage(err)}. Manual commit may be required.`);
    }
  }

  return {
    success: errors.length === 0,
    repaired,
    errors,
  };
}

/**
 * Run claim repair mode
 *
 * @param {object} options - CLI options
 * @param {string} options.id - WU ID
 * @param {boolean} [options.check] - Check only, no repair
 * @param {string} [options.worktree] - Override worktree path
 * @returns {Promise<{success: boolean, exitCode: number}>}
 */
export async function runClaimRepairMode(options: ClaimRepairOptions): Promise<RepairModeResult> {
  const { id, check, worktree } = options;

  console.log(`${PREFIX} Checking claim metadata for ${id}...`);

  // Find worktree path
  let worktreePath: string | null = worktree ?? null;
  if (!worktreePath) {
    worktreePath = await findWorktreePathForWU(id);
  }

  if (!worktreePath) {
    console.error(`${PREFIX} Error: Could not find worktree for ${id}`);
    console.error(`${PREFIX} Ensure the worktree exists, or specify with --worktree <path>`);
    return { success: false, exitCode: EXIT_CODES.FAILURE };
  }

  if (!existsSync(worktreePath)) {
    console.error(`${PREFIX} Error: Worktree path does not exist: ${worktreePath}`);
    return { success: false, exitCode: EXIT_CODES.FAILURE };
  }

  console.log(`${PREFIX} Found worktree: ${worktreePath}`);

  // Check claim metadata state
  const checkResult = await checkClaimMetadata(id, worktreePath);

  if (checkResult.valid) {
    console.log(`${PREFIX} ${EMOJI.SUCCESS} Claim metadata is valid for ${id}`);
    console.log(`${PREFIX}   - YAML status: ${checkResult.yamlStatus}`);
    console.log(`${PREFIX}   - State store: has claim event`);
    return { success: true, exitCode: EXIT_CODES.SUCCESS };
  }

  // Report issues
  console.log(`${PREFIX} ${EMOJI.WARNING} Found ${checkResult.errors.length} issue(s):`);
  for (const error of checkResult.errors) {
    console.log(`${PREFIX}   - ${error}`);
  }

  // Check-only mode
  if (check) {
    console.log(`${PREFIX} --check mode: no changes made`);
    return { success: false, exitCode: EXIT_CODES.ERROR };
  }

  // Repair
  console.log(`${PREFIX} Repairing claim metadata...`);
  const repairResult = await repairClaimMetadata(id, worktreePath, checkResult);

  // Report repairs
  if (repairResult.repaired.length > 0) {
    console.log(`${PREFIX} ${EMOJI.SUCCESS} Repairs applied:`);
    for (const repair of repairResult.repaired) {
      console.log(`${PREFIX}   - ${repair}`);
    }
  }

  // Report repair errors
  if (repairResult.errors.length > 0) {
    console.log(`${PREFIX} ${EMOJI.WARNING} Repair warnings:`);
    for (const error of repairResult.errors) {
      console.log(`${PREFIX}   - ${error}`);
    }
  }

  if (repairResult.success) {
    console.log(`\n${PREFIX} ${EMOJI.SUCCESS} Repair complete!`);
    console.log(`${PREFIX} You can now retry: pnpm wu:done --id ${id}`);
    return { success: true, exitCode: EXIT_CODES.SUCCESS };
  } else {
    console.error(`\n${PREFIX} ${EMOJI.FAILURE} Repair failed. Manual intervention required.`);
    return { success: false, exitCode: EXIT_CODES.FAILURE };
  }
}

// ============================================================================
// ADMIN REPAIR MODE
// ============================================================================

const ADMIN_PREFIX = '[wu:admin-repair]';
const OPERATION_NAME = 'wu-admin-repair';
const VALID_STATUSES = Object.values(WU_STATUS);

/**
 * Validate status value against WU_STATUS enum
 *
 * @param {string} status - Status value to validate
 */
function validateStatus(status: string): void {
  if (!VALID_STATUSES.includes(status)) {
    die(`Invalid status: '${status}'\n\n` + `Valid statuses: ${VALID_STATUSES.join(', ')}`);
  }
}

/**
 * Check WU exists (does NOT block on done status unlike wu:edit)
 *
 * @param {string} id - WU ID
 * @returns {object} WU object
 */
function validateWUExists(id: string): WUDoc {
  const wuPath = WU_PATHS.WU(id);
  if (!existsSync(wuPath)) {
    die(`WU ${id} not found at ${wuPath}\n\nEnsure the WU exists and you're in the repo root.`);
  }

  const content = readFileSync(wuPath, { encoding: 'utf-8' });
  const wu = parseYAML(content) as WUDoc;

  // Admin repair ALLOWS editing done WUs (key difference from wu:edit)
  return wu;
}

export function shouldUseBranchPrAdminRepairPath(wu: { claimed_mode?: string }): boolean {
  return wu.claimed_mode === 'branch-pr';
}

/**
 * Ensure working tree is clean
 */
async function ensureCleanWorkingTree() {
  const status = await getGitForCwd().getStatus();
  if (status.trim()) {
    die(
      `Working tree is not clean. Cannot run admin-repair.\n\nUncommitted changes:\n${status}\n\nCommit or stash changes before running admin-repair:\n  git add . && git commit -m "..."\n`,
    );
  }
}

/**
 * Generate audit trail entry for repairs
 *
 * @param {string[]} changes - List of changes made
 * @returns {string} Audit trail entry
 */
function generateAuditEntry(changes: string[]): string {
  const date = new Date().toISOString().split('T')[0];
  return `\n\n[ADMIN-REPAIR ${date}]: ${changes.join('; ')}`;
}

/**
 * Normalize date fields in WU object to prevent date corruption
 *
 * @param {object} wu - WU object from yaml.load()
 * @returns {object} WU object with normalized date fields
 */
function normalizeWUDates(wu: WUDoc): WUDoc {
  if (wu.created !== undefined) {
    wu.created = normalizeToDateString(wu.created);
  }
  if (wu.completed !== undefined) {
    wu.completed = normalizeToDateString(wu.completed);
  }
  return wu;
}

/**
 * Apply lane repair and return changes
 */
function applyLaneRepair(
  wu: WUDoc,
  updated: WUDoc,
  opts: AdminRepairOptions,
  changes: string[],
): void {
  if (!opts.lane) return;
  validateLaneFormat(opts.lane);
  if (wu.lane === opts.lane) return;
  changes.push(`lane changed from '${wu.lane}' to '${opts.lane}'`);
  updated.lane = opts.lane;
}

/**
 * Apply status repair and return changes
 */
function applyStatusRepair(
  wu: WUDoc,
  updated: WUDoc,
  opts: AdminRepairOptions,
  changes: string[],
): void {
  if (!opts.status) return;
  validateStatus(opts.status);
  if (wu.status === opts.status) return;

  changes.push(`status changed from '${wu.status}' to '${opts.status}'`);
  updated.status = opts.status;

  // Update locked flag based on status
  if (opts.status === WU_STATUS.DONE) {
    updated.locked = true;
  } else if (wu.locked === true) {
    // Unlock if moving away from done
    updated.locked = false;
    changes.push('locked changed from true to false');
  }
}

/**
 * Apply initiative repair and return changes
 */
function applyInitiativeRepair(
  wu: WUDoc,
  updated: WUDoc,
  opts: AdminRepairOptions,
  changes: string[],
): void {
  if (!opts.initiative || wu.initiative === opts.initiative) return;
  const oldVal = wu.initiative || '(none)';
  changes.push(`initiative changed from '${oldVal}' to '${opts.initiative}'`);
  updated.initiative = opts.initiative;
}

/**
 * Apply notes update and return changes
 */
function applyNotesUpdate(
  wu: WUDoc,
  updated: WUDoc,
  opts: AdminRepairOptions,
  changes: string[],
): void {
  if (!opts.notes) return;
  const existingNotes = wu.notes || '';
  changes.push(`notes updated`);
  updated.notes = `${existingNotes}\n\n${opts.notes}`;
}

/**
 * Append audit trail to notes based on changes made
 */
function appendAuditTrail(updated: WUDoc, opts: AdminRepairOptions, changes: string[]): void {
  if (changes.length === 0) return;

  if (opts.notes) {
    // If notes were explicitly provided, add audit for non-notes changes only
    const nonNotesChanges = changes.filter((c: string) => c !== 'notes updated');
    if (nonNotesChanges.length > 0) {
      updated.notes = `${updated.notes}${generateAuditEntry(nonNotesChanges)}`;
    }
  } else {
    // All changes get audit trail
    const existingNotes = updated.notes || '';
    updated.notes = `${existingNotes}${generateAuditEntry(changes)}`;
  }
}

/**
 * Apply repairs to WU and track changes for audit
 *
 * @param {object} wu - Original WU object
 * @param {object} opts - CLI options
 * @returns {{ updated: object, changes: string[] }} Updated WU and list of changes
 */
export function applyAdminRepairs(
  wu: WUDoc,
  opts: AdminRepairOptions,
): { updated: WUDoc; changes: string[] } {
  const updated = { ...wu };
  const changes: string[] = [];

  applyLaneRepair(wu, updated, opts, changes);
  applyStatusRepair(wu, updated, opts, changes);
  applyInitiativeRepair(wu, updated, opts, changes);
  applyNotesUpdate(wu, updated, opts, changes);
  appendAuditTrail(updated, opts, changes);

  return { updated, changes };
}

/**
 * Generate commit message for admin repair
 *
 * @param {string} id - WU ID
 * @param {string[]} changes - List of changes made
 * @returns {string} Commit message
 */
function generateAdminCommitMessage(id: string, changes: string[]): string {
  // Extract field names from changes
  const fields = changes
    .map((c: string) => c.split(' ')[0] ?? '')
    .filter((f: string) => f !== 'notes');
  const uniqueFields = [...new Set(fields)];
  const fieldSummary = uniqueFields.length > 0 ? uniqueFields.join(', ') : 'notes';
  return `fix(${id.toLowerCase()}): admin-repair ${fieldSummary}`;
}

/**
 * Run admin repair mode
 *
 * @param {object} options - CLI options
 * @param {string} options.id - WU ID
 * @param {string} [options.lane] - New lane assignment
 * @param {string} [options.status] - New status value
 * @param {string} [options.notes] - Notes to add
 * @param {string} [options.initiative] - New initiative reference
 * @returns {Promise<{success: boolean, exitCode: number}>}
 */
export async function runAdminRepairMode(options: AdminRepairOptions): Promise<RepairModeResult> {
  const { id } = options;

  console.log(`${ADMIN_PREFIX} Starting admin repair for ${id}`);

  // Validate inputs
  validateWUIDFormat(id);

  // Check we have at least one field to repair BEFORE checking WU existence
  // (no point in looking up the WU if no repair fields are provided)
  const hasRepairs = options.lane || options.status || options.notes || options.initiative;
  if (!hasRepairs) {
    die(
      'No repairs specified.\n\n' +
        'Provide at least one of:\n' +
        '  --lane <lane>           Fix lane assignment (e.g., "Operations: Tooling")\n' +
        '  --status <status>       Fix status value (ready, in_progress, blocked, done, cancelled)\n' +
        '  --notes <text>          Add repair notes (appends with audit trail)\n' +
        '  --initiative <ref>      Fix initiative reference (e.g., INIT-001)\n\n' +
        'Example:\n' +
        '  pnpm wu:repair --admin --id WU-123 --lane "Operations: Tooling"',
    );
  }

  // Now validate WU exists
  const originalWU = validateWUExists(id);
  const branchPrPath = shouldUseBranchPrAdminRepairPath(originalWU);

  // Apply repairs
  const { updated: updatedWU, changes } = applyAdminRepairs(originalWU, options);

  // Check if UnsafeAny actual changes were made
  if (changes.length === 0) {
    console.log(`${ADMIN_PREFIX} No changes needed - WU already has specified values`);
    return { success: true, exitCode: EXIT_CODES.SUCCESS };
  }

  console.log(`${ADMIN_PREFIX} Changes to apply:`);
  for (const change of changes) {
    console.log(`${ADMIN_PREFIX}   • ${change}`);
  }

  await ensureCleanWorkingTree();
  if (!branchPrPath) {
    // Pre-flight checks for micro-worktree operation
    await ensureOnMain(getGitForCwd());
    await ensureMainUpToDate(getGitForCwd(), 'wu:repair --admin');
  }

  try {
    if (branchPrPath) {
      const git = getGitForCwd();
      const currentBranch = await git.getCurrentBranch();
      const claimedBranch =
        typeof originalWU.claimed_branch === 'string' ? originalWU.claimed_branch : '';
      if (claimedBranch && claimedBranch !== currentBranch) {
        die(
          `Cannot run admin repair for ${id}: current branch '${currentBranch}' does not match claimed_branch '${claimedBranch}'.`,
        );
      }

      const wuPath = WU_PATHS.WU(id);
      normalizeWUDates(updatedWU);
      const yamlContent = stringifyYAML(updatedWU);
      writeFileSync(wuPath, yamlContent, { encoding: 'utf-8' });
      console.log(`${ADMIN_PREFIX} ${EMOJI.SUCCESS} Updated ${id}.yaml on branch ${currentBranch}`);

      await git.add(wuPath);
      await git.commit(generateAdminCommitMessage(id, changes));
      await git.push('origin', currentBranch);
    } else {
      console.log(`${ADMIN_PREFIX} Applying repairs via micro-worktree...`);
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: id,
        logPrefix: ADMIN_PREFIX,
        execute: async ({ worktreePath }) => {
          // Write updated WU to micro-worktree
          const wuPath = path.join(worktreePath, WU_PATHS.WU(id));
          // Normalize dates before dumping to prevent ISO timestamp corruption
          normalizeWUDates(updatedWU);
          const yamlContent = stringifyYAML(updatedWU);

          writeFileSync(wuPath, yamlContent, { encoding: 'utf-8' });
          console.log(`${ADMIN_PREFIX} ${EMOJI.SUCCESS} Updated ${id}.yaml in micro-worktree`);

          return {
            commitMessage: generateAdminCommitMessage(id, changes),
            files: [WU_PATHS.WU(id)],
          };
        },
      });
    }

    console.log(`${ADMIN_PREFIX} ${EMOJI.SUCCESS} Successfully repaired ${id}`);
    if (branchPrPath) {
      const currentBranch = await getGitForCwd().getCurrentBranch();
      console.log(`${ADMIN_PREFIX} Changes pushed to origin/${currentBranch}`);
    } else {
      console.log(`${ADMIN_PREFIX} Changes pushed to origin/main`);
    }
    console.log(`${ADMIN_PREFIX} Audit trail logged to WU notes`);
    return { success: true, exitCode: EXIT_CODES.SUCCESS };
  } catch (err: unknown) {
    console.error(`${ADMIN_PREFIX} ${EMOJI.FAILURE} ${getErrorMessage(err)}`);
    return { success: false, exitCode: EXIT_CODES.ERROR };
  }
}

// ============================================================================
// CONSISTENCY REPAIR MODE (default)
// ============================================================================

/**
 * Format error for display
 * @param {object} error - Error object
 * @returns {string} Formatted error string
 */
function formatError(error: ConsistencyError): string {
  return `  - ${error.type}: ${error.description}`;
}

/**
 * Print consistency report
 * @param {object} report - Consistency report
 */
function printReport(report: ConsistencyReport): void {
  if (report.valid) {
    console.log(`${PREFIX} ${report.id}: No inconsistencies detected`);
    return;
  }

  console.log(`${PREFIX} ${report.id}: ${report.errors.length} inconsistency(ies) found`);
  for (const error of report.errors) {
    console.log(formatError(error));
  }
}

/**
 * Repair a single WU for consistency issues
 *
 * @param {string} id - WU ID
 * @param {object} options - CLI options
 * @returns {Promise<{success: boolean, repaired: number, failed: number}>}
 */
export async function repairSingleWU(
  id: string,
  options: Pick<ConsistencyModeOptions, 'check'>,
): Promise<ConsistencyRepairResult> {
  console.log(`${PREFIX} Checking ${id}...`);
  const report = (await checkWUConsistency(id)) as ConsistencyReport;

  if (report.valid) {
    console.log(`${PREFIX} ${id}: No inconsistencies detected`);
    return { success: true, repaired: 0, failed: 0 };
  }

  printReport(report);

  if (options.check) {
    return { success: false, repaired: 0, failed: report.errors.length };
  }

  console.log(`${PREFIX} Repairing ${id}...`);
  const result = await repairWUInconsistency(report as Parameters<typeof repairWUInconsistency>[0]);

  if (result.failed > 0) {
    console.error(
      `${PREFIX} Repair partially failed: ${result.repaired} repaired, ${result.failed} failed`,
    );
    return { success: false, repaired: result.repaired, failed: result.failed };
  }

  console.log(`${PREFIX} Successfully repaired ${result.repaired} issue(s)`);
  return { success: true, repaired: result.repaired, failed: 0 };
}

/**
 * Repair all WUs for consistency issues
 *
 * @param {object} options - CLI options
 * @returns {Promise<{success: boolean, repaired: number, failed: number}>}
 */
export async function repairAllWUs(options: { dryRun?: boolean; check?: boolean } = {}) {
  const dryRun = options.dryRun === true || options.check === true;
  console.log(`${PREFIX} Checking all WUs...`);
  const report = (await checkAllWUConsistency()) as ConsistencyReport;

  if (report.valid) {
    console.log(`${PREFIX} All ${report.checked} WUs are consistent`);
    return { success: true, repaired: 0, failed: 0 };
  }

  console.log(
    `${PREFIX} Found ${report.errors.length} inconsistency issue(s) out of ${report.checked} WUs checked`,
  );
  console.log();

  // Print all errors
  for (const error of report.errors) {
    console.log(`  - ${error.type}: ${error.description}`);
  }
  console.log();

  if (dryRun) {
    return { success: false, repaired: 0, failed: report.errors.length };
  }

  // Repair the inconsistencies
  console.log(`${PREFIX} Repairing inconsistencies...`);
  const result = await repairWUInconsistency(report as Parameters<typeof repairWUInconsistency>[0]);

  if (result.failed > 0) {
    console.error(
      `${PREFIX} Partial failure - ${result.repaired} repaired, ${result.failed} failed`,
    );
  } else {
    console.log(`${PREFIX} Repaired ${result.repaired} issue(s)`);
  }
  console.log();

  console.log(`${PREFIX} Summary: ${result.repaired} repaired, ${result.failed} failed`);
  return { success: result.failed === 0, repaired: result.repaired, failed: result.failed };
}

/**
 * Run consistency repair mode (default)
 *
 * @param {object} options - CLI options
 * @param {string} [options.id] - WU ID to check/repair
 * @param {boolean} [options.all] - Check/repair all WUs
 * @param {boolean} [options.check] - Audit only, no changes
 * @returns {Promise<{success: boolean, exitCode: number}>}
 */
export async function runConsistencyRepairMode(
  options: ConsistencyModeOptions,
): Promise<RepairModeResult> {
  let result: ConsistencyRepairResult;
  try {
    if (options.all) {
      result = await repairAllWUs({
        ...options,
        dryRun: options.dryRun === true || options.check === true,
      });
    } else {
      const wuId = options.id;
      if (!wuId) {
        return { success: false, exitCode: EXIT_CODES.FAILURE };
      }
      result = await repairSingleWU(wuId, options);
    }
  } catch (error: unknown) {
    console.error(`${PREFIX} Fatal error: ${getErrorMessage(error)}`);
    return { success: false, exitCode: EXIT_CODES.FAILURE };
  }

  // Exit codes:
  // 0: Success (no issues or all repaired)
  // 1: Issues detected (--check mode)
  // 2: Repair failed
  if (!result.success) {
    return {
      success: false,
      exitCode: options.check ? EXIT_CODES.ERROR : EXIT_CODES.FAILURE,
    };
  }

  return { success: true, exitCode: EXIT_CODES.SUCCESS };
}

// ============================================================================
// DUPLICATE ID REPAIR MODE (WU-2213)
// ============================================================================

export interface DuplicateIdsModeOptions {
  apply?: boolean;
  projectRoot?: string;
}

/**
 * Run duplicate-IDs repair mode
 *
 * Detects ID collisions across YAML, stamps, and event stream.
 * Dry-run is default; --apply to actually rename.
 *
 * @param {object} options - CLI options
 * @param {boolean} [options.apply] - Apply repairs (default: dry-run)
 * @param {string} [options.projectRoot] - Override project root
 * @returns {Promise<{success: boolean, exitCode: number}>}
 */
export async function runDuplicateIdsMode(
  options: DuplicateIdsModeOptions,
): Promise<RepairModeResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const applyMode = options.apply === true;

  console.log(
    `${PREFIX} Scanning for duplicate WU IDs${applyMode ? ' (apply mode)' : ' (dry-run)'}...`,
  );

  try {
    const { detectDuplicateIds, repairDuplicateIds } =
      await import('./wu-duplicate-id-detector.js');

    // Detection phase
    const report = await detectDuplicateIds(projectRoot);

    if (report.duplicates.length === 0) {
      console.log(
        `${PREFIX} ${EMOJI.SUCCESS} No duplicate IDs found across ${report.totalWUs} WU files`,
      );
      return { success: true, exitCode: EXIT_CODES.SUCCESS };
    }

    // Report duplicates
    console.log(
      `${PREFIX} ${EMOJI.WARNING} Found ${report.duplicates.length} duplicate ID group(s) across ${report.totalWUs} WU files:`,
    );
    for (const group of report.duplicates) {
      console.log(
        `${PREFIX}   ${group.id}: ${group.files.length} files, ${group.stamps.length} stamps, ${group.events.length} events`,
      );
      for (const file of group.files) {
        console.log(`${PREFIX}     - ${file}`);
      }
    }

    // Repair phase
    const result = await repairDuplicateIds(projectRoot, { apply: applyMode });

    // Emit mapping report
    if (result.mappings.length > 0) {
      console.log(`\n${PREFIX} ID Remapping Report:`);
      for (const mapping of result.mappings) {
        console.log(`${PREFIX}   ${mapping.oldId} -> ${mapping.newId}`);
        console.log(`${PREFIX}     File: ${mapping.renamedFile}`);
        if (mapping.touchedFiles.length > 0) {
          console.log(`${PREFIX}     Touched: ${mapping.touchedFiles.join(', ')}`);
        }
      }
    }

    if (!applyMode) {
      console.log(`\n${PREFIX} Dry-run complete. Run with --apply to execute repairs.`);
      return { success: true, exitCode: EXIT_CODES.SUCCESS };
    }

    console.log(`\n${PREFIX} ${EMOJI.SUCCESS} Applied ${result.mappings.length} ID remapping(s)`);
    return { success: true, exitCode: EXIT_CODES.SUCCESS };
  } catch (error: unknown) {
    console.error(`${PREFIX} ${EMOJI.FAILURE} ${getErrorMessage(error)}`);
    return { success: false, exitCode: EXIT_CODES.FAILURE };
  }
}
