#!/usr/bin/env node
/**
 * WU Edit Helper
 *
 * Race-safe WU spec editing using micro-worktree isolation (WU-1274).
 *
 * Enables editing WU YAML files without claiming the WU, perfect for:
 * - Filling in placeholder content after wu:create
 * - Updating description/acceptance criteria
 * - Adding code_paths, notes, or other spec fields
 *
 * Uses the same micro-worktree pattern as wu:create (WU-1262):
 * 1) Validate inputs (WU exists, status is ready)
 * 2) Ensure main is clean and up-to-date with origin
 * 3) Create temp branch WITHOUT switching (main checkout stays on main)
 * 4) Create micro-worktree in /tmp pointing to temp branch
 * 5) Apply edits in micro-worktree
 * 6) Commit, ff-only merge, push
 * 7) Cleanup temp branch and micro-worktree
 *
 * Usage:
 *   pnpm wu:edit --id WU-123 --spec-file /path/to/spec.yaml
 *   pnpm wu:edit --id WU-123 --description "New description text"
 *   pnpm wu:edit --id WU-123 --acceptance "Criterion 1" --acceptance "Criterion 2"
 *
 * Part of WU-1274: Add wu:edit command for spec-only changes
 * @see {@link packages/@lumenflow/cli/src/lib/micro-worktree.ts} - Shared micro-worktree logic
 */

import { getGitForCwd, createGitForPath } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// WU-1352: Use centralized YAML helper instead of raw js-yaml (Emergency fix Session 2)
// WU-1620: Import readWU for readiness summary
import { parseYAML, stringifyYAML, readWU } from '@lumenflow/core/wu-yaml';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS, getStateStoreDirFromBacklog } from '@lumenflow/core/wu-paths';
import { generateBacklog } from '@lumenflow/core/backlog-generator';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import {
  FILE_SYSTEM,
  MICRO_WORKTREE_OPERATIONS,
  LOG_PREFIX,
  COMMIT_FORMATS,
  WU_STATUS,
  CLAIMED_MODES,
  getLaneBranch,
  PKG_MANAGER,
  SCRIPTS,
  PRETTIER_FLAGS,
  READINESS_UI,
  // WU-1039: Import exposure values for validation (Library-First, no magic strings)
  WU_EXPOSURE_VALUES,
} from '@lumenflow/core/wu-constants';
// WU-1593: Use centralized validateWUIDFormat (DRY)
import { ensureOnMain, ensureMainUpToDate, validateWUIDFormat } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { validateLaneFormat } from '@lumenflow/core/lane-checker';
// WU-1620: Import validateSpecCompleteness for readiness summary
// WU-1806: Import detectCurrentWorktree for worktree path resolution
import {
  defaultWorktreeFrom,
  validateSpecCompleteness,
  detectCurrentWorktree,
} from '@lumenflow/core/wu-done-validators';
import { validateReadyWU } from '@lumenflow/core/wu-schema';
import { execSync } from 'node:child_process';
// WU-1442: Import date normalization to fix date corruption from js-yaml
import { normalizeToDateString } from '@lumenflow/core/date-utils';
// WU-1929: Import initiative-related modules for bidirectional initiative updates
import { INIT_PATTERNS } from '@lumenflow/initiatives/constants';
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import { readInitiative, writeInitiative } from '@lumenflow/initiatives/yaml';
// WU-2004: Import schema normalization for legacy WU formats
import { normalizeWUSchema } from '@lumenflow/core/wu-schema-normalization';
// WU-2253: Import WU spec linter for acceptance/code_paths validation
import { lintWUSpec, formatLintErrors } from '@lumenflow/core/wu-lint';
// WU-1329: Import path existence validators for strict validation
import {
  validateCodePathsExistence,
  validateTestPathsExistence,
} from '@lumenflow/core/wu-preflight-validators';
import { runCLI } from './cli-entry-point.js';

const PREFIX = LOG_PREFIX.EDIT;

/**
 * WU-1039: Validate which edits are allowed on done WUs
 *
 * Done WUs only allow metadata reassignment: initiative, phase, and exposure.
 * All other edits are blocked to preserve WU immutability after completion.
 *
 * @param opts - Parsed CLI options
 * @returns { valid: boolean, disallowedEdits: string[] }
 */
export function validateDoneWUEdits(opts: Record<string, unknown>): {
  valid: boolean;
  disallowedEdits: string[];
} {
  const disallowedEdits: string[] = [];

  // Check for disallowed edits on done WUs
  if (opts.specFile) disallowedEdits.push('--spec-file');
  if (opts.description) disallowedEdits.push('--description');
  if (opts.acceptance && Array.isArray(opts.acceptance) && opts.acceptance.length > 0) {
    disallowedEdits.push('--acceptance');
  }
  if (opts.notes) disallowedEdits.push('--notes');
  if (opts.codePaths && Array.isArray(opts.codePaths) && opts.codePaths.length > 0) {
    disallowedEdits.push('--code-paths');
  }
  if (opts.risks && Array.isArray(opts.risks) && opts.risks.length > 0) {
    disallowedEdits.push('--risks');
  }
  if (opts.lane) disallowedEdits.push('--lane');
  if (opts.type) disallowedEdits.push('--type');
  if (opts.priority) disallowedEdits.push('--priority');
  if (
    opts.testPathsManual &&
    Array.isArray(opts.testPathsManual) &&
    opts.testPathsManual.length > 0
  ) {
    disallowedEdits.push('--test-paths-manual');
  }
  if (opts.testPathsUnit && Array.isArray(opts.testPathsUnit) && opts.testPathsUnit.length > 0) {
    disallowedEdits.push('--test-paths-unit');
  }
  if (opts.testPathsE2e && Array.isArray(opts.testPathsE2e) && opts.testPathsE2e.length > 0) {
    disallowedEdits.push('--test-paths-e2e');
  }

  return {
    valid: disallowedEdits.length === 0,
    disallowedEdits,
  };
}

/**
 * WU-1039: Validate exposure value against schema
 *
 * Uses WU_EXPOSURE_VALUES from core constants (Library-First, no magic strings).
 *
 * @param exposure - Exposure value to validate
 * @returns { valid: boolean, error?: string }
 */
export function validateExposureValue(exposure: string): {
  valid: boolean;
  error?: string;
} {
  // WU_EXPOSURE_VALUES is readonly array, need to cast for includes check
  const validValues = WU_EXPOSURE_VALUES as readonly string[];
  if (!validValues.includes(exposure)) {
    return {
      valid: false,
      error: `Invalid exposure value: "${exposure}"\n\nValid values: ${WU_EXPOSURE_VALUES.join(', ')}`,
    };
  }
  return { valid: true };
}

/**
 * WU-1039: Apply exposure edit to WU object
 *
 * Returns a new WU object with updated exposure (immutable pattern).
 *
 * @param wu - Original WU object
 * @param exposure - New exposure value
 * @returns Updated WU object (does not mutate original)
 */
export function applyExposureEdit(
  wu: Record<string, unknown>,
  exposure: string,
): Record<string, unknown> {
  return {
    ...wu,
    exposure,
  };
}

/**
 * Custom options for wu-edit (not in shared WU_OPTIONS)
 */
const EDIT_OPTIONS = {
  specFile: {
    name: 'specFile',
    flags: '--spec-file <path>',
    description: 'Path to YAML file with updated spec content',
  },
  description: {
    name: 'description',
    flags: '--description <text>',
    description: 'New description text (replaces existing)',
  },
  acceptance: {
    name: 'acceptance',
    flags: '--acceptance <criterion>',
    description:
      'Acceptance criterion (repeatable, appends to existing; use --replace-acceptance to overwrite)',
    isRepeatable: true,
  },
  notes: {
    name: 'notes',
    flags: '--notes <text>',
    description: 'Notes text (appends to existing; use --replace-notes to overwrite)',
  },
  // WU-1144: Add explicit replace flags for notes and acceptance
  replaceNotes: {
    name: 'replaceNotes',
    flags: '--replace-notes',
    description: 'Replace existing notes instead of appending',
  },
  replaceAcceptance: {
    name: 'replaceAcceptance',
    flags: '--replace-acceptance',
    description: 'Replace existing acceptance criteria instead of appending',
  },
  codePaths: {
    name: 'codePaths',
    flags: '--code-paths <path>',
    description:
      'Code path (repeatable, appends to existing; use --replace-code-paths to overwrite)',
    isRepeatable: true,
  },
  replaceCodePaths: {
    name: 'replaceCodePaths',
    flags: '--replace-code-paths',
    description: 'Replace existing code_paths instead of appending',
  },
  risks: {
    name: 'risks',
    flags: '--risks <risk>',
    description: 'Risk entry (repeatable, appends to existing; use --replace-risks to overwrite)',
    isRepeatable: true,
  },
  replaceRisks: {
    name: 'replaceRisks',
    flags: '--replace-risks',
    description: 'Replace existing risks instead of appending',
  },
  // WU-1225: Deprecated --append flag (kept for backwards compatibility)
  append: {
    name: 'append',
    flags: '--append',
    description: '[DEPRECATED] Arrays now append by default. Use --replace-* flags to replace.',
  },
  // WU-1456: Add lane reassignment support
  lane: {
    name: 'lane',
    flags: '--lane <lane>',
    description: 'New lane assignment (e.g., "Operations: Tooling")',
  },
  // WU-1620: Add type and priority edit support
  type: {
    name: 'type',
    flags: '--type <type>',
    description: 'New WU type (feature, bug, refactor, documentation)',
  },
  priority: {
    name: 'priority',
    flags: '--priority <priority>',
    description: 'New priority (P0, P1, P2, P3)',
  },
  // WU-1929: Add initiative and phase edit support
  initiative: {
    name: 'initiative',
    flags: '--initiative <initId>',
    description:
      'Initiative ID (e.g., INIT-001). Updates WU and initiative wus: arrays bidirectionally.',
  },
  phase: {
    name: 'phase',
    flags: '--phase <number>',
    description: 'Phase number within initiative (e.g., 1, 2)',
  },
  // WU-2564: Add blocked_by and dependencies edit support
  blockedBy: {
    name: 'blockedBy',
    flags: '--blocked-by <wuIds>',
    description:
      'Comma-separated WU IDs that block this WU (appends to existing; use --replace-blocked-by to overwrite)',
  },
  replaceBlockedBy: {
    name: 'replaceBlockedBy',
    flags: '--replace-blocked-by',
    description: 'Replace existing blocked_by instead of appending',
  },
  addDep: {
    name: 'addDep',
    flags: '--add-dep <wuIds>',
    description:
      'Comma-separated WU IDs to add to dependencies array (appends to existing; use --replace-dependencies to overwrite)',
  },
  replaceDependencies: {
    name: 'replaceDependencies',
    flags: '--replace-dependencies',
    description: 'Replace existing dependencies instead of appending',
  },
};

/**
 * WU-1929: Update initiative wus: arrays bidirectionally
 *
 * When a WU's initiative field changes, this function:
 * 1. Removes the WU ID from the old initiative's wus: array (if exists)
 * 2. Adds the WU ID to the new initiative's wus: array
 *
 * @param {string} worktreePath - Path to the worktree (for file operations)
 * @param {string} wuId - WU ID being updated
 * @param {string|undefined} oldInitId - Previous initiative ID (may be undefined)
 * @param {string} newInitId - New initiative ID
 * @returns {Array<string>} Array of relative file paths that were modified
 */

function updateInitiativeWusArrays(worktreePath, wuId, oldInitId, newInitId) {
  const modifiedFiles = [];

  // Remove from old initiative if it exists and is different from new
  if (oldInitId && oldInitId !== newInitId) {
    const oldInitPath = join(worktreePath, INIT_PATHS.INITIATIVE(oldInitId));

    if (existsSync(oldInitPath)) {
      try {
        const oldInit = readInitiative(oldInitPath, oldInitId);
        if (Array.isArray(oldInit.wus) && oldInit.wus.includes(wuId)) {
          oldInit.wus = oldInit.wus.filter((id) => id !== wuId);
          writeInitiative(oldInitPath, oldInit);
          modifiedFiles.push(INIT_PATHS.INITIATIVE(oldInitId));
          console.log(`${PREFIX} ✅ Removed ${wuId} from ${oldInitId} wus: array`);
        }
      } catch (err) {
        // Old initiative may not exist or be invalid - log warning but continue
        console.warn(`${PREFIX} ⚠️  Could not update old initiative ${oldInitId}: ${err.message}`);
      }
    }
  }

  // Add to new initiative
  const newInitPath = join(worktreePath, INIT_PATHS.INITIATIVE(newInitId));

  if (existsSync(newInitPath)) {
    try {
      const newInit = readInitiative(newInitPath, newInitId);
      if (!Array.isArray(newInit.wus)) {
        newInit.wus = [];
      }
      if (!newInit.wus.includes(wuId)) {
        newInit.wus.push(wuId);
        writeInitiative(newInitPath, newInit);
        modifiedFiles.push(INIT_PATHS.INITIATIVE(newInitId));
        console.log(`${PREFIX} ✅ Added ${wuId} to ${newInitId} wus: array`);
      }
    } catch (err) {
      die(`Failed to update new initiative ${newInitId}: ${err.message}`);
    }
  }

  return modifiedFiles;
}

/**
 * WU-1929: Validate initiative ID format
 * @param {string} initId - Initiative ID to validate
 */
function validateInitiativeFormat(initId) {
  if (!INIT_PATTERNS.INIT_ID.test(initId)) {
    die(
      `Invalid Initiative ID format: "${initId}"\n\n` +
        `Expected format: INIT-<number> or INIT-<NAME> (e.g., INIT-001, INIT-TOOLING)`,
    );
  }
}

/**
 * WU-1929: Validate initiative exists on disk
 * @param {string} initId - Initiative ID to check
 * @returns {string} Path to initiative file
 */
function validateInitiativeExists(initId) {
  const initPath = INIT_PATHS.INITIATIVE(initId);

  if (!existsSync(initPath)) {
    die(`Initiative not found: ${initId}\n\nFile does not exist: ${initPath}`);
  }
  return initPath;
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  return createWUParser({
    name: 'wu-edit',
    description: 'Edit WU spec files with micro-worktree isolation',
    options: [
      WU_OPTIONS.id,
      EDIT_OPTIONS.specFile,
      EDIT_OPTIONS.description,
      EDIT_OPTIONS.acceptance,
      EDIT_OPTIONS.notes,
      // WU-1144: Add explicit replace flags for notes and acceptance
      EDIT_OPTIONS.replaceNotes,
      EDIT_OPTIONS.replaceAcceptance,
      EDIT_OPTIONS.codePaths,
      EDIT_OPTIONS.replaceCodePaths,
      EDIT_OPTIONS.risks,
      EDIT_OPTIONS.replaceRisks,
      EDIT_OPTIONS.append,
      // WU-1390: Add test path flags
      WU_OPTIONS.testPathsManual,
      WU_OPTIONS.testPathsUnit,
      WU_OPTIONS.testPathsE2e,
      // WU-1456: Add lane reassignment
      EDIT_OPTIONS.lane,
      // WU-1620: Add type and priority
      EDIT_OPTIONS.type,
      EDIT_OPTIONS.priority,
      // WU-1929: Add initiative and phase
      EDIT_OPTIONS.initiative,
      EDIT_OPTIONS.phase,
      // WU-2564: Add blocked_by and dependencies
      EDIT_OPTIONS.blockedBy,
      EDIT_OPTIONS.replaceBlockedBy,
      EDIT_OPTIONS.addDep,
      EDIT_OPTIONS.replaceDependencies,
      // WU-1039: Add exposure for done WU metadata updates
      WU_OPTIONS.exposure,
      // WU-1329: Strict validation is default, --no-strict bypasses
      WU_OPTIONS.noStrict,
    ],
    required: ['id'],
    allowPositionalId: true,
  });
}

/**
 * WU-1620: Display readiness summary after edit
 *
 * Shows whether WU is ready for wu:claim based on spec completeness.
 * Non-blocking - just informational to help agents understand what's missing.
 *
 * @param {string} id - WU ID
 */
function displayReadinessSummary(id: string) {
  try {
    const wuPath = WU_PATHS.WU(id);
    const wuDoc = readWU(wuPath, id);

    const { valid, errors } = validateSpecCompleteness(wuDoc, id);

    const {
      BOX,
      BOX_WIDTH,
      MESSAGES,
      ERROR_MAX_LENGTH,
      ERROR_TRUNCATE_LENGTH,
      TRUNCATION_SUFFIX,
      PADDING,
    } = READINESS_UI;

    console.log(`\n${BOX.TOP_LEFT}${BOX.HORIZONTAL.repeat(BOX_WIDTH)}${BOX.TOP_RIGHT}`);
    if (valid) {
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.READY_YES}${''.padEnd(PADDING.READY_YES)}${BOX.VERTICAL}`,
      );
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      const claimCmd = `Run: pnpm wu:claim --id ${id}`;
      console.log(
        `${BOX.VERTICAL} ${claimCmd}${''.padEnd(BOX_WIDTH - claimCmd.length - 1)}${BOX.VERTICAL}`,
      );
    } else {
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.READY_NO}${''.padEnd(PADDING.READY_NO)}${BOX.VERTICAL}`,
      );
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.MISSING_HEADER}${''.padEnd(PADDING.MISSING_HEADER)}${BOX.VERTICAL}`,
      );
      for (const error of errors) {
        // Truncate long error messages to fit box
        const truncated =
          error.length > ERROR_MAX_LENGTH
            ? `${error.substring(0, ERROR_TRUNCATE_LENGTH)}${TRUNCATION_SUFFIX}`
            : error;
        console.log(
          `${BOX.VERTICAL}   ${MESSAGES.BULLET} ${truncated}${''.padEnd(Math.max(0, PADDING.ERROR_BULLET - truncated.length))}${BOX.VERTICAL}`,
        );
      }
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      const editCmd = `Run: pnpm wu:edit --id ${id} --help`;
      console.log(
        `${BOX.VERTICAL} ${editCmd}${''.padEnd(BOX_WIDTH - editCmd.length - 1)}${BOX.VERTICAL}`,
      );
    }
    console.log(`${BOX.BOTTOM_LEFT}${BOX.HORIZONTAL.repeat(BOX_WIDTH)}${BOX.BOTTOM_RIGHT}`);
  } catch (err) {
    // Non-blocking - if validation fails, just warn
    console.warn(`${PREFIX} ⚠️  Could not validate readiness: ${err.message}`);
  }
}

/**
 * Edit modes for WU editing
 * WU-1365: Worktree-aware editing support
 */
const EDIT_MODE = {
  /** Ready WUs: Use micro-worktree on main (existing behavior) */
  MICRO_WORKTREE: 'micro_worktree',
  /** In-progress worktree WUs: Apply edits directly in active worktree (WU-1365) */
  WORKTREE: 'worktree',
};

/**
 * Normalize date fields in WU object to prevent date corruption
 *
 * WU-1442: js-yaml parses unquoted YYYY-MM-DD dates as Date objects.
 * When yaml.dump() serializes them back, it outputs ISO timestamps.
 * This function normalizes Date objects back to YYYY-MM-DD strings.
 *
 * @param {object} wu - WU object from yaml.load()
 * @returns {object} WU object with normalized date fields
 */
function normalizeWUDates(wu) {
  if (wu.created !== undefined) {
    wu.created = normalizeToDateString(wu.created);
  }
  return wu;
}

/**
 * Check WU exists and determine edit mode
 * WU-1365: Now supports worktree-aware editing for in_progress WUs
 *
 * @param {string} id - WU ID
 * @returns {{ wu: object, editMode: string }} WU object and edit mode
 */
function validateWUEditable(id) {
  const wuPath = WU_PATHS.WU(id);

  if (!existsSync(wuPath)) {
    die(`WU ${id} not found at ${wuPath}\n\nEnsure the WU exists and you're in the repo root.`);
  }

  const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  const wu = parseYAML(content);

  // WU-1929: Done WUs allow initiative/phase edits only (metadata reassignment)
  // WU-1365: Other fields on done WUs are immutable
  if (wu.status === WU_STATUS.DONE) {
    // Return done status - main() will validate allowed fields
    return { wu, editMode: EDIT_MODE.MICRO_WORKTREE, isDone: true };
  }

  // Handle in_progress WUs based on claimed_mode (WU-1365)
  if (wu.status === WU_STATUS.IN_PROGRESS) {
    const claimedMode = wu.claimed_mode || CLAIMED_MODES.WORKTREE; // Default to worktree for legacy WUs

    // Block branch-only and branch-pr WUs with actionable guidance
    // WU-1492: branch-pr WUs have no worktree, same as branch-only
    if (claimedMode === CLAIMED_MODES.BRANCH_ONLY || claimedMode === CLAIMED_MODES.BRANCH_PR) {
      die(
        `Cannot edit ${claimedMode} WU ${id} via wu:edit.\n\n` +
          `WUs claimed with claimed_mode='${claimedMode}' cannot be edited via wu:edit.\n` +
          `To modify the spec, edit the file directly on the lane branch and commit.`,
      );
    }

    // Worktree mode WUs can be edited (WU-1365)
    return { wu, editMode: EDIT_MODE.WORKTREE, isDone: false };
  }

  // Ready WUs use micro-worktree (existing behavior)
  if (wu.status === WU_STATUS.READY) {
    return { wu, editMode: EDIT_MODE.MICRO_WORKTREE, isDone: false };
  }

  // Block other statuses (blocked, etc.)
  die(
    `Cannot edit WU ${id}: status is '${wu.status}'.\n\n` +
      `Only WUs in '${WU_STATUS.READY}' or '${WU_STATUS.IN_PROGRESS}' (worktree mode) can be edited.`,
  );
}

/**
 * Validate worktree exists on disk
 * WU-1365: Required check before worktree editing
 *
 * @param {string} worktreePath - Absolute path to worktree
 * @param {string} id - WU ID (for error messages)
 */
function validateWorktreeExists(worktreePath, id) {
  if (!existsSync(worktreePath)) {
    die(
      `Cannot edit WU ${id}: worktree path missing from disk.\n\n` +
        `Expected worktree at: ${worktreePath}\n\n` +
        `The worktree may have been removed or the path is incorrect.\n` +
        `If the worktree was accidentally deleted, you may need to re-claim the WU.`,
    );
  }
}

/**
 * Validate worktree has no uncommitted changes
 * WU-1365: Required check to prevent edit conflicts
 *
 * @param {string} worktreePath - Absolute path to worktree
 * @param {string} id - WU ID (for error messages)
 */
async function validateWorktreeClean(worktreePath, id) {
  try {
    const gitAdapter = createGitForPath(worktreePath);
    const status = (await gitAdapter.raw(['status', '--porcelain'])).trim();

    if (status !== '') {
      die(
        `Cannot edit WU ${id}: worktree has uncommitted changes.\n\n` +
          `Uncommitted changes in ${worktreePath}:\n${status}\n\n` +
          `Commit or discard your changes before editing the WU spec:\n` +
          `  cd ${worktreePath}\n` +
          `  git add . && git commit -m "wip: save progress"\n\n` +
          `Then retry wu:edit.`,
      );
    }
  } catch (err) {
    die(
      `Cannot edit WU ${id}: failed to check worktree status.\n\n` +
        `Error: ${err.message}\n\n` +
        `Worktree path: ${worktreePath}`,
    );
  }
}

/**
 * Validate worktree is on expected lane branch
 * WU-1365: Prevents editing WUs in worktrees with mismatched branches
 *
 * @param {string} worktreePath - Absolute path to worktree
 * @param {string} expectedBranch - Expected branch name (e.g., lane/operations-tooling/wu-1365)
 * @param {string} id - WU ID (for error messages)
 */
async function validateWorktreeBranch(worktreePath, expectedBranch, id) {
  try {
    const gitAdapter = createGitForPath(worktreePath);
    const actualBranch = (await gitAdapter.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

    if (actualBranch !== expectedBranch) {
      die(
        `Cannot edit WU ${id}: worktree branch does not match expected lane branch.\n\n` +
          `Expected branch: ${expectedBranch}\n` +
          `Actual branch:   ${actualBranch}\n\n` +
          `This may indicate a corrupted worktree state.\n` +
          `Verify the worktree is correctly set up for this WU.`,
      );
    }
  } catch (err) {
    die(
      `Cannot edit WU ${id}: failed to check worktree branch.\n\n` +
        `Error: ${err.message}\n\n` +
        `Worktree path: ${worktreePath}`,
    );
  }
}

/**
 * Apply edits directly in an active worktree (WU-1365)
 * Used for in_progress WUs with claimed_mode=worktree
 *
 * @param {object} params - Parameters
 * @param {string} params.worktreePath - Absolute path to worktree
 * @param {string} params.id - WU ID
 * @param {object} params.updatedWU - Updated WU object
 */
async function applyEditsInWorktree({ worktreePath, id, updatedWU }) {
  const wuPath = join(worktreePath, WU_PATHS.WU(id));
  // WU-1442: Normalize dates before dumping to prevent ISO timestamp corruption
  normalizeWUDates(updatedWU);
  // Emergency fix Session 2: Use centralized stringifyYAML helper
  const yamlContent = stringifyYAML(updatedWU);

  writeFileSync(wuPath, yamlContent, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  console.log(`${PREFIX} ✅ Updated ${id}.yaml in worktree`);

  // Format the file
  try {
    execSync(`${PKG_MANAGER} ${SCRIPTS.PRETTIER} ${PRETTIER_FLAGS.WRITE} "${wuPath}"`, {
      cwd: worktreePath,
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
      stdio: 'pipe',
    });
    console.log(`${PREFIX} ✅ Formatted ${id}.yaml`);
  } catch (err) {
    console.warn(`${PREFIX} ⚠️ Could not format file: ${err.message}`);
  }

  // Stage and commit using git adapter (library-first)
  const commitMsg = COMMIT_FORMATS.SPEC_UPDATE(id);
  try {
    const gitAdapter = createGitForPath(worktreePath);
    await gitAdapter.add(wuPath);
    await gitAdapter.commit(commitMsg);
    console.log(`${PREFIX} ✅ Committed: ${commitMsg}`);
  } catch (err) {
    die(
      `Failed to commit edit in worktree.\n\n` +
        `Error: ${err.message}\n\n` +
        `The WU file was updated but could not be committed.\n` +
        `You may need to commit manually in the worktree.`,
    );
  }
}

/**
 * Ensure working tree is clean
 */
async function ensureCleanWorkingTree() {
  const status = await getGitForCwd().getStatus();
  if (status.trim()) {
    die(
      `Working tree is not clean. Cannot edit WU.\n\nUncommitted changes:\n${status}\n\nCommit or stash changes before editing:\n  git add . && git commit -m "..."\n`,
    );
  }
}

/**
 * Merge array values: replace by default, append if --append flag is set (WU-1388)
 * @param {Array} existing - Current array value from WU
 * @param {Array} newValues - New values from CLI
 * @param {boolean} shouldAppend - Whether to append instead of replace
 * @returns {Array} Merged array
 */
function mergeArrayField(existing, newValues, shouldAppend) {
  if (!shouldAppend) {
    return newValues;
  }
  const existingArray = Array.isArray(existing) ? existing : [];
  return [...existingArray, ...newValues];
}

/**
 * WU-1144: Merge string field values with append-by-default behavior
 *
 * Notes and acceptance criteria should append by default (preserving original),
 * with explicit --replace-notes and --replace-acceptance flags for overwrite.
 *
 * @param {string | undefined} existing - Current string value from WU
 * @param {string} newValue - New value from CLI
 * @param {boolean} shouldReplace - Whether to replace instead of append
 * @returns {string} Merged string value
 */
export function mergeStringField(
  existing: string | undefined,
  newValue: string,
  shouldReplace: boolean,
): string {
  // If replace mode or no existing value, just use new value
  if (shouldReplace || !existing || existing.trim() === '') {
    return newValue;
  }
  // Append with double newline separator
  return `${existing}\n\n${newValue}`;
}

/**
 * WU-1594: Ensure wu:edit commits always include regenerated backlog projection.
 *
 * @param {string} id - WU ID
 * @param {string[]} extraFiles - Additional files modified during edit
 * @returns {string[]} Deduplicated list of files for commit
 */
export function getWuEditCommitFiles(id: string, extraFiles: string[] = []): string[] {
  return [...new Set([WU_PATHS.WU(id), ...extraFiles, WU_PATHS.BACKLOG()])];
}

/**
 * WU-1594: Regenerate backlog.md from state store after wu:edit updates.
 *
 * @param {string} backlogPath - Absolute path to backlog.md in micro-worktree
 */
async function regenerateBacklogFromState(backlogPath: string): Promise<void> {
  const stateDir = getStateStoreDirFromBacklog(backlogPath);
  const store = new WUStateStore(stateDir);
  await store.load();
  const content = await generateBacklog(store);
  writeFileSync(backlogPath, content, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
}

/**
 * Load spec file and merge with original WU (preserving id and status)
 * @param {string} specPath - Path to spec file
 * @param {object} originalWU - Original WU object
 * @returns {object} Merged WU object
 */
function loadSpecFile(specPath, originalWU) {
  const resolvedPath = resolve(specPath);

  if (!existsSync(resolvedPath)) {
    die(`Spec file not found: ${resolvedPath}`);
  }

  const specContent = readFileSync(resolvedPath, {
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });
  const newSpec = parseYAML(specContent);

  // Preserve id and status from original (cannot be changed via edit)
  return {
    ...newSpec,
    id: originalWU.id,
    status: originalWU.status,
  };
}

/**
 * Apply edits to WU YAML
 * Returns the updated WU object
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
export function applyEdits(wu, opts) {
  // Full spec replacement from file
  if (opts.specFile) {
    return loadSpecFile(opts.specFile, wu);
  }

  const updated = { ...wu };

  // Field-level updates
  if (opts.description) {
    updated.description = opts.description;
  }

  // WU-1144: Handle --acceptance with append-by-default behavior
  // Appends to existing acceptance criteria unless --replace-acceptance is set
  if (opts.acceptance && opts.acceptance.length > 0) {
    // Invert the logic: append by default, replace with --replace-acceptance
    const shouldAppend = !opts.replaceAcceptance;
    updated.acceptance = mergeArrayField(wu.acceptance, opts.acceptance, shouldAppend);
  }

  // WU-1144: Handle --notes with append-by-default behavior
  // Appends to existing notes unless --replace-notes is set
  if (opts.notes) {
    updated.notes = mergeStringField(wu.notes, opts.notes, opts.replaceNotes ?? false);
  }

  // WU-1456: Handle lane reassignment
  if (opts.lane) {
    validateLaneFormat(opts.lane);
    updated.lane = opts.lane;
  }

  // WU-1620: Handle type and priority updates
  if (opts.type) {
    updated.type = opts.type;
  }
  if (opts.priority) {
    updated.priority = opts.priority;
  }

  // WU-1929: Handle initiative and phase updates
  // Note: Initiative bidirectional updates (initiative wus: arrays) are handled separately
  // in the main function after applyEdits, since they require file I/O
  if (opts.initiative) {
    validateInitiativeFormat(opts.initiative);
    validateInitiativeExists(opts.initiative);
    updated.initiative = opts.initiative;
  }
  if (opts.phase !== undefined && opts.phase !== null) {
    const phaseNum = parseInt(opts.phase, 10);
    if (isNaN(phaseNum) || phaseNum < 1) {
      die(
        `Invalid phase number: "${opts.phase}"\n\nPhase must be a positive integer (e.g., 1, 2, 3)`,
      );
    }
    updated.phase = phaseNum;
  }

  // Handle repeatable --code-paths flags (WU-1225: append by default, replace with --replace-code-paths)
  // WU-1816: Split comma-separated string into array (same pattern as test paths)
  // WU-1870: Fix to split comma-separated values WITHIN array elements (Commander passes ['a,b'] not 'a,b')
  if (opts.codePaths && opts.codePaths.length > 0) {
    const rawCodePaths = opts.codePaths;
    const codePaths = Array.isArray(rawCodePaths)
      ? rawCodePaths
          .flatMap((p) => p.split(','))
          .map((p) => p.trim())
          .filter(Boolean)
      : rawCodePaths
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
    // WU-1225: Invert logic - append by default, replace with --replace-code-paths
    // Also support legacy --append flag for backwards compatibility
    const shouldAppend = !opts.replaceCodePaths || opts.append;
    updated.code_paths = mergeArrayField(wu.code_paths, codePaths, shouldAppend);
  }

  // WU-1225: Handle repeatable --risks flags (append by default, replace with --replace-risks)
  // Split comma-separated values within each entry for consistency with other list fields
  if (opts.risks && opts.risks.length > 0) {
    const rawRisks = opts.risks;
    const risks = Array.isArray(rawRisks)
      ? rawRisks
          .flatMap((risk) => risk.split(','))
          .map((risk) => risk.trim())
          .filter(Boolean)
      : rawRisks
          .split(',')
          .map((risk) => risk.trim())
          .filter(Boolean);
    // WU-1225: Invert logic - append by default
    const shouldAppend = !opts.replaceRisks || opts.append;
    updated.risks = mergeArrayField(wu.risks, risks, shouldAppend);
  }

  // WU-1390: Handle test path flags (DRY refactor)
  // WU-1225: Test paths now append by default (consistent with --acceptance and --code-paths)
  const testPathMappings = [
    { optKey: 'testPathsManual', field: 'manual' },
    { optKey: 'testPathsUnit', field: 'unit' },
    { optKey: 'testPathsE2e', field: 'e2e' },
  ];

  for (const { optKey, field } of testPathMappings) {
    const rawPaths = opts[optKey];
    if (rawPaths && rawPaths.length > 0) {
      // Split comma-separated string into array (options are comma-separated per description)
      // WU-1870: Fix to split comma-separated values WITHIN array elements
      const paths = Array.isArray(rawPaths)
        ? rawPaths
            .flatMap((p) => p.split(','))
            .map((p) => p.trim())
            .filter(Boolean)
        : rawPaths
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
      updated.tests = updated.tests || {};
      // WU-1225: Append by default (no individual replace flags for test paths yet)
      const shouldAppend = true;
      updated.tests[field] = mergeArrayField(wu.tests?.[field], paths, shouldAppend);
    }
  }

  // WU-2564: Handle --blocked-by flag
  // WU-1225: Append by default, replace with --replace-blocked-by
  if (opts.blockedBy) {
    const rawBlockedBy = opts.blockedBy;
    const blockedByIds = rawBlockedBy
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const shouldAppend = !opts.replaceBlockedBy || opts.append;
    updated.blocked_by = mergeArrayField(wu.blocked_by, blockedByIds, shouldAppend);
  }

  // WU-2564: Handle --add-dep flag
  // WU-1225: Append by default, replace with --replace-dependencies
  if (opts.addDep) {
    const rawAddDep = opts.addDep;
    const depIds = rawAddDep
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const shouldAppend = !opts.replaceDependencies || opts.append;
    updated.dependencies = mergeArrayField(wu.dependencies, depIds, shouldAppend);
  }

  // WU-1039: Handle --exposure flag with validation
  if (opts.exposure) {
    const exposureResult = validateExposureValue(opts.exposure);
    if (!exposureResult.valid) {
      die(exposureResult.error);
    }
    updated.exposure = opts.exposure;
  }

  return updated;
}

/**
 * Main entry point
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
async function main() {
  const opts = parseArgs();
  const { id } = opts;

  console.log(`${PREFIX} Starting WU edit for ${id}`);

  // Validate inputs
  validateWUIDFormat(id);
  const { wu: originalWU, editMode, isDone } = validateWUEditable(id);

  // WU-1039: Done WUs allow initiative/phase/exposure edits only (metadata reassignment)
  // Uses validateDoneWUEdits (DRY - centralized validation logic)
  if (isDone) {
    const doneValidation = validateDoneWUEdits(opts);
    if (!doneValidation.valid) {
      die(
        `Cannot edit WU ${id}: WU is done/immutable.\n\n` +
          `Completed WUs only allow initiative/phase/exposure reassignment.\n` +
          `Disallowed edits: ${doneValidation.disallowedEdits.join(', ')}\n\n` +
          `Allowed for done WUs:\n` +
          `  --initiative <initId>     Reassign to different initiative\n` +
          `  --phase <number>          Update phase within initiative\n` +
          `  --exposure <type>         Update exposure level`,
      );
    }
  }

  // Check we have something to edit
  // Note: repeatable options (acceptance, codePaths, testPaths*) default to empty arrays,
  // so we check .length instead of truthiness
  const hasEdits =
    opts.specFile ||
    opts.description ||
    (opts.acceptance && opts.acceptance.length > 0) ||
    opts.notes ||
    (opts.codePaths && opts.codePaths.length > 0) ||
    (opts.risks && opts.risks.length > 0) ||
    // WU-1390: Add test path flags to hasEdits check
    (opts.testPathsManual && opts.testPathsManual.length > 0) ||
    (opts.testPathsUnit && opts.testPathsUnit.length > 0) ||
    (opts.testPathsE2e && opts.testPathsE2e.length > 0) ||
    // WU-1456: Add lane to hasEdits check
    opts.lane ||
    // WU-1620: Add type and priority to hasEdits check
    opts.type ||
    opts.priority ||
    // WU-1929: Add initiative and phase to hasEdits check
    opts.initiative ||
    opts.phase ||
    // WU-2564: Add blocked_by and add_dep to hasEdits check
    opts.blockedBy ||
    opts.addDep ||
    // WU-1039: Add exposure to hasEdits check
    opts.exposure;
  if (!hasEdits) {
    die(
      'No edits specified.\n\n' +
        'Provide one of:\n' +
        '  --spec-file <path>        Replace full spec from YAML file\n' +
        '  --description <text>      Update description field\n' +
        '  --acceptance <text>       Append acceptance criteria (repeatable; use --replace-acceptance to overwrite)\n' +
        '  --notes <text>            Append to notes (use --replace-notes to overwrite)\n' +
        '  --code-paths <paths>      Append code paths (repeatable; use --replace-code-paths to overwrite)\n' +
        '  --risks <risk>            Append risks (repeatable; use --replace-risks to overwrite)\n' +
        '  --lane <lane>             Update lane assignment (e.g., "Operations: Tooling")\n' +
        '  --type <type>             Update WU type (feature, bug, refactor, documentation)\n' +
        '  --priority <priority>     Update priority (P0, P1, P2, P3)\n' +
        '  --initiative <initId>     Update initiative (bidirectional update)\n' +
        '  --phase <number>          Update phase within initiative\n' +
        '  --test-paths-manual <t>   Append manual test descriptions (repeatable)\n' +
        '  --test-paths-unit <path>  Append unit test paths (repeatable)\n' +
        '  --test-paths-e2e <path>   Append e2e test paths (repeatable)\n' +
        '  --blocked-by <wuIds>      Append WU IDs that block this WU (use --replace-blocked-by to overwrite)\n' +
        '  --add-dep <wuIds>         Append WU IDs to dependencies (use --replace-dependencies to overwrite)\n' +
        '  --exposure <type>         Update exposure level (ui, api, backend-only, documentation)\n\n' +
        'Note: All array fields now append by default (WU-1225). Use --replace-* flags to overwrite.',
    );
  }

  // Apply edits to get updated WU
  const updatedWU = applyEdits(originalWU, opts);

  // WU-2004: Normalize legacy schema fields before validation
  // Converts: summary→description, string risks→array, test_paths→tests, etc.
  const normalizedForValidation = normalizeWUSchema(updatedWU);

  // WU-1539: Validate WU structure after applying edits (fail-fast, allows placeholders)
  // WU-1750: Zod transforms normalize embedded newlines in arrays and strings
  const validationResult = validateReadyWU(normalizedForValidation);
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    die(`${PREFIX} ❌ WU YAML validation failed:\n\n${errors}\n\nFix the issues above and retry.`);
  }

  // WU-2253: Validate acceptance/code_paths consistency and invariants compliance
  // This blocks WU edits if acceptance references paths not in code_paths
  // or if code_paths conflicts with tools/invariants.yml
  const invariantsPath = join(process.cwd(), 'tools/invariants.yml');
  const lintResult = lintWUSpec(normalizedForValidation, { invariantsPath });
  if (!lintResult.valid) {
    const formatted = formatLintErrors(lintResult.errors);
    die(
      `${PREFIX} ❌ WU SPEC LINT FAILED:\n\n${formatted}\n` +
        `Fix the issues above before editing this WU.`,
    );
  }

  // WU-1750: CRITICAL - Use transformed data for all subsequent operations
  // This ensures embedded newlines are normalized before YAML output
  const normalizedWU = validationResult.data;

  // WU-1329: Strict validation of path existence (default behavior)
  // --no-strict bypasses these checks
  const strict = !opts.noStrict;
  if (!strict) {
    console.warn(
      `${PREFIX} WARNING: strict validation bypassed (--no-strict). Path existence checks skipped.`,
    );
  }

  if (strict) {
    const rootDir = process.cwd();
    const strictErrors: string[] = [];

    // Validate code_paths exist
    if (normalizedWU.code_paths && normalizedWU.code_paths.length > 0) {
      const codePathsResult = validateCodePathsExistence(normalizedWU.code_paths, rootDir);
      if (!codePathsResult.valid) {
        strictErrors.push(...codePathsResult.errors);
      }
    }

    // Validate test_paths exist (unit, e2e - not manual)
    if (normalizedWU.tests) {
      const testPathsResult = validateTestPathsExistence(normalizedWU.tests, rootDir);
      if (!testPathsResult.valid) {
        strictErrors.push(...testPathsResult.errors);
      }
    }

    if (strictErrors.length > 0) {
      const errorList = strictErrors.map((e) => `  • ${e}`).join('\n');
      die(
        `${PREFIX} ❌ Strict validation failed:\n\n${errorList}\n\n` +
          `Options:\n` +
          `  1. Fix the paths in the WU spec to match actual files\n` +
          `  2. Use --no-strict to bypass path existence checks (not recommended)`,
      );
    }
  }

  // Validate lane format if present (WU-923: block parent-only lanes with taxonomy)
  if (normalizedWU.lane) {
    validateLaneFormat(normalizedWU.lane);
  }

  // WU-1365: Handle based on edit mode
  if (editMode === EDIT_MODE.WORKTREE) {
    // WU-1929: Block initiative changes for in_progress WUs
    // Initiative files are on main, not in worktrees, so bidirectional updates
    // cannot be done atomically. Users should complete the WU first.
    if (opts.initiative && opts.initiative !== originalWU.initiative) {
      die(
        `Cannot change initiative for in_progress WU ${id}.\n\n` +
          `Initiative reassignment requires atomic updates to initiative YAML files on main,\n` +
          `which is not possible while the WU is in_progress.\n\n` +
          `Options:\n` +
          `  1. Complete the WU first: pnpm wu:done --id ${id}\n` +
          `     Then reassign: pnpm wu:edit --id ${id} --initiative ${opts.initiative}\n` +
          `  2. Block the WU if not ready to complete:\n` +
          `     pnpm wu:block --id ${id} --reason "Needs initiative reassignment"`,
      );
    }

    // In-progress worktree WUs: apply edits directly in the active worktree
    console.log(`${PREFIX} Editing in_progress WU in active worktree...`);

    // Resolve worktree path using defaultWorktreeFrom() helper
    const worktreePath = await defaultWorktreeFrom(originalWU);
    if (!worktreePath) {
      die(
        `Cannot determine worktree path for WU ${id}.\n\n` +
          `Check that worktree_path is set in the WU YAML or lane field is valid.`,
      );
    }

    // WU-1806: Resolve to absolute path correctly even when running from inside a worktree
    // If we're already inside a worktree, check if it matches the target worktree
    const currentWorktree = detectCurrentWorktree();
    let absoluteWorktreePath;
    if (currentWorktree && currentWorktree.endsWith(worktreePath.replace('worktrees/', ''))) {
      // We're inside the target worktree - use cwd directly
      absoluteWorktreePath = currentWorktree;
      console.log(`${PREFIX} Running from inside target worktree`);
    } else {
      // Running from main checkout or a different worktree - resolve relative to cwd
      // (which should be the main checkout in the typical case)
      absoluteWorktreePath = resolve(worktreePath);
    }

    // Validate worktree state (WU-1365 acceptance criteria)
    validateWorktreeExists(absoluteWorktreePath, id);
    await validateWorktreeClean(absoluteWorktreePath, id);

    // Calculate expected branch and validate
    const expectedBranch = getLaneBranch(originalWU.lane, id);
    await validateWorktreeBranch(absoluteWorktreePath, expectedBranch, id);

    // Apply edits in the worktree (WU-1750: use normalized data)
    await applyEditsInWorktree({
      worktreePath: absoluteWorktreePath,
      id,
      updatedWU: normalizedWU,
    });

    console.log(`${PREFIX} ✅ Successfully edited ${id} in worktree`);
    console.log(`${PREFIX} Changes committed to lane branch`);

    // WU-1620: Display readiness summary
    displayReadinessSummary(id);
  } else {
    // Ready WUs: use micro-worktree on main (existing behavior)
    // Pre-flight checks only needed for micro-worktree mode
    await ensureOnMain(getGitForCwd());
    await ensureCleanWorkingTree();
    await ensureMainUpToDate(getGitForCwd(), 'wu:edit');

    console.log(`${PREFIX} Applying edits via micro-worktree...`);

    // WU-1929: Track old initiative for bidirectional update
    const oldInitiative = originalWU.initiative;
    const newInitiative = opts.initiative;
    const initiativeChanged = newInitiative && newInitiative !== oldInitiative;

    const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
    process.env.LUMENFLOW_WU_TOOL = MICRO_WORKTREE_OPERATIONS.WU_EDIT;
    try {
      await withMicroWorktree({
        operation: MICRO_WORKTREE_OPERATIONS.WU_EDIT,
        id: id,
        logPrefix: PREFIX,
        execute: async ({ worktreePath }) => {
          const extraFiles: string[] = [];

          // Write updated WU to micro-worktree (WU-1750: use normalized data)
          const wuPath = join(worktreePath, WU_PATHS.WU(id));
          // WU-1442: Normalize dates before dumping to prevent ISO timestamp corruption
          normalizeWUDates(normalizedWU);
          // Emergency fix Session 2: Use centralized stringifyYAML helper
          const yamlContent = stringifyYAML(normalizedWU);

          writeFileSync(wuPath, yamlContent, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
          console.log(`${PREFIX} ✅ Updated ${id}.yaml in micro-worktree`);

          // WU-1929: Handle bidirectional initiative updates
          if (initiativeChanged) {
            const initiativeFiles = updateInitiativeWusArrays(
              worktreePath,
              id,
              oldInitiative,
              newInitiative,
            );
            extraFiles.push(...initiativeFiles);
          }

          // WU-1594: Keep backlog projection synchronized with WU lane/spec edits.
          const backlogPath = join(worktreePath, WU_PATHS.BACKLOG());
          await regenerateBacklogFromState(backlogPath);
          console.log(`${PREFIX} ✅ Regenerated backlog.md in micro-worktree`);

          return {
            commitMessage: COMMIT_FORMATS.EDIT(id),
            files: getWuEditCommitFiles(id, extraFiles),
          };
        },
      });
    } finally {
      if (previousWuTool === undefined) {
        delete process.env.LUMENFLOW_WU_TOOL;
      } else {
        process.env.LUMENFLOW_WU_TOOL = previousWuTool;
      }
    }

    console.log(`${PREFIX} ✅ Successfully edited ${id}`);
    console.log(`${PREFIX} Changes pushed to origin/main`);

    // WU-1620: Display readiness summary
    displayReadinessSummary(id);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
