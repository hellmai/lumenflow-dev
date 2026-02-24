// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Core validation helpers for wu:done.
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { minimatch } from 'minimatch';
import { getGitForCwd } from './git-adapter.js';
import { parseYAML } from './wu-yaml.js';
import { die } from './error-handler.js';
import {
  BRANCHES,
  EMOJI,
  FILE_SYSTEM,
  GIT_COMMANDS,
  LOG_PREFIX,
  STRING_LITERALS,
  TEST_TYPES,
  VALIDATION,
  WU_TYPES,
  WU_STATUS,
} from './wu-constants.js';
import { PLACEHOLDER_SENTINEL } from './wu-schema.js';
import { hasGlobPattern } from './wu-rules-core.js';
import { pathReferenceExistsSync } from './wu-rules-resolvers.js';
import { resolveExposureDefault } from './wu-validation.js';
import { validateAutomatedTestRequirement } from './manual-test-validator.js';
import { isDocumentationPath } from './file-classifiers.js';
import { normalizeToDateString } from './date-utils.js';

interface ExposureDefaultResult {
  applied: boolean;
  exposure?: string;
}

interface WUDoneValidationDoc {
  id?: string;
  lane?: string;
  type?: string;
  exposure?: string;
  status?: string;
  locked?: boolean;
  completed?: string;
  completed_at?: string;
  description?: string;
  acceptance?: unknown;
  code_paths?: unknown;
  tests?: unknown;
  test_paths?: unknown;
}

interface ValidatePostMutationInput {
  id: string;
  wuPath: string;
  stampPath: string;
  eventsPath?: string | null;
}

const GIT_TREE_LIST_ARGS = ['-r', '--name-only'] as const;
const GLOB_MATCH_OPTIONS = { dot: true } as const;

export function applyExposureDefaults(
  doc: WUDoneValidationDoc | null | undefined,
): ExposureDefaultResult {
  if (!doc || typeof doc !== 'object') {
    return { applied: false };
  }

  if (typeof doc.exposure === 'string' && doc.exposure.trim().length > 0) {
    return { applied: false, exposure: doc.exposure };
  }

  const exposureDefault = resolveExposureDefault(doc.lane);
  if (!exposureDefault) {
    return { applied: false };
  }

  doc.exposure = exposureDefault;
  return { applied: true, exposure: exposureDefault };
}

/**
 * WU-1351: Validate code_paths files exist on main branch
 *
 * Prevents false completions by ensuring all code_paths entries
 * actually exist on the target branch (main or lane branch).
 *
 * This guards against:
 * - Stamps being created for WUs where code never merged
 * - Metadata becoming desynchronized from actual code
 */
export interface ValidateCodePathsExistOptions {
  /** Branch to check files against (default: 'main') */
  targetBranch?: string;
  /** Worktree path for worktree mode */
  worktreePath?: string | null;
}

export async function validateCodePathsExist(
  doc: WUDoneValidationDoc,
  id: string,
  options: ValidateCodePathsExistOptions = {},
) {
  const { targetBranch = BRANCHES.MAIN, worktreePath = null } = options;
  const errors: string[] = [];
  const missing: string[] = [];
  const codePaths = Array.isArray(doc.code_paths)
    ? doc.code_paths.filter((entry): entry is string => typeof entry === 'string')
    : [];

  // Skip validation for WUs without code_paths (docs-only, process WUs)
  if (codePaths.length === 0) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} No code_paths to validate for ${id}`);
    return { valid: true, errors: [], missing: [] };
  }

  console.log(`${LOG_PREFIX.DONE} Validating ${codePaths.length} code_paths exist...`);

  // For worktree mode, check files exist in the worktree (will be merged)
  // For branch-only mode or post-merge validation, check files exist on target branch
  if (worktreePath && existsSync(worktreePath)) {
    // Worktree mode: validate files exist in worktree
    for (const filePath of codePaths) {
      const existsInWorktree = hasGlobPattern(filePath)
        ? pathReferenceExistsSync(filePath, worktreePath)
        : existsSync(path.join(worktreePath, filePath));

      if (!existsInWorktree) {
        missing.push(filePath);
      }
    }

    if (missing.length > 0) {
      errors.push(
        `code_paths validation failed - ${missing.length} file(s) not found in worktree:\n${missing
          .map((p) => `  - ${p}`)
          .join(
            STRING_LITERALS.NEWLINE,
          )}\n\nEnsure all files listed in code_paths exist before running wu:done.`,
      );
    }
  } else {
    // Branch-only or post-merge: use git ls-tree to check files on target branch
    try {
      const gitAdapter = getGitForCwd();
      const branchFileListOutput = await gitAdapter.raw([
        GIT_COMMANDS.LS_TREE,
        ...GIT_TREE_LIST_ARGS,
        targetBranch,
      ]);
      const branchFiles = branchFileListOutput
        .split(STRING_LITERALS.NEWLINE)
        .map((entry) => entry.trim())
        .filter(Boolean);

      for (const filePath of codePaths) {
        if (hasGlobPattern(filePath)) {
          const hasGlobMatch = branchFiles.some((branchFile) =>
            minimatch(branchFile, filePath, GLOB_MATCH_OPTIONS),
          );

          if (!hasGlobMatch) {
            missing.push(filePath);
          }

          continue;
        }

        try {
          // git ls-tree returns empty for non-existent files
          const result = await gitAdapter.raw([GIT_COMMANDS.LS_TREE, targetBranch, '--', filePath]);

          if (!result || result.trim() === '') {
            missing.push(filePath);
          }
        } catch {
          // git ls-tree fails for non-existent paths
          missing.push(filePath);
        }
      }

      if (missing.length > 0) {
        errors.push(
          `code_paths validation failed - ${missing.length} file(s) not found on ${targetBranch}:\n${missing
            .map((p) => `  - ${p}`)
            .join(STRING_LITERALS.NEWLINE)}\n\n❌ POTENTIAL FALSE COMPLETION DETECTED\n\n` +
            `These files are listed in code_paths but do not exist on ${targetBranch}.\n` +
            `This prevents creating a stamp for incomplete work.\n\n` +
            `Fix options:\n` +
            `  1. Ensure all code is committed and merged to ${targetBranch}\n` +
            `  2. Update code_paths in ${id}.yaml to match actual files\n` +
            `  3. Remove files that were intentionally not created\n\n` +
            `Context: WU-1351 prevents false completions from INIT-WORKFLOW-INTEGRITY`,
        );
      }
    } catch (err) {
      // Non-fatal: warn but don't block if git command fails
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not validate code_paths: ${message}`);
      return { valid: true, errors: [], missing: [] };
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, missing };
  }

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All ${codePaths.length} code_paths verified`);
  return { valid: true, errors: [], missing: [] };
}

/**
 * Validate WU spec completeness (WU-1162, WU-1280)
 *
 * Ensures WU specifications are complete before allowing wu:done to proceed.
 * Prevents placeholder WUs from being marked as done.
 */
export function validateSpecCompleteness(doc: WUDoneValidationDoc, _id: string) {
  const errors: string[] = [];

  // Check for placeholder text in description
  if (doc.description && doc.description.includes(PLACEHOLDER_SENTINEL)) {
    errors.push(`Description contains ${PLACEHOLDER_SENTINEL} marker`);
  }

  // Handle both array and object formats for acceptance criteria
  if (doc.acceptance) {
    const hasPlaceholder = (value: unknown): boolean => {
      if (typeof value === 'string') {
        return value.includes(PLACEHOLDER_SENTINEL);
      }
      if (Array.isArray(value)) {
        return value.some((item) => hasPlaceholder(item));
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some((item) => hasPlaceholder(item));
      }
      return false;
    };

    if (hasPlaceholder(doc.acceptance)) {
      errors.push(`Acceptance criteria contain ${PLACEHOLDER_SENTINEL} markers`);
    }
  }

  // Check minimum description length
  if (!doc.description || doc.description.trim().length < VALIDATION.MIN_DESCRIPTION_LENGTH) {
    errors.push(
      `Description too short (${doc.description?.trim().length || 0} chars, minimum ${VALIDATION.MIN_DESCRIPTION_LENGTH})`,
    );
  }

  // Check code_paths for non-documentation WUs
  if (doc.type !== WU_TYPES.DOCUMENTATION && doc.type !== WU_TYPES.PROCESS) {
    const codePaths = Array.isArray(doc.code_paths) ? doc.code_paths : [];
    if (codePaths.length === 0) {
      errors.push('Code paths required for non-documentation WUs');
    }

    // WU-1280: Check tests array for non-documentation WUs
    // Support both tests: (current) and test_paths: (legacy)
    const testObj =
      doc.tests && typeof doc.tests === 'object'
        ? (doc.tests as Record<string, unknown>)
        : doc.test_paths && typeof doc.test_paths === 'object'
          ? (doc.test_paths as Record<string, unknown>)
          : {};

    // Helper to check if array has items
    const hasItems = (arr: unknown): boolean => Array.isArray(arr) && arr.length > 0;

    const hasUnitTests = hasItems(testObj[TEST_TYPES.UNIT]);
    const hasE2ETests = hasItems(testObj[TEST_TYPES.E2E]);
    const hasManualTests = hasItems(testObj[TEST_TYPES.MANUAL]);
    const hasIntegrationTests = hasItems(testObj[TEST_TYPES.INTEGRATION]);

    if (!(hasUnitTests || hasE2ETests || hasManualTests || hasIntegrationTests)) {
      errors.push('At least one test path required (unit, e2e, integration, or manual)');
    }

    // WU-2332: Require automated tests for code file changes
    // Manual-only tests are not sufficient when code_paths contain actual code files
    const automatedTestResult = validateAutomatedTestRequirement(doc);
    if (!automatedTestResult.valid) {
      errors.push(...automatedTestResult.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

function deriveStatusFromEventsContent(
  eventsContent: string,
  wuId: string,
): (typeof WU_STATUS)[keyof typeof WU_STATUS] | undefined {
  let status: (typeof WU_STATUS)[keyof typeof WU_STATUS] | undefined;

  for (const line of eventsContent.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { wuId?: string; type?: string };
      if (event.wuId !== wuId || !event.type) continue;

      switch (event.type) {
        case 'claim':
        case 'create':
          status = WU_STATUS.IN_PROGRESS;
          break;
        case 'release':
          status = WU_STATUS.READY;
          break;
        case 'complete':
          status = WU_STATUS.DONE;
          break;
        case 'block':
          status = WU_STATUS.BLOCKED;
          break;
        case 'unblock':
          status = WU_STATUS.IN_PROGRESS;
          break;
      }
    } catch {
      // Ignore malformed lines; other guards handle structural integrity.
    }
  }

  return status;
}

/**
 * WU-1617: Post-mutation validation for wu:done
 *
 * Validates that metadata files written by tx.commit() are valid:
 * 1. WU YAML has completed_at field with valid ISO datetime
 * 2. WU YAML has locked: true
 * 3. Stamp file exists
 * 4. State store derives to done (when eventsPath is provided)
 */
export function validatePostMutation({
  id,
  wuPath,
  stampPath,
  eventsPath = null,
}: ValidatePostMutationInput) {
  const errors: string[] = [];

  // Check stamp file exists
  if (!existsSync(stampPath)) {
    errors.push(`Stamp file not created: ${stampPath}`);
  }

  // Read and validate WU YAML after mutation
  if (!existsSync(wuPath)) {
    errors.push(`WU YAML not found after mutation: ${wuPath}`);
    return { valid: false, errors };
  }

  try {
    const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    const doc = parseYAML(content);

    // Verify completed_at exists and is valid ISO datetime
    if (!doc.completed_at) {
      errors.push(`Missing required field 'completed_at' in ${id}.yaml`);
    } else {
      // Validate ISO datetime format (YYYY-MM-DDTHH:mm:ss.sssZ or similar)
      const timestamp = new Date(doc.completed_at as string);
      if (isNaN(timestamp.getTime())) {
        errors.push(`Invalid completed_at timestamp: ${doc.completed_at}`);
      }
    }

    // Keep legacy completion date normalized for downstream tools.
    if (!doc.completed) {
      errors.push(`Missing required field 'completed' in ${id}.yaml`);
    } else {
      const normalizedCompleted = normalizeToDateString(doc.completed);
      if (!normalizedCompleted) {
        errors.push(`Invalid completed date: ${doc.completed}`);
      } else if (normalizedCompleted !== doc.completed) {
        errors.push(`Non-normalized completed date: ${doc.completed}`);
      }
    }

    // Verify locked is true
    if (doc.locked !== true) {
      errors.push(
        `Missing or invalid 'locked' field in ${id}.yaml (expected: true, got: ${doc.locked})`,
      );
    }

    // Verify status is done
    if (doc.status !== WU_STATUS.DONE) {
      errors.push(
        `Invalid status in ${id}.yaml (expected: '${WU_STATUS.DONE}', got: '${doc.status}')`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to parse WU YAML after mutation: ${message}`);
  }

  if (eventsPath) {
    if (!existsSync(eventsPath)) {
      errors.push(`State store file not found after mutation: ${eventsPath}`);
    } else {
      try {
        const eventsContent = readFileSync(eventsPath, {
          encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
        });
        const derivedStatus = deriveStatusFromEventsContent(eventsContent, id);
        if (derivedStatus !== WU_STATUS.DONE) {
          errors.push(
            `WU ${id} state store is '${derivedStatus ?? 'missing'}' after mutation (expected: '${WU_STATUS.DONE}')`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to parse state store after mutation: ${message}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * WU-2242: Validate that test_paths is required for non-doc WUs
 *
 * Enforces that WUs with code changes (non-documentation types with code_paths
 * that contain actual code) have at least one test path specified.
 */
export function validateTestPathsRequired(wu: WUDoneValidationDoc) {
  const wuId = typeof wu.id === 'string' ? wu.id : 'WU-unknown';
  // Skip validation for documentation and process WUs
  if (wu.type === WU_TYPES.DOCUMENTATION || wu.type === WU_TYPES.PROCESS) {
    return { valid: true };
  }

  // Skip if code_paths is empty or undefined
  const codePaths = Array.isArray(wu.code_paths)
    ? wu.code_paths.filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (codePaths.length === 0) {
    return { valid: true };
  }

  // Skip if all code_paths are documentation paths
  const hasCodeChanges = codePaths.some((codePath) => !isDocumentationPath(codePath));
  if (!hasCodeChanges) {
    return { valid: true };
  }

  // Check if tests object exists and has at least one test
  const testObj =
    wu.tests && typeof wu.tests === 'object' ? (wu.tests as Record<string, unknown>) : {};

  // Helper to check if array has items
  const hasItems = (arr: unknown): boolean => Array.isArray(arr) && arr.length > 0;

  const hasUnitTests = hasItems(testObj[TEST_TYPES.UNIT]);
  const hasE2ETests = hasItems(testObj[TEST_TYPES.E2E]);
  const hasManualTests = hasItems(testObj[TEST_TYPES.MANUAL]);
  const hasIntegrationTests = hasItems(testObj[TEST_TYPES.INTEGRATION]);

  // No tests at all - fail
  if (!(hasUnitTests || hasE2ETests || hasManualTests || hasIntegrationTests)) {
    return {
      valid: false,
      error: `${wuId} requires test_paths: WU has code_paths but no tests specified. Add unit, e2e, integration, or manual tests.`,
    };
  }

  // WU-2332: If we have tests, also check automated test requirement for code files
  // Manual-only tests are not sufficient for code changes
  const automatedTestResult = validateAutomatedTestRequirement(wu);
  if (!automatedTestResult.valid) {
    // Extract the first error line for the single-error format of this function
    const errorSummary =
      automatedTestResult.errors[0]?.split('\n')[0] || 'Automated tests required';
    return {
      valid: false,
      error: `${wuId}: ${errorSummary}`,
    };
  }

  return { valid: true };
}

/**
 * WU-2310: Check if a path is allowed for documentation WUs.
 *
 * @param {string} filePath - File path to check
 * @returns {boolean} True if path is allowed for docs WUs
 */
function isAllowedDocsPath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/').trim();
  if (normalized.length === 0) return false;

  if (normalized.startsWith('.lumenflow/stamps/')) {
    return true;
  }

  return isDocumentationPath(normalized);
}

/**
 * WU-2310: Validate type vs code_paths at preflight (before transaction starts).
 */
export function validateTypeVsCodePathsPreflight(wu: WUDoneValidationDoc) {
  const errors: string[] = [];
  const blockedPaths: string[] = [];
  const wuId = typeof wu.id === 'string' ? wu.id : 'WU-unknown';

  // Only validate documentation WUs
  if (wu.type !== WU_TYPES.DOCUMENTATION) {
    return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
  }

  // Skip if no code_paths
  const codePaths = wu.code_paths;
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
  }

  // Check each code_path against allowed patterns
  for (const filePath of codePaths) {
    if (!isAllowedDocsPath(filePath)) {
      blockedPaths.push(filePath);
    }
  }

  if (blockedPaths.length > 0) {
    const pathsList = blockedPaths.map((p) => `  - ${p}`).join('\n');
    errors.push(
      `Documentation WU ${wuId} has code_paths that would fail pre-commit hook:\n${pathsList}`,
    );
    return { valid: false, errors, blockedPaths, abortedBeforeTransaction: true };
  }

  return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
}

/**
 * WU-2310: Build error message for type vs code_paths preflight failure.
 */
export function buildTypeVsCodePathsErrorMessage(id: string, blockedPaths: string[]): string {
  return `
PREFLIGHT VALIDATION FAILED (WU-2310)

WU ${id} is type: documentation but has code_paths that are not allowed:

${blockedPaths.map((p) => `  - ${p}`).join('\n')}

This would fail at git commit time (pre-commit hook: gateDocsOnlyPathEnforcement).
Aborting BEFORE transaction to prevent inconsistent state.

Fix options:

  1. Change WU type to 'engineering' (or 'feature', 'bug', etc.):
     pnpm wu:edit --id ${id} --type engineering

  2. Update code_paths to only include documentation files:
     pnpm wu:edit --id ${id} --code-paths "<docs-dir>/..." "*.md"

Allowed paths for documentation WUs:
  - configured docs-only prefixes from workspace.yaml software_delivery.directories
    (docs, ai, claude, memoryBank)
  - .lumenflow/stamps/
  - *.md files

After fixing, retry: pnpm wu:done --id ${id}
`;
}

/**
 * WU-1153: Validate that code_paths are committed before wu:done metadata updates
 *
 * Prevents lost work by ensuring all code_paths are committed before metadata
 * transaction starts. If code_paths are uncommitted and metadata transaction
 * fails, the rollback could lose the uncommitted code changes.
 *
 * @param {object} wu - WU YAML document
 * @param {object} gitAdapter - Git adapter instance
 * @param {object} options - Validation options
 * @param {boolean} [options.abortOnFailure=true] - Whether to call die() on failure
 * @returns {Promise<{valid: boolean, errors: string[], uncommittedPaths: string[]}>}
 */
export async function validateCodePathsCommittedBeforeDone(
  wu: Record<string, unknown>,
  gitAdapter: { getStatus: () => Promise<string> },
  options: { abortOnFailure?: boolean } = {},
): Promise<{ valid: boolean; errors: string[]; uncommittedPaths: string[] }> {
  const { abortOnFailure = true } = options;
  const errors: string[] = [];
  const uncommittedPaths: string[] = [];

  // Skip validation if no code_paths
  const codePaths = wu.code_paths as string[] | undefined;
  if (!codePaths || codePaths.length === 0) {
    return { valid: true, errors: [], uncommittedPaths: [] };
  }

  try {
    // Get git status to check for uncommitted files
    const gitStatus = await gitAdapter.getStatus();

    // Parse git status output to find uncommitted files
    const statusLines = gitStatus.split('\n').filter((line) => line.trim());

    // Create a Set of uncommitted file paths for efficient lookup
    const uncommittedFiles = new Set<string>();

    for (const line of statusLines) {
      // Git status porcelain format:
      // XY PATH
      // where X = staged, Y = working tree
      // We care about UnsafeAny file that's not in a clean state
      const match = line.match(/^.{2}\s+(.+)$/);
      if (match && match[1]) {
        const filePath = match[1];
        uncommittedFiles.add(filePath);
      }
    }

    // Check each code_path against uncommitted files
    for (const codePath of codePaths) {
      if (uncommittedFiles.has(codePath)) {
        uncommittedPaths.push(codePath);
      }
    }

    // If UnsafeAny code_paths are uncommitted, validation fails
    if (uncommittedPaths.length > 0) {
      const count = uncommittedPaths.length;
      const pathList = uncommittedPaths.map((p) => `  - ${p}`).join('\n');

      errors.push(`${count} code_path${count === 1 ? '' : 's'} are not committed:\n${pathList}`);

      if (abortOnFailure) {
        const errorMessage = buildCodePathsCommittedErrorMessage(wu.id as string, uncommittedPaths);
        die(errorMessage);
      }
    }
  } catch (err) {
    // If git status fails, warn but don't block (non-fatal)
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not validate code_paths commit status: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { valid: true, errors: [], uncommittedPaths: [] };
  }

  return {
    valid: errors.length === 0,
    errors,
    uncommittedPaths,
  };
}

/**
 * WU-1153: Build error message for uncommitted code_paths validation failure
 *
 * @param {string} wuId - WU ID
 * @param {string[]} uncommittedPaths - List of uncommitted code_paths
 * @returns {string} Formatted error message
 */
export function buildCodePathsCommittedErrorMessage(
  wuId: string,
  uncommittedPaths: string[],
): string {
  const count = uncommittedPaths.length;
  const pathList = uncommittedPaths.map((p) => `  - ${p}`).join('\n');

  return `
❌ UNCOMMITTED CODE_PATHS DETECTED (WU-1153)

${count} code_path${count === 1 ? '' : 's'} for ${wuId} are not committed:

${pathList}

wu:done cannot proceed because uncommitted code_paths would be lost 
if the metadata transaction fails and needs to roll back.

This prevents lost work from metadata rollbacks after code commits.

Required actions:
  1. Commit your code changes:
     git add ${uncommittedPaths.join(' ')}
     git commit -m "implement: ${wuId} changes"

  2. Retry wu:done:
     pnpm wu:done --id ${wuId}

The guard ensures atomic completion: either both code and metadata succeed,
or neither is modified. This prevents partial state corruption.

Context: WU-1153 prevents lost work from metadata rollbacks
`;
}
