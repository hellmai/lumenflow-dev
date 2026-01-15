#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename */
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
 *
 * Features:
 * - Validates both WU and initiative exist before modifying
 * - Idempotent: no error if link already exists
 * - Errors if WU is already linked to a different initiative
 * - Atomic: both files updated in single commit
 *
 * Context: WU-1389 (initial implementation)
 */

import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { INIT_PATHS } from '@lumenflow/initiatives/dist/initiative-paths.js';
import {
  INIT_PATTERNS,
  INIT_COMMIT_FORMATS,
  INIT_LOG_PREFIX,
} from '@lumenflow/initiatives/dist/initiative-constants.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { PATTERNS } from '@lumenflow/core/dist/wu-constants.js';
import { ensureOnMain } from '@lumenflow/core/dist/wu-helpers.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
import { readWU, writeWU } from '@lumenflow/core/dist/wu-yaml.js';
import { readInitiative, writeInitiative } from '@lumenflow/initiatives/dist/initiative-yaml.js';

/** Log prefix for console output */
const LOG_PREFIX = INIT_LOG_PREFIX.ADD_WU;

/** Micro-worktree operation name */
const OPERATION_NAME = 'initiative-add-wu';

/**
 * Validate Initiative ID format
 * @param {string} id - Initiative ID to validate
 */
function validateInitIdFormat(id) {
  if (!INIT_PATTERNS.INIT_ID.test(id)) {
    die(
      `Invalid Initiative ID format: "${id}"\n\n` +
        `Expected format: INIT-<number> or INIT-<NAME> (e.g., INIT-001, INIT-TOOLING)`
    );
  }
}

/**
 * Validate WU ID format
 * @param {string} id - WU ID to validate
 */
function validateWuIdFormat(id) {
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU ID format: "${id}"\n\nExpected format: WU-<number> (e.g., WU-123)`);
  }
}

/**
 * Check if WU exists
 * @param {string} wuId - WU ID to check
 * @returns {object} WU document
 */
function checkWUExists(wuId) {
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
function checkInitiativeExists(initId) {
  const initPath = INIT_PATHS.INITIATIVE(initId);
  if (!existsSync(initPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initPath}`);
  }
  return readInitiative(initPath, initId);
}

/**
 * Check for conflicting initiative link
 * @param {object} wuDoc - WU document
 * @param {string} targetInitId - Target initiative ID
 */
function checkConflictingLink(wuDoc, targetInitId) {
  const currentInit = wuDoc.initiative;
  if (currentInit && currentInit !== targetInitId) {
    die(
      `WU ${wuDoc.id} is already linked to ${currentInit}\n\n` +
        `Cannot link to ${targetInitId}. Remove the existing link first.\n` +
        `Current initiative field: ${currentInit}`
    );
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
function isAlreadyLinked(wuDoc, initDoc, wuId, initId) {
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
function updateWUInWorktree(worktreePath, wuId, initId) {
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
function updateInitiativeInWorktree(worktreePath, initId, wuId) {
  const initRelPath = INIT_PATHS.INITIATIVE(initId);
  const initAbsPath = join(worktreePath, initRelPath);

  const doc = readInitiative(initAbsPath, initId);

  // Initialize wus array if not present
  if (!Array.isArray(doc.wus)) {
    doc.wus = [];
  }

  // Skip if already in list
  if (doc.wus.includes(wuId)) {
    return false;
  }

  // Add WU to list
  doc.wus.push(wuId);
  writeInitiative(initAbsPath, doc);

  console.log(`${LOG_PREFIX} ✅ Added ${wuId} to ${initId} wus list`);
  return true;
}

async function main() {
  const args = createWUParser({
    name: 'initiative-add-wu',
    description: 'Link a WU to an initiative bidirectionally',
    options: [WU_OPTIONS.initiative, WU_OPTIONS.wu],
    required: ['initiative', 'wu'],
    allowPositionalId: false,
  });

  // Normalize args
  const wuId = args.wu;
  const initId = args.initiative;

  console.log(`${LOG_PREFIX} Linking ${wuId} to ${initId}...`);

  // Pre-flight validation
  validateInitIdFormat(initId);
  validateWuIdFormat(wuId);

  const wuDoc = checkWUExists(wuId);
  const initDoc = checkInitiativeExists(initId);

  // Check for conflicting links
  checkConflictingLink(wuDoc, initId);

  // Idempotent check
  if (isAlreadyLinked(wuDoc, initDoc, wuId, initId)) {
    console.log(`${LOG_PREFIX} ✅ Link already exists (idempotent - no changes needed)`);
    console.log(`\n${LOG_PREFIX} ${wuId} is already linked to ${initId}`);
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
      execute: async ({ worktreePath }) => {
        const files = [];

        // Update WU YAML
        const wuChanged = updateWUInWorktree(worktreePath, wuId, initId);
        if (wuChanged) {
          files.push(WU_PATHS.WU(wuId));
        }

        // Update Initiative YAML
        const initChanged = updateInitiativeInWorktree(worktreePath, initId, wuId);
        if (initChanged) {
          files.push(INIT_PATHS.INITIATIVE(initId));
        }

        // If no changes, this is idempotent (race condition handling)
        if (files.length === 0) {
          console.log(`${LOG_PREFIX} ⚠️  No changes detected (concurrent link operation)`);
          // Still need to return something for the commit
          return {
            commitMessage: INIT_COMMIT_FORMATS.LINK_WU(wuId, initId),
            files: [WU_PATHS.WU(wuId), INIT_PATHS.INITIATIVE(initId)],
          };
        }

        return {
          commitMessage: INIT_COMMIT_FORMATS.LINK_WU(wuId, initId),
          files,
        };
      },
    });

    console.log(`\n${LOG_PREFIX} ✅ Transaction complete!`);
    console.log(`\nLink Created:`);
    console.log(`  WU:         ${wuId}`);
    console.log(`  Initiative: ${initId}`);
    console.log(`\nNext steps:`);
    console.log(`  - View initiative status: pnpm initiative:status ${initId}`);
    console.log(`  - View WU: cat ${WU_PATHS.WU(wuId)}`);
  } catch (error) {
    die(
      `Transaction failed: ${error.message}\n\n` +
        `Micro-worktree cleanup was attempted automatically.\n` +
        `If issue persists, check for orphaned branches: git branch | grep tmp/${OPERATION_NAME}`
    );
  }
}

// Guard main() for testability
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
