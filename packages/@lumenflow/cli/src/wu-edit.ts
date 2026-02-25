#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
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
 * WU-1650: Decomposed into wu-edit-validators.ts and wu-edit-operations.ts
 * @see {@link packages/@lumenflow/cli/src/lib/micro-worktree.ts} - Shared micro-worktree logic
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ZodIssue } from 'zod';
import { stringifyYAML } from '@lumenflow/core/wu-yaml';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import {
  FILE_SYSTEM,
  ENV_VARS,
  MICRO_WORKTREE_OPERATIONS,
  LOG_PREFIX,
  COMMIT_FORMATS,
  getLaneBranch,
} from '@lumenflow/core/wu-constants';
// WU-1593: Use centralized validateWUIDFormat (DRY)
import { ensureOnMain, ensureMainUpToDate, validateWUIDFormat } from '@lumenflow/core/wu-helpers';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { validateReadyWU } from '@lumenflow/core/wu-schema';
// WU-1806: Import detectCurrentWorktree for worktree path resolution
import { defaultWorktreeFrom, detectCurrentWorktree } from '@lumenflow/core/wu-done-validators';
// WU-2004: Import schema normalization for legacy WU formats
import { normalizeWUSchema } from '@lumenflow/core/wu-schema-normalization';
// WU-2253: Import WU spec linter for acceptance/code_paths validation
import { lintWUSpec, formatLintErrors } from '@lumenflow/core/wu-lint';
import { validateLaneFormat } from '@lumenflow/core/lane-checker';
import { runCLI } from './cli-entry-point.js';

// WU-1650: Import from decomposed modules
import {
  validateDoneWUEdits,
  validateWUEditable,
  validateWorktreeExists,
  validateWorktreeClean,
  validateWorktreeBranch,
  normalizeReplaceCodePathsArgv,
  EDIT_MODE,
} from './wu-edit-validators.js';

import {
  applyEdits,
  applyEditsInWorktree,
  getWuEditCommitFiles,
  regenerateBacklogFromState,
  normalizeWUDates,
  updateInitiativeWusArrays,
  displayReadinessSummary,
} from './wu-edit-operations.js';

// WU-1650: Re-export for backwards compatibility
// All test files and external consumers import from wu-edit.ts
export {
  validateDoneWUEdits,
  validateExposureValue,
  normalizeReplaceCodePathsArgv,
  hasScopeRelevantBranchChanges,
} from './wu-edit-validators.js';

export {
  applyExposureEdit,
  applyEdits,
  mergeStringField,
  getWuEditCommitFiles,
} from './wu-edit-operations.js';

const PREFIX = LOG_PREFIX.EDIT;

interface WuEditArgs extends Record<string, unknown> {
  id: string;
  specFile?: string;
  description?: string;
  acceptance?: string[];
  notes?: string;
  replaceNotes?: boolean;
  replaceAcceptance?: boolean;
  codePaths?: string[];
  replaceCodePaths?: boolean;
  risks?: string[];
  replaceRisks?: boolean;
  testPathsManual?: string[];
  testPathsUnit?: string[];
  testPathsE2e?: string[];
  lane?: string;
  type?: string;
  priority?: string;
  initiative?: string;
  phase?: number | string;
  blockedBy?: string;
  addDep?: string;
  exposure?: string;
  plan?: string;
  noStrict?: boolean;
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
  // WU-1683: Plan field (symmetric with initiative related_plan)
  plan: {
    name: 'plan',
    flags: '--plan <uri>',
    description: 'Plan file URI (lumenflow://plans/... or repo-relative path)',
  },
};

/**
 * Parse command line arguments
 */
function parseArgs(): WuEditArgs {
  const normalizedArgv = normalizeReplaceCodePathsArgv(process.argv);
  const originalArgv = process.argv;
  process.argv = normalizedArgv;
  try {
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
        // WU-1683: Plan field
        EDIT_OPTIONS.plan,
        // WU-1039: Add exposure for done WU metadata updates
        WU_OPTIONS.exposure,
        // Compatibility flag: reality checks now run in wu:prep/wu:done
        WU_OPTIONS.noStrict,
      ],
      required: ['id'],
      allowPositionalId: true,
    }) as WuEditArgs;
  } finally {
    process.argv = originalArgv;
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
 * Main entry point
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
export async function main() {
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
  if (opts.replaceCodePaths && (!opts.codePaths || opts.codePaths.length === 0)) {
    die(
      '--replace-code-paths requires at least one code path.\n\n' +
        'Use one of these forms:\n' +
        '  pnpm wu:edit --id WU-123 --replace-code-paths --code-paths "path/a.ts" --code-paths "path/b.ts"\n' +
        '  pnpm wu:edit --id WU-123 --replace-code-paths "path/a.ts,path/b.ts"',
    );
  }

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
    opts.exposure ||
    // WU-1683: Add plan to hasEdits check
    opts.plan;
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
        '  --exposure <type>         Update exposure level (ui, api, backend-only, documentation)\n' +
        '  --plan <uri>              Set plan file URI (lumenflow://plans/... or repo-relative)\n\n' +
        'Note: All array fields now append by default (WU-1225). Use --replace-* flags to overwrite.',
    );
  }

  // Apply edits to get updated WU
  const updatedWU = applyEdits(originalWU, opts);

  // WU-2004: Normalize legacy schema fields before validation
  // Converts: summary->description, string risks->array, test_paths->tests, etc.
  const normalizedForValidation = normalizeWUSchema(updatedWU);

  // WU-1539: Validate WU structure after applying edits (fail-fast, allows placeholders)
  // WU-1750: Zod transforms normalize embedded newlines in arrays and strings
  const validationResult = validateReadyWU(normalizedForValidation);
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((issue: ZodIssue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    die(`${PREFIX} WU YAML validation failed:\n\n${errors}\n\nFix the issues above and retry.`);
  }

  // WU-2253: Validate acceptance/code_paths consistency and invariants compliance
  // This blocks WU edits if acceptance references paths not in code_paths
  // or if code_paths conflicts with tools/invariants.yml
  const invariantsPath = join(process.cwd(), 'tools/invariants.yml');
  const lintResult = lintWUSpec(
    normalizedForValidation as unknown as Parameters<typeof lintWUSpec>[0],
    {
      invariantsPath,
      phase: 'intent',
    },
  );
  if (!lintResult.valid) {
    const formatted = formatLintErrors(lintResult.errors);
    die(
      `${PREFIX} WU SPEC LINT FAILED:\n\n${formatted}\n` +
        `Fix the issues above before editing this WU.`,
    );
  }

  // WU-1750: CRITICAL - Use transformed data for all subsequent operations
  // This ensures embedded newlines are normalized before YAML output
  const normalizedWU = validationResult.data;

  if (opts.noStrict) {
    console.warn(
      `${PREFIX} WARNING: --no-strict is accepted for compatibility; ` +
        `reality checks run in wu:prep/wu:done.`,
    );
  }

  // Validate lane format if present (WU-923: block parent-only lanes with taxonomy)
  if (normalizedWU.lane) {
    validateLaneFormat(normalizedWU.lane);
  }

  // WU-1365/WU-1591: Handle based on edit mode
  if (editMode === EDIT_MODE.BRANCH_PR) {
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

    const claimedBranch =
      typeof originalWU.claimed_branch === 'string' ? originalWU.claimed_branch : '';
    if (!claimedBranch) {
      die(
        `Cannot edit branch-pr WU ${id}: claimed_branch is missing.\n\n` +
          `This WU was claimed without persisted branch metadata.\n` +
          `Re-claim in cloud mode or repair metadata before retrying.`,
      );
    }

    const currentBranch = await getGitForCwd().getCurrentBranch();
    if (currentBranch !== claimedBranch) {
      die(
        `Cannot edit branch-pr WU ${id}: current branch does not match claimed_branch.\n\n` +
          `Current branch: ${currentBranch}\n` +
          `Claimed branch: ${claimedBranch}\n\n` +
          `Switch to the claimed branch and retry.`,
      );
    }

    await ensureCleanWorkingTree();
    await applyEditsInWorktree({
      worktreePath: process.cwd(),
      id,
      updatedWU: normalizedWU,
    });
    await getGitForCwd().push('origin', currentBranch);

    console.log(`${PREFIX} Successfully edited ${id} on branch ${currentBranch}`);
    console.log(`${PREFIX} Changes committed and pushed to origin/${currentBranch}`);

    displayReadinessSummary(id);
  } else if (editMode === EDIT_MODE.WORKTREE) {
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
    const targetWorktreeName = basename(worktreePath);
    let absoluteWorktreePath;
    if (currentWorktree && basename(currentWorktree) === targetWorktreeName) {
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
    const expectedBranch = getLaneBranch(originalWU.lane as string, id);
    await validateWorktreeBranch(absoluteWorktreePath, expectedBranch, id);
    // Apply edits in the worktree (WU-1750: use normalized data)
    await applyEditsInWorktree({
      worktreePath: absoluteWorktreePath,
      id,
      updatedWU: normalizedWU,
    });

    console.log(`${PREFIX} Successfully edited ${id} in worktree`);
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

    const previousWuTool = process.env[ENV_VARS.WU_TOOL];
    process.env[ENV_VARS.WU_TOOL] = MICRO_WORKTREE_OPERATIONS.WU_EDIT;
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
          console.log(`${PREFIX} Updated ${id}.yaml in micro-worktree`);

          // WU-1929: Handle bidirectional initiative updates
          if (initiativeChanged) {
            const initiativeFiles = updateInitiativeWusArrays(
              worktreePath,
              id,
              oldInitiative as string | undefined,
              newInitiative,
            );
            extraFiles.push(...initiativeFiles);
          }

          // WU-1594: Keep backlog projection synchronized with WU lane/spec edits.
          const backlogPath = join(worktreePath, WU_PATHS.BACKLOG());
          await regenerateBacklogFromState(backlogPath);
          console.log(`${PREFIX} Regenerated backlog.md in micro-worktree`);

          return {
            commitMessage: COMMIT_FORMATS.EDIT(id),
            files: getWuEditCommitFiles(id, extraFiles),
          };
        },
      });
    } finally {
      if (previousWuTool === undefined) {
        delete process.env[ENV_VARS.WU_TOOL];
      } else {
        process.env[ENV_VARS.WU_TOOL] = previousWuTool;
      }
    }

    console.log(`${PREFIX} Successfully edited ${id}`);
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
