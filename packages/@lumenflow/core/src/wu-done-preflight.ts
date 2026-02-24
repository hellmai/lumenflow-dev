// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preflight validation helpers for wu:done.
 */

import { validatePreflight } from './wu-preflight-validators.js';
import { LOG_PREFIX, EMOJI } from './wu-constants.js';
import { WU_PATHS } from './wu-paths.js';
import { validateSingleWU } from './validators/wu-tasks.js';
import { createError, ErrorCodes } from './error-handler.js';

interface PreflightPaths {
  rootDir: string;
  worktreePath?: string | null;
}

interface PreflightCodePathValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingCodePaths: string[];
  missingCoverageCodePaths: string[];
  missingTestPaths: string[];
  suggestedTestPaths?: Record<string, string[]>;
  abortedBeforeGates: boolean;
}

interface PreflightTaskValidationResult {
  valid: boolean;
  errors: string[];
  abortedBeforeMerge: boolean;
  localMainModified: boolean;
  hasStampStatusError: boolean;
}

/**
 * WU-1781: Build preflight error message with actionable guidance
 */
export function buildPreflightErrorMessage(id: string, errors: string[]): string {
  const hasStampStatusError = errors.some((error) =>
    error.includes('stamp but status is not done'),
  );

  let message = `
❌ PREFLIGHT VALIDATION FAILED

wu:validate found errors that would block pre-push hooks.
Aborting wu:done BEFORE merge operations to prevent deadlocks.

Errors:
${errors.map((error) => `  - ${error}`).join('\n')}

Fix options:
`;

  if (hasStampStatusError) {
    message += `
  For stamp-status mismatch errors:
  1. Fix the WU status to match the stamp (set status: done, locked: true)
  2. Or add the WU ID to workspace.yaml > software_delivery > exemptions > stamp_status_mismatch

`;
  }

  message += `
  General fixes:
  1. Run: pnpm wu:validate to see full errors
  2. Fix the validation errors
  3. Retry: pnpm wu:done --id ${id}

This preflight check prevents wu:done from leaving main in a stuck state
where husky pre-push would block all further operations.
`;

  return message;
}

/**
 * WU-1805: Execute preflight code_paths and test_paths validation
 */
export interface ExecutePreflightCodePathValidationOptions {
  /** Override validatePreflight for testing */
  validatePreflightFn?: typeof validatePreflight;
  /** Optional base ref for reality-phase diff checks */
  baseRef?: string;
  /** Optional head ref for reality-phase diff checks */
  headRef?: string;
}

export async function executePreflightCodePathValidation(
  id: string,
  paths: PreflightPaths,
  options: ExecutePreflightCodePathValidationOptions = {},
): Promise<PreflightCodePathValidationResult> {
  // Use injected validator for testability, default to actual implementation
  const validatePreflightFn = options.validatePreflightFn || validatePreflight;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Preflight: validating code_paths and test paths...`);

  const result = await validatePreflightFn(id, {
    rootDir: paths.rootDir,
    worktreePath: paths.worktreePath,
    phase: 'reality',
    baseRef: options.baseRef,
    headRef: options.headRef,
  });

  if (result.valid) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Preflight code_paths validation passed`);
    return {
      valid: true,
      errors: [],
      warnings: result.warnings || [],
      missingCodePaths: [],
      missingCoverageCodePaths: [],
      missingTestPaths: [],
      abortedBeforeGates: false,
    };
  }

  console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Preflight code_paths validation failed`);

  return {
    valid: false,
    errors: result.errors,
    warnings: result.warnings || [],
    missingCodePaths: result.missingCodePaths || [],
    missingCoverageCodePaths: result.missingCoverageCodePaths || [],
    missingTestPaths: result.missingTestPaths || [],
    suggestedTestPaths: result.suggestedTestPaths || {},
    abortedBeforeGates: true,
  };
}

/**
 * WU-1805: Build preflight code_paths error message with actionable guidance
 */
export function buildPreflightCodePathErrorMessage(
  id: string,
  result: PreflightCodePathValidationResult,
): string {
  const {
    errors,
    missingCodePaths = [],
    missingCoverageCodePaths = [],
    missingTestPaths = [],
    suggestedTestPaths = {} as Record<string, string[]>,
  } = result as { suggestedTestPaths?: Record<string, string[]> } & typeof result;

  let message = `
❌ PREFLIGHT CODE_PATHS VALIDATION FAILED

code_paths/test_paths validation found errors that would cause gates to fail.
Aborting wu:done BEFORE running gates to save time.

Errors:
${errors.map((error) => `  ${error}`).join('\n')}

`;

  if (missingCodePaths.length > 0) {
    message += `
Fix options for missing code_paths:
  1. Create the missing files in your worktree
  2. Update code_paths in ${id}.yaml using: pnpm wu:edit --id ${id} --code-paths "<corrected-paths>"
  3. Remove paths that were intentionally not created

`;
  }

  if (missingCoverageCodePaths.length > 0) {
    message += `
Fix options for code_paths coverage (branch diff):
  1. Commit changes that touch each missing scoped code_path
  2. Update code_paths in ${id}.yaml to match actual branch scope
  3. Re-run: pnpm wu:prep --id ${id} (or wu:done when ready)

`;
  }

  if (missingTestPaths.length > 0) {
    message += `
Fix options for missing test_paths:
  1. Create the missing test files
  2. Update test paths in ${id}.yaml using wu:edit
  3. Use tests.manual for descriptions instead of file paths

`;
  }

  // Add suggested paths if available
  const suggestionsMap = suggestedTestPaths as Record<string, string[]>;
  const hasSuggestions = Object.keys(suggestionsMap).some(
    (missingPath) => (suggestionsMap[missingPath] ?? []).length > 0,
  );

  if (hasSuggestions) {
    message += `Suggested alternatives found:
`;
    for (const [missingPath, suggestions] of Object.entries(suggestionsMap)) {
      if (suggestions.length > 0) {
        message += `For "${missingPath}":
${suggestions.map((s) => `  - ${s}`).join('\n')}

`;
      }
    }
  }

  message += `
After fixing, retry:
  pnpm wu:done --id ${id}

This preflight check runs BEFORE gates to catch YAML mismatches early.
See: https://lumenflow.dev/reference/troubleshooting-wu-done/ for more recovery options.
`;

  return message;
}

/**
 * WU-1781: Run wu:validate as preflight check before git operations
 */
export function runPreflightTasksValidation(id: string): PreflightTaskValidationResult {
  console.log(`\n${LOG_PREFIX.DONE} 🔍 Preflight: running wu:validate...`);

  const wuPath = WU_PATHS.WU(id);
  const result = validateSingleWU(wuPath, { strict: false });

  if (result.valid) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Preflight wu:validate passed`);
    return {
      valid: true,
      errors: [],
      abortedBeforeMerge: false,
      localMainModified: false,
      hasStampStatusError: false,
    };
  }

  console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Preflight wu:validate failed`);

  return {
    valid: false,
    errors: result.errors ?? [],
    abortedBeforeMerge: true,
    localMainModified: false,
    hasStampStatusError: false,
  };
}

/**
 * WU-2308: Validate all pre-commit hooks with worktree context
 */
export interface ValidateAllPreCommitHooksOptions {
  runGates?: (options: { cwd?: string; docsOnly?: boolean; wuId?: string }) => Promise<boolean>;
}

export async function validateAllPreCommitHooks(
  id: string,
  worktreePath: string | null = null,
  options: ValidateAllPreCommitHooksOptions = {},
): Promise<{ valid: boolean; errors: string[] }> {
  console.log(`\n${LOG_PREFIX.DONE} 🔍 Pre-flight: validating all pre-commit hooks...`);

  const errors: string[] = [];

  try {
    // WU-2308: Run from worktree context when provided to ensure audit checks
    // the worktree's dependencies (with fixes) not main's stale dependencies
    if (!options.runGates) {
      throw createError(
        ErrorCodes.PREFLIGHT_ERROR,
        'runGates not provided for pre-commit validation.',
      );
    }

    const ok = await options.runGates({
      cwd: worktreePath ?? process.cwd(),
      wuId: id,
    });

    if (ok) {
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All pre-commit hooks passed`);
      return { valid: true, errors: [] };
    }

    throw createError(ErrorCodes.PREFLIGHT_ERROR, 'Pre-commit hooks failed.');
  } catch {
    // Pre-commit hooks failed
    errors.push('Pre-commit hook validation failed. Fix these issues before wu:done:');
    errors.push('');
    errors.push('Common fixes:');
    errors.push('  • Formatting issues: Run pnpm format');
    errors.push('  • Lint errors: Run pnpm lint:fix');
    errors.push('  • Type errors: Check pnpm typecheck output');
    errors.push('  • Audit issues: Check pnpm audit output');
    errors.push('');
    errors.push(`After fixing, re-run: pnpm wu:done --id ${id}`);

    return { valid: false, errors };
  }
}
