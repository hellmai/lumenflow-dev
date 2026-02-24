#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Initiative Add WU Command (WU-1389)
 *
 * Links an existing WU to an initiative bidirectionally:
 * 1. Adds `initiative: INIT-NNN` field to WU YAML
 * 2. Adds WU ID to initiative `wus: []` array
 *
 * Uses micro-worktree isolation for atomic operations.
 *
 * Usage:
 *   pnpm initiative:add-wu --initiative INIT-001 --wu WU-123
 *   pnpm initiative:add-wu --initiative INIT-001 --wu WU-123 --wu WU-124
 *
 * Features:
 * - Validates both WU and initiative exist before modifying
 * - Idempotent: no error if link already exists
 * - Errors if WU is already linked to a different initiative
 * - Atomic: both files updated in single commit
 *
 * Context: WU-1389 (initial implementation)
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
import type { WUDocBase } from '@lumenflow/core/wu-doc-types';
import { readInitiative } from '@lumenflow/initiatives/yaml';
import { validateSingleWU } from '@lumenflow/core/validators/wu-tasks';

/** Log prefix for console output */
const LOG_PREFIX = INIT_LOG_PREFIX.ADD_WU;

/** Micro-worktree operation name */
const OPERATION_NAME = 'initiative-add-wu';

type WUDocLike = Required<Pick<WUDocBase, 'id'>> &
  Pick<WUDocBase, 'initiative'> &
  Record<string, unknown>;

interface InitiativeDocLike extends Record<string, unknown> {
  id: string;
  wus?: string[];
}

interface InitiativeAddWuArgs extends Record<string, unknown> {
  initiative: string;
  wu?: string | string[];
}

/**
 * WU-1459: operation-level push retry override for initiative:add-wu.
 *
 * Rationale:
 * - initiative:add-wu often runs in bursts during orchestration.
 * - pushOnly mode can hit short-term contention on origin/main.
 * - A slightly larger retry/backoff window reduces transient failures.
 */
export const INITIATIVE_ADD_WU_PUSH_RETRY_OVERRIDE = {
  retries: 8,
  min_delay_ms: 300,
  max_delay_ms: 4000,
};

/**
 * Command-local repeatable --wu option for batch linking (WU-1460).
 *
 * We intentionally do not mutate global WU_OPTIONS.wu because many commands
 * depend on single-value semantics.
 */
const REPEATABLE_WU_OPTION = {
  ...WU_OPTIONS.wu,
  description: 'Work Unit ID to link (repeatable, use multiple --wu flags)',
  isRepeatable: true,
};

/**
 * Validation result interface for WU linking (WU-1330)
 */
export interface WULinkValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate WU spec for linking to an initiative (WU-1330)
 *
 * Performs validation including:
 * - Schema validation (required fields, formats) - BLOCKING
 * - Placeholder detection ([PLACEHOLDER] markers) - BLOCKING
 * - Minimum description length (50 chars) - BLOCKING
 * - Acceptance criteria present - BLOCKING
 * - Completeness warnings (notes, spec_refs) - NON-BLOCKING
 *
 * Uses non-strict mode: schema errors block, completeness warnings don't.
 *
 * @param {string} wuId - WU ID to validate
 * @returns {WULinkValidationResult} Validation result with errors and warnings
 */
export function validateWUForLinking(wuId: string): WULinkValidationResult {
  const wuPath = WU_PATHS.WU(wuId);

  // Check if file exists first
  if (!existsSync(wuPath)) {
    return {
      valid: false,
      errors: [`WU file not found: ${wuPath}`],
      warnings: [],
    };
  }

  // Use the core validator with non-strict mode
  // Schema errors (required fields, format, placeholders) -> block
  // Completeness warnings (notes, spec_refs) -> don't block
  const result = validateSingleWU(wuPath, { strict: false });

  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  };
}

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
 * @param {string} wuId - WU ID being linked
 * @param {string} initId - Initiative ID being linked to
 * @returns {string} Formatted error message with next steps
 */
export function formatRetryExhaustionError(error: Error, wuId: string, initId: string): string {
  return formatRetryExhaustionErrorForMany(error, [wuId], initId);
}

/**
 * Format retry exhaustion error with actionable next steps for one or more WUs.
 *
 * @param {Error} error - The retry exhaustion error
 * @param {string[]|string} wuIds - WU IDs being linked
 * @param {string} initId - Initiative ID being linked to
 * @returns {string} Formatted error message with next steps
 */
export function formatRetryExhaustionErrorForMany(
  error: Error,
  wuIds: string[] | string,
  initId: string,
): string {
  const normalizedWuIds = normalizeWuIds(wuIds);
  const wuFlags = normalizedWuIds.map((id) => `--wu ${id}`).join(' ');

  return coreFormatRetryExhaustionError(error, {
    command: `pnpm initiative:add-wu ${wuFlags} --initiative ${initId}`,
  });
}

/**
 * Format validation errors for display to user (WU-1330)
 *
 * Creates a human-readable error message with all validation issues.
 *
 * @param {string} wuId - WU ID that failed validation
 * @param {string[]} errors - Array of error messages
 * @returns {string} Formatted error message
 */
export function formatValidationErrors(wuId: string, errors: string[]): string {
  const errorList = errors.map((e) => `  - ${e}`).join('\n');
  return (
    `WU ${wuId} failed validation:\n\n${errorList}\n\n` +
    `Fix the WU spec before linking to an initiative:\n` +
    `  pnpm wu:edit --id ${wuId} ...\n\n` +
    `Or validate the WU:\n` +
    `  pnpm wu:validate --id ${wuId}`
  );
}

/**
 * Check if WU exists and is valid for linking (WU-1330)
 *
 * Combines existence check with strict validation.
 * Throws with aggregated errors if validation fails.
 *
 * @param {string} wuId - WU ID to check and validate
 * @returns {object} WU document if validation passes
 * @throws {Error} If WU doesn't exist or validation fails
 */
export function checkWUExistsAndValidate(wuId: string): WUDocLike {
  const wuPath = WU_PATHS.WU(wuId);

  // Check existence
  if (!existsSync(wuPath)) {
    die(`WU not found: ${wuId}\n\nFile does not exist: ${wuPath}`);
  }

  // Validate WU
  const validation = validateWUForLinking(wuId);
  if (!validation.valid) {
    die(formatValidationErrors(wuId, validation.errors));
  }

  // Return the document if validation passes
  return readWU(wuPath, wuId) as WUDocLike;
}

/**
 * Validate Initiative ID format
 * @param {string} id - Initiative ID to validate
 */
function validateInitIdFormat(id: string): void {
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
function validateWuIdFormat(id: string): void {
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU ID format: "${id}"\n\nExpected format: WU-<number> (e.g., WU-123)`);
  }
}

/**
 * Check if Initiative exists
 * @param {string} initId - Initiative ID to check
 * @returns {object} Initiative document
 */
function checkInitiativeExists(initId: string): InitiativeDocLike {
  const initPath = INIT_PATHS.INITIATIVE(initId);
  if (!existsSync(initPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initPath}`);
  }
  return readInitiative(initPath, initId) as InitiativeDocLike;
}

/**
 * Check for conflicting initiative link
 * @param {object} wuDoc - WU document
 * @param {string} targetInitId - Target initiative ID
 */
function checkConflictingLink(wuDoc: WUDocLike, targetInitId: string): void {
  const currentInit = wuDoc.initiative;
  if (currentInit && currentInit !== targetInitId) {
    die(
      `WU ${wuDoc.id} is already linked to ${currentInit}\n\n` +
        `Cannot link to ${targetInitId}. Remove the existing link first.\n` +
        `Current initiative field: ${currentInit}`,
    );
  }
}

/**
 * Normalize WU argument(s) into an ordered, de-duplicated list.
 *
 * @param {string|string[]|undefined} wuArg - Parsed --wu argument(s)
 * @returns {string[]} Ordered unique WU IDs
 */
export function normalizeWuIds(wuArg: string | string[] | undefined): string[] {
  if (!wuArg) return [];

  const values = Array.isArray(wuArg) ? wuArg : [wuArg];
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

/**
 * Validate there are no conflicting initiative links across WUs.
 *
 * @param {Array<object>} wuDocs - WU docs to validate
 * @param {string} targetInitId - Initiative being linked
 */
export function validateNoConflictingLinks(wuDocs: WUDocLike[], targetInitId: string): void {
  for (const wuDoc of wuDocs) {
    checkConflictingLink(wuDoc, targetInitId);
  }
}

/**
 * Check if link already exists (idempotent check)
 * @param {object} wuDoc - WU document
 * @param {object} initDoc - Initiative document
 * @param {string} wuId - WU ID
 * @param {string} initId - Initiative ID
 * @returns {boolean} True if link already exists
 */
function isAlreadyLinked(
  wuDoc: WUDocLike,
  initDoc: InitiativeDocLike,
  wuId: string,
  initId: string,
): boolean {
  const wuHasInit = wuDoc.initiative === initId;
  const initHasWu = Array.isArray(initDoc.wus) && initDoc.wus.includes(wuId);
  return wuHasInit && initHasWu;
}

/**
 * Update WU YAML in micro-worktree
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} wuId - WU ID
 * @param {string} initId - Initiative ID
 * @returns {boolean} True if changes were made
 */
function updateWUInWorktree(worktreePath: string, wuId: string, initId: string): boolean {
  const wuRelPath = WU_PATHS.WU(wuId);
  const wuAbsPath = join(worktreePath, wuRelPath);

  const doc = readWU(wuAbsPath, wuId);

  // Skip if already linked
  if (doc.initiative === initId) {
    return false;
  }

  // Update initiative field
  doc.initiative = initId;
  writeWU(wuAbsPath, doc);

  console.log(`${LOG_PREFIX} ✅ Added initiative: ${initId} to ${wuId}`);
  return true;
}

/**
 * Update Initiative YAML in micro-worktree
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} initId - Initiative ID
 * @param {string} wuId - WU ID to add
 * @returns {boolean} True if changes were made
 */
function updateInitiativeInWorktree(
  worktreePath: string,
  initId: string,
  wuIds: string[],
): string[] {
  const initRelPath = INIT_PATHS.INITIATIVE(initId);
  const initAbsPath = join(worktreePath, initRelPath);

  // Read raw YAML so we preserve unknown fields like related_plan.
  const rawText = readFileSync(initAbsPath, { encoding: 'utf-8' });
  const doc = parseYAML(rawText);
  if (!doc || typeof doc !== 'object' || doc.id !== initId) {
    die(`Initiative YAML id mismatch. Expected ${initId}, found ${doc?.id}`);
  }

  // Initialize wus array if not present
  if (!Array.isArray(doc.wus)) {
    doc.wus = [];
  }

  const wusList = doc.wus as string[];
  const addedWuIds = [];
  for (const wuId of wuIds) {
    if (wusList.includes(wuId)) {
      continue;
    }
    wusList.push(wuId);
    addedWuIds.push(wuId);
  }

  if (addedWuIds.length === 0) {
    return [];
  }

  const out = stringifyYAML(doc);
  writeFileSync(initAbsPath, out, { encoding: 'utf-8' });
  console.log(`${LOG_PREFIX} ✅ Added ${addedWuIds.join(', ')} to ${initId} wus list`);
  return addedWuIds;
}

/**
 * Build micro-worktree options for initiative:add-wu transaction.
 *
 * Exported for testability (WU-1459).
 *
 * @param {string} wuId - WU ID
 * @param {string} initId - Initiative ID
 * @returns {object} withMicroWorktree options
 */
export function buildAddWuMicroWorktreeOptions(
  wuArg: string | string[] | undefined,
  initId: string,
) {
  const wuIds = normalizeWuIds(wuArg);
  if (wuIds.length === 0) {
    die(
      `At least one --wu value is required.\n\nUsage: pnpm initiative:add-wu --initiative ${initId} --wu WU-123`,
    );
  }

  const idPrefix = wuIds.length === 1 ? wuIds[0] : `${wuIds[0]}-${wuIds.length}wus`;

  return {
    operation: OPERATION_NAME,
    id: `${idPrefix}-${initId}`.toLowerCase(),
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    pushRetryOverride: INITIATIVE_ADD_WU_PUSH_RETRY_OVERRIDE,
    execute: async ({ worktreePath }: { worktreePath: string }) => {
      const files = [];

      // Update WU YAML
      for (const wuId of wuIds) {
        const wuChanged = updateWUInWorktree(worktreePath, wuId, initId);
        if (wuChanged) {
          files.push(WU_PATHS.WU(wuId));
        }
      }

      // Update Initiative YAML
      const initChangedWuIds = updateInitiativeInWorktree(worktreePath, initId, wuIds);
      if (initChangedWuIds.length > 0) {
        files.push(INIT_PATHS.INITIATIVE(initId));
      }

      // If no changes, this is idempotent (race condition handling)
      if (files.length === 0) {
        console.log(`${LOG_PREFIX} ⚠️  No changes detected (concurrent link operation)`);
        // Still need to return something for the commit
        return {
          commitMessage:
            wuIds.length === 1
              ? INIT_COMMIT_FORMATS.LINK_WU(wuIds[0], initId)
              : `initiative(${initId}): link ${wuIds.length} WUs`,
          files: [...wuIds.map((id) => WU_PATHS.WU(id)), INIT_PATHS.INITIATIVE(initId)],
        };
      }

      return {
        commitMessage:
          wuIds.length === 1
            ? INIT_COMMIT_FORMATS.LINK_WU(wuIds[0], initId)
            : `initiative(${initId}): link ${wuIds.length} WUs`,
        files,
      };
    },
  };
}

export async function main() {
  const args = createWUParser({
    name: 'initiative-add-wu',
    description: 'Link one or more WUs to an initiative bidirectionally',
    options: [WU_OPTIONS.initiative, REPEATABLE_WU_OPTION],
    required: ['initiative'],
    allowPositionalId: false,
  }) as InitiativeAddWuArgs;

  // Normalize args
  const wuIds = normalizeWuIds(args.wu);
  const initId = args.initiative;

  if (wuIds.length === 0) {
    die(
      `Missing required --wu.\n\nUsage: pnpm initiative:add-wu --initiative ${initId} --wu WU-123 [--wu WU-124 ...]`,
    );
  }

  console.log(`${LOG_PREFIX} Linking ${wuIds.join(', ')} to ${initId}...`);

  // Pre-flight validation: ID formats
  validateInitIdFormat(initId);
  wuIds.forEach(validateWuIdFormat);

  // WU-1330: Validate WU spec before linking
  // This ensures only valid, complete WUs can be linked to initiatives
  const wuDocs = wuIds.map((wuId) => checkWUExistsAndValidate(wuId));
  const initDoc = checkInitiativeExists(initId);

  // Check for conflicting links
  validateNoConflictingLinks(wuDocs, initId);

  // Idempotent check
  const alreadyLinkedWuIds = wuDocs
    .filter((wuDoc) => isAlreadyLinked(wuDoc, initDoc, wuDoc.id, initId))
    .map((wuDoc) => wuDoc.id);

  if (alreadyLinkedWuIds.length === wuIds.length) {
    console.log(`${LOG_PREFIX} ✅ Link already exists (idempotent - no changes needed)`);
    console.log(`\n${LOG_PREFIX} ${wuIds.join(', ')} already linked to ${initId}`);
    return;
  }

  // Ensure on main branch
  await ensureOnMain(getGitForCwd());

  // Transaction: micro-worktree isolation
  try {
    await withMicroWorktree(buildAddWuMicroWorktreeOptions(wuIds, initId));

    console.log(`\n${LOG_PREFIX} ✅ Transaction complete!`);
    console.log(`\nLink Created:`);
    console.log(`  WUs:        ${wuIds.join(', ')}`);
    console.log(`  Initiative: ${initId}`);
    if (alreadyLinkedWuIds.length > 0) {
      console.log(`  Skipped:    ${alreadyLinkedWuIds.join(', ')} (already linked)`);
    }
    console.log(`\nNext steps:`);
    console.log(`  - View initiative status: pnpm initiative:status ${initId}`);
    console.log(`  - View WUs under: ${WU_PATHS.WU('WU-XXXX').replace('WU-XXXX', '')}`);
  } catch (error) {
    if (error instanceof Error && isRetryExhaustionError(error)) {
      die(formatRetryExhaustionErrorForMany(error, wuIds, initId));
    }

    const message = error instanceof Error ? error.message : String(error);
    die(
      `Transaction failed: ${message}\n\n` +
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
