#!/usr/bin/env node

/**
 * Initiative Remove WU Command (WU-1328)
 *
 * Unlinks a WU from an initiative bidirectionally:
 * 1. Removes `initiative: INIT-NNN` field from WU YAML
 * 2. Removes WU ID from initiative `wus: []` array
 *
 * Uses micro-worktree isolation for atomic operations.
 *
 * Usage:
 *   pnpm initiative:remove-wu --initiative INIT-001 --wu WU-123
 *
 * Features:
 * - Validates both WU and initiative exist before modifying
 * - Idempotent: no error if link does not exist
 * - Handles partial state gracefully (WU has initiative but not in initiative's wus list)
 * - Atomic: both files updated in single commit
 *
 * Context: WU-1328 (initial implementation)
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import {
  INIT_PATTERNS,
  INIT_COMMIT_FORMATS,
  INIT_LOG_PREFIX,
} from '@lumenflow/initiatives/constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { PATTERNS } from '@lumenflow/core/wu-constants';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import {
  withMicroWorktree,
  isRetryExhaustionError as coreIsRetryExhaustionError,
  formatRetryExhaustionError as coreFormatRetryExhaustionError,
} from '@lumenflow/core/micro-worktree';
import { parseYAML, readWU, stringifyYAML, writeWU } from '@lumenflow/core/wu-yaml';
import { readInitiative } from '@lumenflow/initiatives/yaml';

/** Log prefix for console output */
export const LOG_PREFIX = INIT_LOG_PREFIX.REMOVE_WU;

/** Micro-worktree operation name */
export const OPERATION_NAME = 'initiative-remove-wu';

/**
 * WU-1621: operation-level push retry override for initiative:remove-wu.
 */
export const INITIATIVE_REMOVE_WU_PUSH_RETRY_OVERRIDE = {
  retries: 8,
  min_delay_ms: 300,
  max_delay_ms: 4000,
};

/**
 * WU-1333/WU-1336: Check if an error is a retry exhaustion error
 *
 * Detects when micro-worktree push retries have been exhausted.
 * Delegates to the shared helper from @lumenflow/core.
 *
 * @param {Error} error - Error to check
 * @returns {boolean} True if this is a retry exhaustion error
 */
export function isRetryExhaustionError(error: Error): boolean {
  return coreIsRetryExhaustionError(error);
}

/**
 * WU-1333/WU-1336: Format retry exhaustion error with actionable next steps
 *
 * When push retries are exhausted, provides clear guidance on how to proceed.
 * Delegates to the shared helper from @lumenflow/core with command-specific options.
 *
 * @param {Error} error - The retry exhaustion error
 * @param {string} wuId - WU ID being unlinked
 * @param {string} initId - Initiative ID being unlinked from
 * @returns {string} Formatted error message with next steps
 */
export function formatRetryExhaustionError(error: Error, wuId: string, initId: string): string {
  return coreFormatRetryExhaustionError(error, {
    command: `pnpm initiative:remove-wu --wu ${wuId} --initiative ${initId}`,
  });
}

/**
 * Validate Initiative ID format
 * @param {string} id - Initiative ID to validate
 */
export function validateInitIdFormat(id: string): void {
  if (!INIT_PATTERNS.INIT_ID.test(id)) {
    die(
      `Invalid Initiative ID format: "${id}"\n\n` +
        `Expected format: INIT-<number> or INIT-<NAME> (e.g., INIT-001, INIT-TOOLING)`,
    );
  }
}

/**
 * Validate WU ID format
 * @param {string} id - WU ID to validate
 */
export function validateWuIdFormat(id: string): void {
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU ID format: "${id}"\n\nExpected format: WU-<number> (e.g., WU-123)`);
  }
}

/**
 * Check if WU exists
 * @param {string} wuId - WU ID to check
 * @returns {object} WU document
 */
export function checkWUExists(wuId: string): ReturnType<typeof readWU> {
  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    die(`WU not found: ${wuId}\n\nFile does not exist: ${wuPath}`);
  }
  return readWU(wuPath, wuId);
}

/**
 * Check if Initiative exists
 * @param {string} initId - Initiative ID to check
 * @returns {object} Initiative document
 */
export function checkInitiativeExists(initId: string): ReturnType<typeof readInitiative> {
  const initPath = INIT_PATHS.INITIATIVE(initId);
  if (!existsSync(initPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initPath}`);
  }
  return readInitiative(initPath, initId);
}

/**
 * Check if WU is currently linked to the initiative
 * @param {object} wuDoc - WU document
 * @param {object} initDoc - Initiative document
 * @param {string} wuId - WU ID
 * @param {string} initId - Initiative ID
 * @returns {boolean} True if WU is linked to the initiative (both sides)
 */
export function checkWUIsLinked(
  wuDoc: { initiative?: string },
  initDoc: { wus?: string[] },
  wuId: string,
  initId: string,
): boolean {
  const wuHasInit = wuDoc.initiative === initId;
  const initHasWu = Array.isArray(initDoc.wus) && initDoc.wus.includes(wuId);
  return wuHasInit && initHasWu;
}

/**
 * Update WU YAML in micro-worktree (remove initiative field)
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} wuId - WU ID
 * @param {string} initId - Initiative ID to remove
 * @returns {boolean} True if changes were made
 */
export function updateWUInWorktree(worktreePath: string, wuId: string, initId: string): boolean {
  const wuRelPath = WU_PATHS.WU(wuId);
  const wuAbsPath = join(worktreePath, wuRelPath);

  const doc = readWU(wuAbsPath, wuId);

  // Skip if no initiative field or different initiative (idempotent)
  if (!doc.initiative || doc.initiative !== initId) {
    return false;
  }

  // Remove initiative field
  delete doc.initiative;
  writeWU(wuAbsPath, doc);

  console.log(`${LOG_PREFIX} Removed initiative: ${initId} from ${wuId}`);
  return true;
}

/**
 * Update Initiative YAML in micro-worktree (remove WU from wus list)
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} initId - Initiative ID
 * @param {string} wuId - WU ID to remove
 * @returns {boolean} True if changes were made
 */
export function updateInitiativeInWorktree(
  worktreePath: string,
  initId: string,
  wuId: string,
): boolean {
  const initRelPath = INIT_PATHS.INITIATIVE(initId);
  const initAbsPath = join(worktreePath, initRelPath);

  // Read raw YAML to preserve unknown fields like related_plan.
  const rawText = readFileSync(initAbsPath, { encoding: 'utf-8' });
  const parsed = parseYAML(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die(`Invalid initiative payload for ${initId}: YAML root must be an object`);
  }

  const doc = parsed as Record<string, unknown>;
  if (doc.id !== initId) {
    die(`Initiative YAML id mismatch. Expected ${initId}, found ${String(doc.id)}`);
  }

  const relatedPlan = doc.related_plan;
  if (relatedPlan !== undefined && typeof relatedPlan !== 'string') {
    die(`Invalid related_plan in ${initId}: expected string when present`);
  }

  const wus = doc.wus;
  if (wus === undefined) {
    return false;
  }
  if (!Array.isArray(wus) || !wus.every((id) => typeof id === 'string')) {
    die(`Invalid initiative.wus in ${initId}: expected array of WU IDs`);
  }

  // Skip if no wus array or WU not in list (idempotent)
  if (!wus.includes(wuId)) {
    return false;
  }

  // Remove WU from list
  doc.wus = wus.filter((id: string) => id !== wuId);
  writeFileSync(initAbsPath, stringifyYAML(doc), { encoding: 'utf-8' });

  console.log(`${LOG_PREFIX} Removed ${wuId} from ${initId} wus list`);
  return true;
}

export async function main(): Promise<void> {
  const args = createWUParser({
    name: 'initiative-remove-wu',
    description: 'Unlink a WU from an initiative bidirectionally',
    options: [WU_OPTIONS.initiative, WU_OPTIONS.wu],
    required: ['initiative', 'wu'],
    allowPositionalId: false,
  });

  // Normalize args
  const wuId = args.wu as string;
  const initId = args.initiative as string;

  console.log(`${LOG_PREFIX} Unlinking ${wuId} from ${initId}...`);

  // Pre-flight validation
  validateInitIdFormat(initId);
  validateWuIdFormat(wuId);

  const wuDoc = checkWUExists(wuId);
  const initDoc = checkInitiativeExists(initId);

  // Check if link exists - if not, report success (idempotent)
  const wuHasInit = wuDoc.initiative === initId;
  const initHasWu = Array.isArray(initDoc.wus) && initDoc.wus.includes(wuId);

  if (!wuHasInit && !initHasWu) {
    console.log(`${LOG_PREFIX} Link does not exist (idempotent - no changes needed)`);
    console.log(`\n${LOG_PREFIX} ${wuId} is not linked to ${initId}`);
    return;
  }

  // Ensure on main branch
  await ensureOnMain(getGitForCwd());

  // Transaction: micro-worktree isolation
  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id: `${wuId}-${initId}`.toLowerCase(),
      logPrefix: LOG_PREFIX,
      pushOnly: true,
      pushRetryOverride: INITIATIVE_REMOVE_WU_PUSH_RETRY_OVERRIDE,
      execute: async ({ worktreePath }) => {
        const files: string[] = [];

        // Update WU YAML (remove initiative field)
        const wuChanged = updateWUInWorktree(worktreePath, wuId, initId);
        if (wuChanged) {
          files.push(WU_PATHS.WU(wuId));
        }

        // Update Initiative YAML (remove WU from wus list)
        const initChanged = updateInitiativeInWorktree(worktreePath, initId, wuId);
        if (initChanged) {
          files.push(INIT_PATHS.INITIATIVE(initId));
        }

        // If no changes, this is idempotent (race condition handling)
        if (files.length === 0) {
          console.log(`${LOG_PREFIX} No changes detected (concurrent unlink operation)`);
          // Still need to return something for the commit
          return {
            commitMessage: INIT_COMMIT_FORMATS.UNLINK_WU(wuId, initId),
            files: [WU_PATHS.WU(wuId), INIT_PATHS.INITIATIVE(initId)],
          };
        }

        return {
          commitMessage: INIT_COMMIT_FORMATS.UNLINK_WU(wuId, initId),
          files,
        };
      },
    });

    console.log(`\n${LOG_PREFIX} Transaction complete!`);
    console.log(`\nLink Removed:`);
    console.log(`  WU:         ${wuId}`);
    console.log(`  Initiative: ${initId}`);
    console.log(`\nNext steps:`);
    console.log(`  - View initiative status: pnpm initiative:status ${initId}`);
    console.log(`  - View WU: cat ${WU_PATHS.WU(wuId)}`);
  } catch (error) {
    if (error instanceof Error && isRetryExhaustionError(error)) {
      die(formatRetryExhaustionError(error, wuId, initId));
    }
    die(
      `Transaction failed: ${(error as Error).message}\n\n` +
        `Micro-worktree cleanup was attempted automatically.\n` +
        `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`,
    );
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
