// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim-validation.ts
 * @description Pre-flight validation, schema validation, lane/spec checks for wu:claim.
 *
 * WU-1649: Extracted from wu-claim.ts to reduce orchestration complexity.
 * All functions are mechanical extractions preserving original behavior.
 */

import { existsSync, readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import type { ZodIssue } from 'zod';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { assertTransition } from '@lumenflow/core/state-machine';
import {
  checkLaneFree,
  validateLaneFormat,
  checkWipJustification,
} from '@lumenflow/core/lane-checker';
import {
  validateLaneCodePaths,
  logLaneValidationWarnings,
} from '@lumenflow/core/code-path-validator';
import { detectConflicts } from '@lumenflow/core/code-paths-overlap';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die, getErrorMessage, createError, ErrorCodes } from '@lumenflow/core/error-handler';
import {
  CLAIMED_MODES,
  LOG_PREFIX,
  WU_STATUS,
  STATUS_SECTIONS,
  STRING_LITERALS,
  FILE_SYSTEM,
  resolveWUStatus,
} from '@lumenflow/core/wu-constants';
import { emitWUFlowEvent } from '@lumenflow/core/telemetry';
import {
  checkLaneForOrphanDoneWU,
  repairWUInconsistency,
} from '@lumenflow/core/wu-consistency-checker';
import { validateWU } from '@lumenflow/core/wu-schema';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
import { hasManualTests, isDocsOrProcessType } from '@lumenflow/core/wu-type-helpers';
import type { TestsLike } from '@lumenflow/core/wu-type-helpers';
import { detectFixableIssues, applyFixes, formatIssues } from '@lumenflow/core/wu-yaml-fixer';
import { getConfig } from '@lumenflow/core/config';
import { MICRO_WORKTREE_OPERATIONS, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';

const PREFIX = LOG_PREFIX.CLAIM;

type ClaimWUDoc = Record<string, unknown> & {
  id?: string;
  status?: string;
  type?: string;
  tests?: TestsLike;
  claimed_mode?: string;
  code_paths?: string[];
};

type ClaimValidationArgs = {
  lane?: string;
  fix?: boolean;
  force?: boolean;
  forceOverlap?: boolean;
  reason?: string;
  allowIncomplete?: boolean;
};

type FixableIssueList = ReturnType<typeof detectFixableIssues>;

type BranchOnlyCheckResult = {
  hasBranchOnly: boolean;
  existingWU: string | null;
};

type LaneOccupancyResult = {
  free: boolean;
  occupiedBy: string | null;
  error: string | null;
  inProgressWUs?: string[];
  wipLimit?: number;
  currentCount?: number;
};

type OrphanConsistencyReport = Parameters<typeof repairWUInconsistency>[0];

type OrphanCheckResult = {
  valid: boolean;
  orphans: string[];
  reports?: OrphanConsistencyReport[];
};

type OverlapConflict = {
  wuid: string;
  overlaps: string[];
};

type OverlapCheckResult = {
  conflicts: OverlapConflict[];
  hasBlocker: boolean;
};

export function resolveClaimStatus(status: unknown) {
  return resolveWUStatus(status, WU_STATUS.READY);
}

/**
 * Pre-flight validation: Check WU file exists and is valid BEFORE UnsafeAny git operations
 * Prevents zombie worktrees when WU YAML is missing or malformed
 */
export function preflightValidateWU(WU_PATH: string, id: string): ClaimWUDoc {
  // Check file exists

  if (!existsSync(WU_PATH)) {
    die(
      `WU file not found: ${WU_PATH}\n\n` +
        `Cannot claim a WU that doesn't exist.\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane <lane> --title "..."\n` +
        `  2. Check if the WU ID is correct\n` +
        `  3. Check if the WU file was moved or deleted`,
    );
  }

  // Parse and validate YAML structure

  const text = readFileSync(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  let doc: ClaimWUDoc | null;
  try {
    doc = parseYAML(text);
  } catch (e) {
    die(
      `Failed to parse WU YAML ${WU_PATH}\n\n` +
        `YAML parsing error: ${getErrorMessage(e)}\n\n` +
        `Fix the YAML syntax errors before claiming.`,
    );
  }

  // Validate ID matches
  if (!doc || doc.id !== id) {
    die(
      `WU YAML id mismatch in ${WU_PATH}\n\n` +
        `Expected: ${id}\n` +
        `Found: ${doc?.id || 'missing'}\n\n` +
        `Fix the id field in the WU YAML before claiming.`,
    );
  }

  // Validate state transition is allowed
  const currentStatus = resolveClaimStatus(doc.status);
  try {
    assertTransition(currentStatus, WU_STATUS.IN_PROGRESS, id);
  } catch (error) {
    die(
      `Cannot claim ${id} - invalid state transition\n\n` +
        `Current status: ${currentStatus}\n` +
        `Attempted transition: ${currentStatus} → in_progress\n\n` +
        `Reason: ${getErrorMessage(error)}`,
    );
  }

  return doc;
}

/**
 * WU-1361: Validate YAML schema at claim time
 *
 * Validates WU YAML against Zod schema AFTER git pull.
 * Detects fixable issues BEFORE schema validation (so --fix can run even if schema fails).
 * Returns fixable issues for application in worktree (WU-1361 fix).
 *
 * @param {string} WU_PATH - Path to WU YAML file
 * @param {object} doc - Parsed WU YAML data
 * @param {object} args - CLI arguments
 * @param {boolean} args.fix - If true, issues will be fixed in worktree
 * @returns {Array} Array of fixable issues to apply in worktree
 */
export function validateYAMLSchema(
  WU_PATH: string,
  doc: ClaimWUDoc,
  args: Pick<ClaimValidationArgs, 'fix'>,
): FixableIssueList {
  // WU-1361: Detect fixable issues BEFORE schema validation
  // This allows --fix to work even when schema would fail
  const fixableIssues = detectFixableIssues(doc);

  if (fixableIssues.length > 0) {
    if (args.fix) {
      // WU-1425: Apply fixes to in-memory doc so validation passes
      // Note: This does NOT modify the file on disk - only the in-memory object
      // The actual file fix happens when the doc is written to the worktree
      applyFixes(doc, fixableIssues);
      console.log(
        `${PREFIX} Detected ${fixableIssues.length} fixable YAML issue(s) (will fix in worktree):`,
      );
      console.log(formatIssues(fixableIssues));
    } else {
      // Report issues and suggest --fix
      console.warn(`${PREFIX} Detected ${fixableIssues.length} fixable YAML issue(s):`);
      console.warn(formatIssues(fixableIssues));
      console.warn(`${PREFIX} Run with --fix to auto-repair these issues.`);
      // Continue - Zod validation will provide the detailed error
    }
  }

  // Now run Zod schema validation
  const schemaResult = validateWU(doc);
  if (!schemaResult.success) {
    const issueList = schemaResult.error.issues
      .map((i: ZodIssue) => {
        const pathText = i.path.map(String).join('.');
        return `  - ${pathText}: ${i.message}`;
      })
      .join(STRING_LITERALS.NEWLINE);

    const tip =
      fixableIssues.length > 0 ? 'Tip: Run with --fix to auto-repair common issues.\n' : '';
    die(
      `WU YAML schema validation failed for ${WU_PATH}:\n\n${issueList}\n\nFix these issues before claiming.\n${tip}`,
    );
  }

  // WU-1361: Return fixable issues for application in worktree
  return args.fix ? fixableIssues : [];
}

/**
 * WU-1508: Enforce tests.manual at claim time for non-doc/process WUs.
 * This is non-bypassable (independent of --allow-incomplete) to fail early.
 */
export function validateManualTestsForClaim(
  doc: ClaimWUDoc,
  id: string,
): { valid: true } | { valid: false; error: string } {
  if (isDocsOrProcessType(doc?.type)) {
    return { valid: true };
  }

  if (hasManualTests(doc?.tests)) {
    return { valid: true };
  }

  return {
    valid: false,
    error:
      `${id}: Missing required tests.manual for non-documentation WU.\n` +
      `Add at least one manual verification step under tests.manual before claiming.`,
  };
}

/**
 * Handle orphan WU check and auto-repair (WU-1276)
 * WU-1426: Commits repair changes to avoid dirty working tree blocking claim
 * WU-1437: Use pushOnly micro-worktree to keep local main pristine
 */
export async function handleOrphanCheck(lane: string, id: string): Promise<void> {
  const orphanCheck = (await checkLaneForOrphanDoneWU(lane, id)) as OrphanCheckResult;
  if (orphanCheck.valid) return;

  // Try auto-repair for single orphan
  if (orphanCheck.orphans.length === 1) {
    const orphanId = orphanCheck.orphans[0];
    console.log(`${PREFIX} Auto-repairing orphan: ${orphanId}`);

    // WU-1437: Use micro-worktree with pushOnly to keep main pristine
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.ORPHAN_REPAIR,
      id: orphanId,
      logPrefix: PREFIX,
      pushOnly: true,
      execute: async ({ worktreePath }) => {
        // Run repair inside micro-worktree using projectRoot option
        const report = orphanCheck.reports?.[0];
        if (!report) {
          throw createError(
            ErrorCodes.ORPHAN_WU_ERROR,
            `Lane ${lane} has orphan done WU: ${orphanId} with missing report`,
          );
        }

        const repairResult = await repairWUInconsistency(report, {
          projectRoot: worktreePath,
        });

        if (repairResult.failed > 0) {
          throw createError(
            ErrorCodes.REPAIR_FAILED,
            `Lane ${lane} has orphan done WU: ${orphanId}\n` +
              `Auto-repair failed. Fix manually with: pnpm wu:repair --id ${orphanId}`,
          );
        }

        if (repairResult.repaired === 0) {
          // Nothing to repair - return empty result
          return { commitMessage: null, files: [] } as unknown as {
            commitMessage: string;
            files: string[];
          };
        }

        // Return files for commit
        // WU-1740: Include wu-events.jsonl to persist state store events
        return {
          commitMessage: `chore(repair): auto-repair orphan ${orphanId.toLowerCase()}`,
          files: [
            WU_PATHS.BACKLOG(),
            WU_PATHS.STATUS(),
            WU_PATHS.STAMP(orphanId),
            LUMENFLOW_PATHS.WU_EVENTS,
          ],
        };
      },
    });

    console.log(`${PREFIX} Auto-repair successful`);
    return;
  }

  die(
    `Lane ${lane} has ${orphanCheck.orphans.length} orphan done WUs: ${orphanCheck.orphans.join(', ')}\n` +
      `Fix with: pnpm wu:repair --id <WU-ID> for each, or pnpm wu:repair --all`,
  );
}

/**
 * Validate lane format with user-friendly error messages
 */
export function validateLaneFormatWithError(lane: string): void {
  try {
    validateLaneFormat(lane);
  } catch (error) {
    die(
      `Invalid lane format: ${getErrorMessage(error)}\n\n` +
        `Valid formats:\n` +
        `  - Parent-only: "Operations", "Intelligence", "Experience", etc.\n` +
        `  - Sub-lane: "Operations: Tooling", "Intelligence: Prompts", etc.\n\n` +
        `Format rules:\n` +
        `  - Single colon with EXACTLY one space after (e.g., "Parent: Subdomain")\n` +
        `  - No spaces before colon\n` +
        `  - No multiple colons\n\n` +
        `See workspace.yaml software_delivery.lanes.definitions for valid parent lanes.`,
    );
  }
}

/**
 * Handle lane occupancy check and enforce WIP limit policy
 *
 * WU-1016: Updated to support configurable WIP limits per lane.
 * The WIP limit is read from workspace.yaml software_delivery and defaults to 1.
 */
export function handleLaneOccupancy(
  laneCheck: LaneOccupancyResult,
  lane: string,
  id: string,
  force?: boolean,
): void {
  if (laneCheck.free) return;

  if (laneCheck.error) {
    die(`Lane check failed: ${laneCheck.error}`);
  }

  if (!laneCheck.occupiedBy) return;

  // WU-1016: Include WIP limit info in messages
  const wipLimit = laneCheck.wipLimit ?? 1;
  const currentCount = laneCheck.currentCount ?? 0;
  const inProgressList = laneCheck.inProgressWUs?.join(', ') || laneCheck.occupiedBy;

  if (force) {
    console.warn(
      `${PREFIX} ⚠️  WARNING: Lane "${lane}" has ${currentCount}/${wipLimit} WUs in progress`,
    );
    console.warn(`${PREFIX} ⚠️  In progress: ${inProgressList}`);
    console.warn(`${PREFIX} ⚠️  Forcing WIP limit override. Risk of worktree collision!`);
    console.warn(`${PREFIX} ⚠️  Use only for P0 emergencies or manual recovery.`);
    return;
  }

  die(
    `Lane "${lane}" is at WIP limit (${currentCount}/${wipLimit}).\n\n` +
      `In progress: ${inProgressList}\n\n` +
      `LumenFlow enforces WIP limits per lane to maintain focus.\n` +
      `Current limit for "${lane}": ${wipLimit} ` +
      `(configure in workspace.yaml software_delivery.lanes.definitions)\n\n` +
      `Options:\n` +
      `  1. Wait for a WU to complete or block\n` +
      `  2. Choose a different lane\n` +
      `  3. Increase wip_limit in workspace.yaml software_delivery.lanes.definitions\n` +
      `  4. Use --force to override (P0 emergencies only)\n\n` +
      // WU-1311: Use config-based status path
      `To check lane status: grep "${STATUS_SECTIONS.IN_PROGRESS}" ${getConfig().directories.statusPath}`,
  );
}

/**
 * Handle code path overlap detection (WU-901)
 */
export function handleCodePathOverlap(
  WU_PATH: string,
  STATUS_PATH: string,
  id: string,
  args: Pick<ClaimValidationArgs, 'forceOverlap' | 'reason'>,
): void {
  if (!existsSync(WU_PATH)) return;

  const wuContent = readFileSync(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const wuDoc = parseYAML(wuContent) as ClaimWUDoc | null;
  const codePaths = Array.isArray(wuDoc?.code_paths) ? wuDoc.code_paths : [];

  if (codePaths.length === 0) return;

  const overlapCheck = detectConflicts(STATUS_PATH, codePaths, id) as OverlapCheckResult;

  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    step: 'overlap_check',
    conflicts_count: overlapCheck.conflicts.length,
    forced: args.forceOverlap || false,
  });

  if (overlapCheck.hasBlocker && !args.forceOverlap) {
    const conflictList = overlapCheck.conflicts
      .map((c: OverlapConflict) => {
        const displayedOverlaps = c.overlaps.slice(0, 3).join(', ');
        const remainingCount = c.overlaps.length - 3;
        const suffix = remainingCount > 0 ? ` (+${remainingCount} more)` : '';
        return `  - ${c.wuid}: ${displayedOverlaps}${suffix}`;
      })
      .join(STRING_LITERALS.NEWLINE);

    // WU-1311: Use config-based status path in error message
    die(
      `Code path overlap detected with in-progress WUs:\n\n${conflictList}\n\n` +
        `Merge conflicts are guaranteed if both WUs proceed.\n\n` +
        `Options:\n` +
        `  1. Wait for conflicting WU(s) to complete\n` +
        `  2. Coordinate with agent working on conflicting WU\n` +
        `  3. Use --force-overlap --reason "..." (emits telemetry for audit)\n\n` +
        `To check WU status: grep "${STATUS_SECTIONS.IN_PROGRESS}" ${getConfig().directories.statusPath}`,
    );
  }

  if (args.forceOverlap) {
    if (!args.reason) {
      die('--force-overlap requires --reason "explanation" for audit trail');
    }
    emitWUFlowEvent({
      script: 'wu-claim',
      wu_id: id,
      event: 'overlap_forced',
      reason: args.reason,
      conflicts: overlapCheck.conflicts.map((c: OverlapConflict) => ({
        wuid: c.wuid,
        files: c.overlaps,
      })),
    });
    console.warn(`${PREFIX} ⚠️  WARNING: Overlap forced with reason: ${args.reason}`);
  }
}

/**
 * Validate branch-only mode can be used
 */
export async function validateBranchOnlyMode(STATUS_PATH: string, id: string): Promise<void> {
  const branchOnlyCheck = await checkExistingBranchOnlyWU(STATUS_PATH, id);
  if (branchOnlyCheck.hasBranchOnly) {
    die(
      `Branch-Only mode does not support parallel WUs.\n\n` +
        `Another Branch-Only WU is already in progress: ${branchOnlyCheck.existingWU}\n\n` +
        `Options:\n` +
        `  1. Complete ${branchOnlyCheck.existingWU} first (pnpm wu:done --id ${branchOnlyCheck.existingWU})\n` +
        `  2. Block ${branchOnlyCheck.existingWU} (pnpm wu:block --id ${branchOnlyCheck.existingWU} --reason "...")\n` +
        `  3. Use Worktree mode instead (omit --branch-only flag)\n\n` +
        `Branch-Only mode works in the main checkout and cannot isolate parallel WUs.`,
    );
  }

  // Ensure working directory is clean for Branch-Only mode
  const status = await getGitForCwd().getStatus();
  if (status) {
    die(
      `Branch-Only mode requires a clean working directory.\n\n` +
        `Uncommitted changes detected:\n${status}\n\n` +
        `Options:\n` +
        `  1. Commit or stash your changes\n` +
        `  2. Use Worktree mode instead (omit --branch-only flag for isolated workspace)`,
    );
  }
}

/**
 * Check if there's already a Branch-Only WU in progress
 * Branch-Only mode doesn't support parallel WUs (only one WU at a time in main checkout)
 * @param {string} statusPath - Path to status.md
 * @param {string} currentWU - Current WU ID being claimed
 * @returns {Promise<{hasBranchOnly: boolean, existingWU: string|null}>}
 */
async function checkExistingBranchOnlyWU(
  statusPath: string,
  currentWU: string,
): Promise<BranchOnlyCheckResult> {
  // Check file exists

  try {
    await access(statusPath);
  } catch {
    return { hasBranchOnly: false, existingWU: null };
  }

  // Read file

  const content = await readFile(statusPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split(STRING_LITERALS.NEWLINE);

  // Find "In Progress" section
  const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === '## in progress');
  if (startIdx === -1) return { hasBranchOnly: false, existingWU: null };

  let endIdx = lines.slice(startIdx + 1).findIndex((l) => l.startsWith('## '));
  if (endIdx === -1) endIdx = lines.length - startIdx - 1;
  else endIdx = startIdx + 1 + endIdx;

  // Extract WU IDs from In Progress section
  // Use RegExp.exec for sonarjs/prefer-regexp-exec compliance
  const wuPattern = /\[?(WU-\d+)/i;
  const inProgressWUs = lines
    .slice(startIdx + 1, endIdx)
    .map((line: string) => {
      const match = wuPattern.exec(line);
      return match ? match[1].toUpperCase() : null;
    })
    .filter((wuid): wuid is string => Boolean(wuid))
    .filter((wuid: string) => wuid !== currentWU); // exclude the WU we're claiming

  // Check each in-progress WU for claimed_mode: branch-only
  for (const wuid of inProgressWUs) {
    const wuPath = WU_PATHS.WU(wuid);
    // Check file exists

    try {
      await access(wuPath);
    } catch {
      continue; // File doesn't exist, skip
    }

    try {
      // Read file

      const text = await readFile(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
      const doc = parseYAML(text) as ClaimWUDoc | null;
      if (doc && doc.claimed_mode === CLAIMED_MODES.BRANCH_ONLY) {
        return { hasBranchOnly: true, existingWU: wuid };
      }
    } catch {
      // ignore parse errors
    }
  }

  return { hasBranchOnly: false, existingWU: null };
}

/**
 * Run all pre-flight validations on the WU.
 * Called from main() after git fetch/pull but before lane lock acquisition.
 *
 * Returns the validated doc and fixable issues for worktree application.
 */
export async function runPreflightValidations(
  args: ClaimValidationArgs,
  id: string,
  WU_PATH: string,
  STATUS_PATH: string,
): Promise<{ doc: ClaimWUDoc; fixableIssues: FixableIssueList }> {
  // PRE-FLIGHT VALIDATION (on post-pull data)
  const doc = preflightValidateWU(WU_PATH, id);
  const manualTestsCheck = validateManualTestsForClaim(doc, id);
  if (manualTestsCheck.valid === false) {
    die(manualTestsCheck.error);
  }

  const lane = args.lane;
  if (!lane) {
    die('Missing required --lane argument for wu:claim.');
  }

  await handleOrphanCheck(lane, id);
  validateLaneFormatWithError(lane);

  // WU-1187: Check for WIP justification when WIP > 1 (soft enforcement - warning only)
  const wipJustificationCheck = checkWipJustification(lane);
  if (wipJustificationCheck.warning) {
    console.warn(`${PREFIX} ${wipJustificationCheck.warning}`);
  }

  // WU-1372: Lane-to-code_paths consistency check (advisory only, never blocks)
  const laneValidation = validateLaneCodePaths(doc, lane);
  logLaneValidationWarnings(laneValidation, PREFIX);

  // WU-1361: YAML schema validation at claim time
  // Returns fixable issues for application in worktree (not on main)
  const fixableIssues = validateYAMLSchema(WU_PATH, doc, args);

  // WU-1362: Spec completeness validation (fail-fast before expensive operations)
  // Two-tier validation: Schema errors (above) are never bypassable; spec completeness is bypassable
  const specResult = validateSpecCompleteness(doc, id);
  if (!specResult.valid) {
    const errorList = specResult.errors
      .map((e: string) => `  - ${e}`)
      .join(STRING_LITERALS.NEWLINE);
    if (args.allowIncomplete) {
      console.warn(`${PREFIX} ⚠️  Spec completeness warnings (bypassed with --allow-incomplete):`);
      console.warn(errorList);
      console.warn(`${PREFIX} Proceeding with incomplete spec. Fix before wu:done.`);
    } else {
      die(
        `Spec completeness validation failed for ${WU_PATH}:\n\n${errorList}\n\n` +
          `Fix these issues before claiming, or use --allow-incomplete to bypass.\n` +
          `Note: Schema errors (placeholders, invalid structure) cannot be bypassed.`,
      );
    }
  }

  // Check lane occupancy (WIP=1 per sub-lane)
  const laneCheck = checkLaneFree(STATUS_PATH, lane, id);
  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    lane,
    step: 'lane_check',
    occupied: !laneCheck.free,
    occupiedBy: laneCheck.occupiedBy,
  });
  handleLaneOccupancy(laneCheck, lane, id, args.force);

  return { doc, fixableIssues };
}
