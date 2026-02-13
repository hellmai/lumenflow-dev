/**
 * WU-1650: Apply/edit operations for wu:edit command
 *
 * Extracted from wu-edit.ts to dedicated module.
 * All field-application, merge, and write operations live here.
 */

import { die } from '@lumenflow/core/error-handler';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseYAML, stringifyYAML, readWU } from '@lumenflow/core/wu-yaml';
import { WU_PATHS, getStateStoreDirFromBacklog } from '@lumenflow/core/wu-paths';
import { generateBacklog } from '@lumenflow/core/backlog-generator';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import {
  FILE_SYSTEM,
  LOG_PREFIX,
  COMMIT_FORMATS,
  PKG_MANAGER,
  SCRIPTS,
  PRETTIER_FLAGS,
  READINESS_UI,
} from '@lumenflow/core/wu-constants';
import { validateLaneFormat } from '@lumenflow/core/lane-checker';
// WU-1442: Import date normalization to fix date corruption from js-yaml
import { normalizeToDateString } from '@lumenflow/core/date-utils';
// WU-1929: Import initiative-related modules for bidirectional initiative updates
import { INIT_PATHS } from '@lumenflow/initiatives/paths';
import { readInitiative, writeInitiative } from '@lumenflow/initiatives/yaml';
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
import { execSync } from 'node:child_process';
import { checkCodePathCoverageBeforeGates, formatCodePathCoverageFailure } from './wu-prep.js';
import {
  validateInitiativeFormat,
  validateInitiativeExists,
  validateExposureValue,
  hasScopeRelevantBranchChanges,
} from './wu-edit-validators.js';

const PREFIX = LOG_PREFIX.EDIT;

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
 * WU-1929: Update initiative wus: arrays bidirectionally
 *
 * When a WU's initiative field changes, this function:
 * 1. Removes the WU ID from the old initiative's wus: array (if exists)
 * 2. Adds the WU ID to the new initiative's wus: array
 *
 * @param worktreePath - Path to the worktree (for file operations)
 * @param wuId - WU ID being updated
 * @param oldInitId - Previous initiative ID (may be undefined)
 * @param newInitId - New initiative ID
 * @returns Array of relative file paths that were modified
 */
export function updateInitiativeWusArrays(
  worktreePath: string,
  wuId: string,
  oldInitId: string | undefined,
  newInitId: string,
): string[] {
  const modifiedFiles: string[] = [];

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
          console.log(`${PREFIX} Removed ${wuId} from ${oldInitId} wus: array`);
        }
      } catch (err) {
        // Old initiative may not exist or be invalid - log warning but continue
        console.warn(`${PREFIX} Could not update old initiative ${oldInitId}: ${err.message}`);
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
        console.log(`${PREFIX} Added ${wuId} to ${newInitId} wus: array`);
      }
    } catch (err) {
      die(`Failed to update new initiative ${newInitId}: ${err.message}`);
    }
  }

  return modifiedFiles;
}

/**
 * Normalize date fields in WU object to prevent date corruption
 *
 * WU-1442: js-yaml parses unquoted YYYY-MM-DD dates as Date objects.
 * When yaml.dump() serializes them back, it outputs ISO timestamps.
 * This function normalizes Date objects back to YYYY-MM-DD strings.
 */
export function normalizeWUDates(wu) {
  if (wu.created !== undefined) {
    wu.created = normalizeToDateString(wu.created);
  }
  return wu;
}

/**
 * Merge array values: replace by default, append if --append flag is set (WU-1388)
 */
export function mergeArrayField(existing, newValues, shouldAppend) {
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
 */
export function getWuEditCommitFiles(id: string, extraFiles: string[] = []): string[] {
  return [...new Set([WU_PATHS.WU(id), ...extraFiles, WU_PATHS.BACKLOG()])];
}

/**
 * WU-1594: Regenerate backlog.md from state store after wu:edit updates.
 */
export async function regenerateBacklogFromState(backlogPath: string): Promise<void> {
  const stateDir = getStateStoreDirFromBacklog(backlogPath);
  const store = new WUStateStore(stateDir);
  await store.load();
  const content = await generateBacklog(store);
  writeFileSync(backlogPath, content, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
}

/**
 * Load spec file and merge with original WU (preserving id and status)
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
 * Apply edits directly in an active worktree (WU-1365)
 * Used for in_progress WUs with claimed_mode=worktree
 */
export async function applyEditsInWorktree({ worktreePath, id, updatedWU }) {
  const wuPath = join(worktreePath, WU_PATHS.WU(id));
  // WU-1442: Normalize dates before dumping to prevent ISO timestamp corruption
  normalizeWUDates(updatedWU);
  // Emergency fix Session 2: Use centralized stringifyYAML helper
  const yamlContent = stringifyYAML(updatedWU);

  writeFileSync(wuPath, yamlContent, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  console.log(`${PREFIX} Updated ${id}.yaml in worktree`);

  // Format the file
  try {
    execSync(`${PKG_MANAGER} ${SCRIPTS.PRETTIER} ${PRETTIER_FLAGS.WRITE} "${wuPath}"`, {
      cwd: worktreePath,
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
      stdio: 'pipe',
    });
    console.log(`${PREFIX} Formatted ${id}.yaml`);
  } catch (err) {
    console.warn(`${PREFIX} Could not format file: ${err.message}`);
  }

  // Stage and commit using git adapter (library-first)
  const commitMsg = COMMIT_FORMATS.SPEC_UPDATE(id);
  try {
    const gitAdapter = createGitForPath(worktreePath);
    await gitAdapter.add(wuPath);
    await gitAdapter.commit(commitMsg);
    console.log(`${PREFIX} Committed: ${commitMsg}`);
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
 * WU-1618: Enforce code path coverage for in-progress WUs during spec edits.
 */
export function enforceInProgressCodePathCoverage(options: {
  id: string;
  editOpts: Record<string, unknown>;
  codePaths: string[] | undefined;
  cwd: string;
}): void {
  const { id, editOpts, codePaths = [], cwd } = options;
  const hasCodePathEdit = Array.isArray(editOpts.codePaths)
    ? editOpts.codePaths.length > 0
    : Boolean(editOpts.codePaths);

  if (!hasCodePathEdit) {
    return;
  }

  if (!Array.isArray(codePaths) || codePaths.length === 0) {
    return;
  }

  const coverage = checkCodePathCoverageBeforeGates({
    wuId: id,
    codePaths,
    cwd,
  });

  if (coverage.valid) {
    return;
  }

  if (!hasScopeRelevantBranchChanges(coverage.changedFiles)) {
    console.warn(
      `${PREFIX} code_paths coverage check deferred (no scope-relevant branch changes yet).`,
    );
    return;
  }

  die(
    `${formatCodePathCoverageFailure({
      wuId: id,
      missingCodePaths: coverage.missingCodePaths,
      changedFiles: coverage.changedFiles,
      error: coverage.error,
    })}\n\n` +
      `${PREFIX} Tip: if you're still defining scope before code changes, run wu:edit again after your first scope-relevant commit.`,
  );
}

/**
 * WU-1620: Display readiness summary after edit
 *
 * Shows whether WU is ready for wu:claim based on spec completeness.
 * Non-blocking - just informational to help agents understand what's missing.
 */
export function displayReadinessSummary(id: string) {
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
    console.warn(`${PREFIX} Could not validate readiness: ${err.message}`);
  }
}
