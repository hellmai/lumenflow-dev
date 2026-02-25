#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Prep Helper (WU-1223)
 *
 * Prepares a WU for completion by running gates and generating docs in the worktree.
 * After successful prep, prints copy-paste instruction to run wu:done from main.
 *
 * WU-1344: When gates fail on spec:linter due to pre-existing WU validation errors
 * (not caused by the current WU), prints a ready-to-copy wu:done --skip-gates
 * command with reason and fix-wu placeholders.
 *
 * WU-1493: Adds branch-pr mode support. When a WU has claimed_mode: branch-pr,
 * wu:prep reads the mode before rejecting non-worktree locations, validates that
 * the current branch matches the expected lane branch, and outputs PR-based
 * completion next steps on success.
 *
 * Workflow:
 * 1. Read WU YAML to check claimed_mode
 * 2. For worktree mode: verify we're in a worktree (error if in main checkout)
 *    For branch-pr mode: verify we're on the correct lane branch
 * 3. Run gates
 * 4. If gates fail, check if failures are pre-existing on main
 * 5. If pre-existing, print skip-gates command; otherwise, print fix guidance
 * 6. On success, print mode-appropriate next steps
 *
 * Usage:
 *   pnpm wu:prep --id WU-XXX [--docs-only] [--full-tests]
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { die } from '@lumenflow/core/error-handler';
import { resolveLocation } from '@lumenflow/core/context/location-resolver';
import { readWU } from '@lumenflow/core/wu-yaml';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import { TEST_FILE_PATTERNS } from '@lumenflow/core';
import { resolveChangedFiles, isCodePathCoveredByChangedFiles } from '@lumenflow/core/wu-rules-engine';
import {
  validatePreflight,
  formatPreflightResult,
  formatPreflightWarnings,
} from '@lumenflow/core/wu-preflight-validators';
import {
  CONTEXT_VALIDATION,
  PATTERNS,
  EXIT_CODES,
  WU_STATUS,
  EMOJI,
  CLAIMED_MODES,
  WU_TYPES,
} from '@lumenflow/core/wu-constants';
import { defaultBranchFrom } from '@lumenflow/core/wu-done-paths';
import { getCurrentBranch } from '@lumenflow/core/wu-helpers';
import { createPreGatesCheckpoint } from '@lumenflow/core/wu-checkpoint';
import { runGates } from './gates.js';
import { evaluateMainDirtyMutationGuard } from './hooks/dirty-guard.js';
export {
  isCodePathCoveredByChanges,
  findMissingCodePathCoverage,
  type GitDiffSpawnFn,
  type CodePathCoverageResult,
  checkCodePathCoverageBeforeGates,
  formatCodePathCoverageFailure,
} from './wu-code-path-coverage.js';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;
const TDD_EXCEPTION_MARKER = 'tdd-exception:';

type ResolveChangedFilesFn = typeof resolveChangedFiles;

type EvaluateTddDiffEvidenceResult =
  | {
      valid: true;
      reason: 'not-applicable' | 'documented-exception' | 'test-diff-evidence-found';
      changedFiles: string[];
      baseRef?: string;
      headRef?: string;
    }
  | {
      valid: false;
      reason: 'diff-unavailable' | 'missing-test-diff-evidence';
      changedFiles: string[];
      diffReason?: string;
      baseRef?: string;
      headRef?: string;
    };

/**
 * Log prefix for wu:prep command output.
 */
const PREP_PREFIX = '[wu-prep]';

/**
 * GATES_OPTIONS for wu:prep command.
 * Subset of gates options relevant for prep.
 */
const PREP_OPTIONS = {
  docsOnly: {
    name: 'docsOnly',
    flags: '--docs-only',
    description: 'Run docs-only gates (format, spec-linter)',
  },
  fullTests: {
    name: 'fullTests',
    flags: '--full-tests',
    description: 'Run full incremental test suite (disable tests.unit scoped execution)',
  },
};

export function resolveScopedUnitTestsForPrep(options: {
  fullTests?: boolean;
  tests?: { unit?: unknown };
}): string[] {
  if (options.fullTests) {
    return [];
  }

  const unitTestsRaw = options.tests?.unit;
  if (!Array.isArray(unitTestsRaw)) {
    return [];
  }

  return unitTestsRaw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function shouldEnforceTddDiffEvidence(doc: { type?: unknown }): boolean {
  return doc.type === WU_TYPES.FEATURE || doc.type === WU_TYPES.BUG;
}

export function hasDocumentedTddException(notes: unknown): boolean {
  if (typeof notes === 'string') {
    return notes.toLowerCase().includes(TDD_EXCEPTION_MARKER);
  }

  if (Array.isArray(notes)) {
    return notes.some((entry) => typeof entry === 'string' && hasDocumentedTddException(entry));
  }

  return false;
}

function normalizeDeclaredAutomatedTestPaths(tests: {
  unit?: unknown;
  e2e?: unknown;
  integration?: unknown;
}): string[] {
  const buckets = ['unit', 'e2e', 'integration'] as const;
  const paths: string[] = [];

  for (const bucket of buckets) {
    const value = tests?.[bucket];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue;
      }
      const normalized = entry.trim();
      if (normalized.length === 0) {
        continue;
      }
      paths.push(normalized);
    }
  }

  return paths;
}

function isTestFileFromDiff(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasTddEvidenceInWorkingDiff(options: {
  changedFiles: string[];
  declaredTestPaths: string[];
}): boolean {
  const { changedFiles, declaredTestPaths } = options;
  if (changedFiles.some((filePath) => isTestFileFromDiff(filePath))) {
    return true;
  }

  for (const testPath of declaredTestPaths) {
    if (isCodePathCoveredByChangedFiles({ codePath: testPath, changedFiles })) {
      return true;
    }
  }

  return false;
}

export async function evaluateTddDiffEvidenceForPrep(options: {
  wuId: string;
  doc: {
    type?: unknown;
    notes?: unknown;
    tests?: { unit?: unknown; e2e?: unknown; integration?: unknown };
  };
  cwd: string;
  resolveChangedFilesFn?: ResolveChangedFilesFn;
}): Promise<EvaluateTddDiffEvidenceResult> {
  const { doc } = options;
  if (!shouldEnforceTddDiffEvidence(doc)) {
    return { valid: true, reason: 'not-applicable', changedFiles: [] };
  }

  if (hasDocumentedTddException(doc.notes)) {
    return { valid: true, reason: 'documented-exception', changedFiles: [] };
  }

  const resolveChangedFilesFn = options.resolveChangedFilesFn ?? resolveChangedFiles;
  const changedFilesResult = await resolveChangedFilesFn({ cwd: options.cwd });
  if (!changedFilesResult.ok) {
    return {
      valid: false,
      reason: 'diff-unavailable',
      changedFiles: [],
      diffReason: changedFilesResult.reason,
    };
  }

  const declaredTestPaths = normalizeDeclaredAutomatedTestPaths(doc.tests ?? {});
  const hasEvidence = hasTddEvidenceInWorkingDiff({
    changedFiles: changedFilesResult.files,
    declaredTestPaths,
  });

  if (hasEvidence) {
    return {
      valid: true,
      reason: 'test-diff-evidence-found',
      changedFiles: changedFilesResult.files,
      baseRef: changedFilesResult.baseRef,
      headRef: changedFilesResult.headRef,
    };
  }

  return {
    valid: false,
    reason: 'missing-test-diff-evidence',
    changedFiles: changedFilesResult.files,
    baseRef: changedFilesResult.baseRef,
    headRef: changedFilesResult.headRef,
  };
}

function formatTddDiffEvidenceFailure(options: {
  wuId: string;
  result: Extract<EvaluateTddDiffEvidenceResult, { valid: false }>;
}): string {
  const { wuId, result } = options;

  if (result.reason === 'diff-unavailable') {
    return (
      `${EMOJI.FAILURE} TDD provenance check failed for ${wuId}.\n\n` +
      `Unable to evaluate branch diff for test evidence: ${result.diffReason || 'unknown diff error'}\n\n` +
      `Fix options:\n` +
      `  1. Ensure base ref is available (origin/main or main)\n` +
      `  2. Retry: pnpm wu:prep --id ${wuId}`
    );
  }

  const changedSection =
    result.changedFiles.length > 0
      ? result.changedFiles.map((filePath) => `  - ${filePath}`).join('\n')
      : '  - (none)';

  return (
    `${EMOJI.FAILURE} Missing TDD diff evidence for ${wuId}.\n\n` +
    `Feature/bug WUs must touch at least one automated test file before wu:prep.\n\n` +
    `Changed files (${result.baseRef || 'main'}...${result.headRef || 'HEAD'}):\n` +
    `${changedSection}\n\n` +
    `Fix options:\n` +
    `  1. Add/update test files in this branch and retry wu:prep\n` +
    `  2. Add an explicit exception marker in WU notes when test edits are not expected:\n` +
    `     ${TDD_EXCEPTION_MARKER} <reason>`
  );
}

/**
 * WU-1344: Check if a gate name is the spec:linter gate.
 * Used to identify when spec:linter fails so we can check for pre-existing failures.
 *
 * @param gateName - Name of the gate that failed
 * @returns true if this is the spec:linter gate
 */
export function isPreExistingSpecLinterFailure(gateName: string): boolean {
  const normalizedName = gateName.toLowerCase().replace(/[:-]/g, '');
  return normalizedName === 'speclinter';
}

/**
 * WU-1344: Format a skip-gates command for wu:done.
 * Includes --reason and --fix-wu placeholders.
 *
 * @param options - Configuration options
 * @param options.wuId - The WU ID being completed
 * @param options.mainCheckout - Path to main checkout
 * @returns Formatted command string ready to copy-paste
 */
export function formatSkipGatesCommand(options: { wuId: string; mainCheckout: string }): string {
  const { wuId, mainCheckout } = options;
  return `cd ${mainCheckout} && pnpm wu:done --id ${wuId} --skip-gates --reason "pre-existing on main" --fix-wu WU-XXXX`;
}

/**
 * WU-1344: Result of checking for pre-existing failures on main.
 */
export type PreExistingCheckResult = {
  hasPreExisting: boolean;
  hasNewFailures: boolean;
  newFailures: string[];
  preExistingFailures: string[];
  error?: string;
};

/**
 * WU-1344: Type for the exec function used to run commands on main.
 */
export type ExecOnMainFn = (cmd: string) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

/**
 * WU-1344: Default implementation of execOnMain using spawnSync.
 * Uses spawnSync with pnpm executable for safety (no shell injection risk).
 */
function defaultExecOnMain(mainCheckout: string): ExecOnMainFn {
  return async (cmd: string) => {
    // WU-1441: Compare main vs worktree using the *current* CLI build, even if
    // the main checkout doesn't yet support `wu:validate --json`.
    //
    // When wu:prep is running from a worktree, running `pnpm wu:validate --json`
    // inside the main checkout will execute the older CLI (and fail to parse).
    // Instead, execute the sibling dist entrypoint directly and vary only `cwd`.
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const wuValidateDist = path.join(distDir, 'wu-validate.js');
    const shouldUseDistWuValidate =
      cmd.includes('wu:validate') && cmd.includes('--json') && existsSync(wuValidateDist);

    if (shouldUseDistWuValidate) {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- node resolved from PATH; running dist script
      const result = spawnSync('node', [wuValidateDist, '--all', '--json'], {
        cwd: mainCheckout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    }

    // Parse command to extract pnpm script name and args
    // Expected format: "pnpm spec:linter" or similar
    const parts = cmd.split(/\s+/);
    const executable = parts[0];
    const args = parts.slice(1);

    const result = spawnSync(executable, args, {
      cwd: mainCheckout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}

function runScopedValidation({ wuId, cwd }: { wuId: string; cwd: string }): boolean {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- pnpm resolved from PATH; CLI orchestration
  const result = spawnSync('pnpm', ['wu:validate', '--id', wuId], {
    cwd,
    encoding: 'utf-8',
    stdio: 'inherit',
  });

  return (result.status ?? 1) === EXIT_CODES.SUCCESS;
}

type SpecLinterReport = {
  invalid?: { wuId: string }[];
};

function parseSpecLinterReport(output: string): SpecLinterReport | null {
  try {
    const parsed = JSON.parse(output.trim());
    return parsed as SpecLinterReport;
  } catch {
    return null;
  }
}

export function classifySpecLinterFailures(options: {
  mainInvalid: string[];
  worktreeInvalid: string[];
}): {
  hasPreExisting: boolean;
  hasNewFailures: boolean;
  newFailures: string[];
  preExistingFailures: string[];
} {
  const mainSet = new Set(options.mainInvalid);
  const worktreeSet = new Set(options.worktreeInvalid);
  const preExistingFailures = [...worktreeSet].filter((id) => mainSet.has(id));
  const newFailures = [...worktreeSet].filter((id) => !mainSet.has(id));

  return {
    hasPreExisting: preExistingFailures.length > 0,
    hasNewFailures: newFailures.length > 0,
    newFailures,
    preExistingFailures,
  };
}

async function runSpecLinterJson(execOnCwd: ExecOnMainFn): Promise<{
  invalidIds: string[];
  error?: string;
}> {
  const result = await execOnCwd('pnpm --silent wu:validate --all --json');
  const report = parseSpecLinterReport(result.stdout);

  if (!report || !Array.isArray(report.invalid)) {
    return {
      invalidIds: [],
      error: 'Failed to parse wu:validate JSON output.',
    };
  }

  const invalidIds = report.invalid
    .map((item) => item?.wuId)
    .filter((id): id is string => typeof id === 'string');

  return { invalidIds };
}

/**
 * WU-1344: Check if spec:linter failures are pre-existing on main branch.
 *
 * Runs spec:linter on the main checkout to determine if the failures
 * already exist there (i.e., not caused by the current WU).
 *
 * @param options - Configuration options
 * @param options.mainCheckout - Path to main checkout
 * @param options.execOnMain - Optional function to execute commands on main (for testing)
 * @returns Result indicating whether failures are pre-existing
 */
export async function checkPreExistingFailures(options: {
  mainCheckout: string;
  execOnMain?: ExecOnMainFn;
  execOnWorktree?: ExecOnMainFn;
}): Promise<PreExistingCheckResult> {
  const {
    mainCheckout,
    execOnMain = defaultExecOnMain(mainCheckout),
    execOnWorktree = defaultExecOnMain(process.cwd()),
  } = options;

  try {
    const worktreeResult = await runSpecLinterJson(execOnWorktree);
    const mainResult = await runSpecLinterJson(execOnMain);

    if (worktreeResult.error || mainResult.error) {
      return {
        hasPreExisting: false,
        hasNewFailures: false,
        newFailures: [],
        preExistingFailures: [],
        error: worktreeResult.error || mainResult.error,
      };
    }

    const classification = classifySpecLinterFailures({
      mainInvalid: mainResult.invalidIds,
      worktreeInvalid: worktreeResult.invalidIds,
    });

    return {
      ...classification,
      error: undefined,
    };
  } catch (error) {
    // If we can't check main, assume failures are NOT pre-existing
    // (safer to require fixing rather than skipping)
    return {
      hasPreExisting: false,
      hasNewFailures: false,
      newFailures: [],
      preExistingFailures: [],
      error: (error as Error).message,
    };
  }
}

/**
 * WU-1493: Check if a WU doc uses branch-pr claimed mode.
 *
 * @param doc - Partial WU YAML document (needs claimed_mode field)
 * @returns true if claimed_mode is 'branch-pr'
 */
export function isBranchPrMode(doc: { claimed_mode?: string }): boolean {
  return doc.claimed_mode === CLAIMED_MODES.BRANCH_PR;
}

/**
 * WU-1493: Validate that the current git branch matches the expected lane branch
 * for branch-pr mode.
 *
 * @param options - Branch comparison options
 * @param options.currentBranch - The currently checked-out branch
 * @param options.expectedBranch - The expected lane branch (e.g., lane/framework-cli/wu-1493)
 * @returns Validation result with valid flag and optional error message
 */
export function validateBranchPrBranch(options: {
  currentBranch: string;
  expectedBranch: string;
}): { valid: boolean; error?: string } {
  const { currentBranch, expectedBranch } = options;
  if (currentBranch === expectedBranch) {
    return { valid: true };
  }
  return {
    valid: false,
    error:
      `Current branch '${currentBranch}' does not match expected lane branch '${expectedBranch}'.\n\n` +
      `Switch to the lane branch first:\n` +
      `  git checkout ${expectedBranch}`,
  };
}

/**
 * WU-1493: Format success message for branch-pr mode.
 * Shows PR-based completion next steps instead of wu:done.
 *
 * @param options - Message options
 * @param options.wuId - The WU ID
 * @param options.laneBranch - The lane branch name
 * @returns Formatted success message string
 */
export function formatBranchPrSuccessMessage(options: {
  wuId: string;
  laneBranch: string;
}): string {
  const { wuId, laneBranch } = options;
  return (
    `${PREP_PREFIX} ${EMOJI.SUCCESS} ${wuId}: Prep completed successfully!\n` +
    `\n` +
    `${PREP_PREFIX} Gates passed on branch ${laneBranch}.\n` +
    `\n` +
    `${PREP_PREFIX} Next steps for branch-pr mode:\n` +
    `\n` +
    `  1. Push the branch:  git push origin ${laneBranch}\n` +
    `  2. Create a PR:      gh pr create --base main --head ${laneBranch}\n` +
    `  3. After PR merge:   pnpm wu:cleanup --id ${wuId}\n`
  );
}

export function evaluatePrepMainMutationGuard(options: {
  mainCheckout: string;
  isBranchPr: boolean;
  mainStatus: string;
}) {
  return evaluateMainDirtyMutationGuard({
    commandName: 'wu:prep',
    mainCheckout: options.mainCheckout,
    mainStatus: options.mainStatus,
    hasActiveWorktreeContext: !options.isBranchPr,
    isBranchPrMode: options.isBranchPr,
  });
}

/**
 * Print success message with copy-paste instruction.
 */
function printSuccessMessage(wuId: string, mainCheckout: string): void {
  console.log('');
  console.log(`${PREP_PREFIX} ${EMOJI.SUCCESS} ${wuId}: Prep completed successfully!`);
  console.log('');
  console.log(`${PREP_PREFIX} Gates passed in worktree.`);
  console.log('');
  console.log(`${PREP_PREFIX} Next step - copy and paste this command:`);
  console.log('');
  console.log(`    cd ${mainCheckout} && pnpm wu:done --id ${wuId}`);
  console.log('');
}

/**
 * Main entry point.
 */
/**
 * WU-2102: Create a gates-passed checkpoint so wu:done can skip gates.
 *
 * Called after wu:prep gates succeed. wu:done's canSkipGates() reads this
 * checkpoint and skips its own gate run when valid.
 */
export async function createPrepCheckpoint(params: {
  wuId: string;
  worktreePath: string;
  branchName: string;
}): Promise<void> {
  await createPreGatesCheckpoint(
    {
      wuId: params.wuId,
      worktreePath: params.worktreePath,
      branchName: params.branchName,
      gatesPassed: true,
    },
    {},
  );
}

export async function main(): Promise<void> {
  // Parse arguments
  const args = createWUParser({
    name: 'wu-prep',
    description: 'Prepare WU for completion (run gates in worktree)',
    options: [WU_OPTIONS.id, PREP_OPTIONS.docsOnly, PREP_OPTIONS.fullTests],
    required: ['id'],
    allowPositionalId: true,
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU id '${args.id}'. Expected format WU-123`);
  }

  // Detect location
  const location = await resolveLocation();

  // WU-1493: Read WU YAML early to check claimed_mode BEFORE location rejection.
  // This allows branch-pr WUs to run from main checkout on the lane branch.
  const wuPath = WU_PATHS.WU(id);
  let doc;
  try {
    doc = readWU(wuPath, id);
  } catch (error) {
    die(
      `Failed to read WU ${id}: ${(error as Error).message}\n\n` +
        `Options:\n` +
        `  1. Check if WU file exists: ls -la ${wuPath}\n` +
        `  2. Validate YAML syntax: pnpm wu:validate --id ${id}`,
    );
  }

  const branchPr = isBranchPrMode(doc);

  // WU-1223 + WU-1493: Location validation
  // For branch-pr mode: allow running from main checkout on the correct lane branch
  // For worktree mode: must be in a worktree (original behavior)
  if (branchPr) {
    // WU-1493: branch-pr mode - validate we're on the correct lane branch
    const expectedBranch = defaultBranchFrom(doc);
    const currentBranch = getCurrentBranch();

    if (!expectedBranch) {
      die(
        `${EMOJI.FAILURE} Cannot determine lane branch for ${id}.\n\n` +
          `Check that the WU has a valid lane and id in its YAML spec.`,
      );
    }

    if (!currentBranch) {
      die(
        `${EMOJI.FAILURE} Cannot determine current git branch.\n\n` +
          `Ensure you are in a git repository.`,
      );
    }

    const branchCheck = validateBranchPrBranch({
      currentBranch,
      expectedBranch,
    });

    if (!branchCheck.valid) {
      die(`${EMOJI.FAILURE} ${branchCheck.error}`);
    }

    console.log(`${PREP_PREFIX} branch-pr mode detected for ${id}`);
  } else {
    // Original worktree-only behavior
    if (location.type !== LOCATION_TYPES.WORKTREE) {
      die(
        `${EMOJI.FAILURE} wu:prep must be run from a worktree, not ${location.type}.\n\n` +
          `Current location: ${location.cwd}\n\n` +
          `If you have a worktree for ${id}, navigate to it first:\n` +
          `  cd worktrees/<lane>-${id.toLowerCase()}\n\n` +
          `If you don't have a worktree yet, claim the WU first:\n` +
          `  pnpm wu:claim --id ${id} --lane "<lane>"`,
      );
    }

    // Verify the worktree is for the correct WU
    if (location.worktreeWuId && location.worktreeWuId !== id) {
      console.warn(
        `${PREP_PREFIX} ${EMOJI.WARNING} Worktree is for ${location.worktreeWuId}, but you specified ${id}.`,
      );
      console.warn(`${PREP_PREFIX} Proceeding with ${id} as specified.`);
    }
  }

  // Validate WU status is in_progress
  if (doc.status !== WU_STATUS.IN_PROGRESS) {
    die(
      `${EMOJI.FAILURE} WU ${id} status is '${doc.status}', expected '${WU_STATUS.IN_PROGRESS}'.\n\n` +
        `wu:prep can only be run on WUs that are in progress.`,
    );
  }

  if (!branchPr) {
    const mainStatus = await createGitForPath(location.mainCheckout).getStatus();
    const mainMutationGuard = evaluatePrepMainMutationGuard({
      mainCheckout: location.mainCheckout,
      isBranchPr: branchPr,
      mainStatus,
    });

    if (mainMutationGuard.blocked) {
      die(mainMutationGuard.message ?? `${EMOJI.FAILURE} wu:prep blocked by dirty-main guard.`);
    }
  }

  console.log(`${PREP_PREFIX} Preparing ${id} for completion...`);
  console.log(`${PREP_PREFIX} Location: ${location.cwd}`);
  console.log(`${PREP_PREFIX} Main checkout: ${location.mainCheckout}`);
  console.log('');

  console.log(`${PREP_PREFIX} Running scoped validation for ${id}...`);
  const scopedOk = runScopedValidation({ wuId: id, cwd: location.cwd });
  if (!scopedOk) {
    die(
      `${EMOJI.FAILURE} Scoped validation failed for ${id}.\n\n` +
        `Fix the WU spec issues and rerun wu:prep.`,
    );
  }

  console.log(`${PREP_PREFIX} Running reality preflight checks...`);
  const realityPreflight = await validatePreflight(id, {
    rootDir: location.cwd,
    worktreePath: location.cwd,
    phase: 'reality',
  });
  if (!realityPreflight.valid) {
    die(formatPreflightResult(id, realityPreflight));
  }
  if (Array.isArray(realityPreflight.warnings) && realityPreflight.warnings.length > 0) {
    const warningLines = formatPreflightWarnings(
      realityPreflight.warnings,
      `${PREP_PREFIX} ${EMOJI.WARNING} Reality preflight warnings:`,
    );
    for (const line of warningLines) {
      console.log(line.startsWith('  - ') ? `${PREP_PREFIX} ${line}` : line);
    }
  }

  const tddEvidenceResult = await evaluateTddDiffEvidenceForPrep({
    wuId: id,
    doc,
    cwd: location.cwd,
  });
  if (!tddEvidenceResult.valid) {
    die(formatTddDiffEvidenceFailure({ wuId: id, result: tddEvidenceResult }));
  }

  // WU-1344: Check for pre-existing spec:linter failures on main BEFORE running gates.
  // We do this first because runGates() calls die() on failure, which exits the process
  // before we can check. By checking first, we can set up an exit handler to show
  // the skip-gates command if gates fail.
  console.log(`${PREP_PREFIX} Checking for pre-existing spec:linter failures on main...`);
  const preExistingCheck = await checkPreExistingFailures({
    mainCheckout: location.mainCheckout,
  });

  const hasPreExistingOnly = preExistingCheck.hasPreExisting && !preExistingCheck.hasNewFailures;

  if (preExistingCheck.error) {
    console.log(
      `${PREP_PREFIX} ${EMOJI.WARNING} Unable to compare spec:linter results: ${preExistingCheck.error}`,
    );
  } else if (hasPreExistingOnly) {
    console.log(`${PREP_PREFIX} ${EMOJI.WARNING} Pre-existing failures detected on main.`);

    // Set up an exit handler to print the skip-gates command when gates fail
    // This runs before process.exit() fully terminates the process
    process.on('exit', (code) => {
      if (code !== EXIT_CODES.SUCCESS) {
        console.log('');
        console.log(
          `${PREP_PREFIX} ${EMOJI.WARNING} Since failures are pre-existing on main, you can skip gates:`,
        );
        console.log('');
        console.log(
          `    ${formatSkipGatesCommand({ wuId: id, mainCheckout: location.mainCheckout })}`,
        );
        console.log('');
        console.log(`${PREP_PREFIX} Replace WU-XXXX with the WU that will fix these spec issues.`);
        console.log('');
      }
    });
  } else if (preExistingCheck.hasNewFailures) {
    console.log(
      `${PREP_PREFIX} ${EMOJI.WARNING} New spec:linter failures detected in worktree: ${preExistingCheck.newFailures.join(
        ', ',
      )}`,
    );
  } else {
    console.log(`${PREP_PREFIX} No pre-existing failures on main.`);
  }

  console.log('');

  const scopedUnitTests = resolveScopedUnitTestsForPrep({
    fullTests: args.fullTests,
    tests: doc.tests as { unit?: unknown } | undefined,
  });
  if (args.fullTests) {
    console.log(
      `${PREP_PREFIX} --full-tests enabled; using default incremental/full test gate flow.`,
    );
  } else if (scopedUnitTests.length > 0) {
    console.log(
      `${PREP_PREFIX} Using scoped tests from tests.unit (${scopedUnitTests.length} path${scopedUnitTests.length === 1 ? '' : 's'}).`,
    );
  }

  // Run gates
  console.log(`${PREP_PREFIX} Running gates...`);
  const gatesResult = await runGates({
    cwd: location.cwd,
    docsOnly: args.docsOnly,
    fullTests: args.fullTests,
    scopedTestPaths: scopedUnitTests,
  });

  if (!gatesResult) {
    // Gates failed - if pre-existing check was already done and showed failures,
    // the exit handler above will print the skip-gates command.
    // Otherwise, tell the user to fix the failures.
    if (!hasPreExistingOnly) {
      die(`${EMOJI.FAILURE} Gates failed.\n\n` + `Fix the gate failures and run wu:prep again.`);
    }
    // Pre-existing failures - exit with error, handler will print skip-gates command
    process.exit(EXIT_CODES.ERROR);
  }

  // WU-2102: Write gates-passed checkpoint so wu:done can skip gates
  const branchName = defaultBranchFrom(doc) ?? getCurrentBranch() ?? '';
  await createPrepCheckpoint({ wuId: id, worktreePath: location.cwd, branchName });

  // WU-1493: Success - print mode-appropriate message
  if (branchPr) {
    const laneBranch = defaultBranchFrom(doc) ?? '';
    const message = formatBranchPrSuccessMessage({ wuId: id, laneBranch });
    console.log('');
    console.log(message);
  } else {
    printSuccessMessage(id, location.mainCheckout);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
