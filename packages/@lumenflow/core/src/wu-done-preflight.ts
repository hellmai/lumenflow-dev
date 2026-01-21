/**
 * Preflight validation helpers for wu:done.
 */

import { execSync as execSyncImport } from 'node:child_process';
import { validatePreflight } from './wu-preflight-validators.js';
import { LOG_PREFIX, EMOJI, STDIO } from './wu-constants.js';

/**
 * WU-1781: Build preflight error message with actionable guidance
 */
export function buildPreflightErrorMessage(id, errors) {
  const hasStampStatusError = errors.some((e) => e.includes('stamp but status is not done'));

  let message = `
❌ PREFLIGHT VALIDATION FAILED

tasks:validate found errors that would block pre-push hooks.
Aborting wu:done BEFORE any merge operations to prevent deadlocks.

Errors:
${errors.map((e) => `  - ${e}`).join('\n')}

Fix options:
`;

  if (hasStampStatusError) {
    message += `
  For stamp-status mismatch errors:
  1. Fix the WU status to match the stamp (set status: done, locked: true)
  2. Or add the WU ID to .lumenflow.config.yaml > exemptions > stamp_status_mismatch

`;
  }

  message += `
  General fixes:
  1. Run: pnpm tasks:validate to see full errors
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
}

export async function executePreflightCodePathValidation(
  id,
  paths,
  options: ExecutePreflightCodePathValidationOptions = {},
) {
  // Use injected validator for testability, default to actual implementation
  const validatePreflightFn = options.validatePreflightFn || validatePreflight;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Preflight: validating code_paths and test paths...`);

  const result = await validatePreflightFn(id, {
    rootDir: paths.rootDir,
    worktreePath: paths.worktreePath,
  });

  if (result.valid) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Preflight code_paths validation passed`);
    return {
      valid: true,
      errors: [],
      missingCodePaths: [],
      missingTestPaths: [],
      abortedBeforeGates: false,
    };
  }

  console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Preflight code_paths validation failed`);

  return {
    valid: false,
    errors: result.errors,
    missingCodePaths: result.missingCodePaths || [],
    missingTestPaths: result.missingTestPaths || [],
    abortedBeforeGates: true,
  };
}

/**
 * WU-1805: Build preflight code_paths error message with actionable guidance
 */
export function buildPreflightCodePathErrorMessage(id, result) {
  const { errors, missingCodePaths = [], missingTestPaths = [] } = result;

  let message = `
❌ PREFLIGHT CODE_PATHS VALIDATION FAILED

code_paths/test_paths validation found errors that would cause gates to fail.
Aborting wu:done BEFORE running gates to save time.

Errors:
${errors.map((e) => `  ${e}`).join('\n')}

`;

  if (missingCodePaths.length > 0) {
    message += `
Fix options for missing code_paths:
  1. Create the missing files in your worktree
  2. Update code_paths in ${id}.yaml using: pnpm wu:edit --id ${id} --code-paths "<corrected-paths>"
  3. Remove paths that were intentionally not created

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

  message += `
After fixing, retry:
  pnpm wu:done --id ${id}

This preflight check runs BEFORE gates to catch YAML mismatches early.
See: docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md for more recovery options.
`;

  return message;
}

/**
 * WU-1781: Run tasks:validate as preflight check before any git operations
 */
export interface ExecSyncOverrideOptions {
  /** Override execSync for testing (default: child_process.execSync) */
  execSyncFn?: typeof execSyncImport;
}

export function runPreflightTasksValidation(id, options: ExecSyncOverrideOptions = {}) {
  // Use injected execSync for testability, default to node's child_process
  const execSyncFn = options.execSyncFn || execSyncImport;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Preflight: running tasks:validate...`);

  try {
    // Run tasks:validate with WU_ID context (single-WU validation mode)
    execSyncFn('node tools/validate.js', {
      stdio: STDIO.PIPE,
      encoding: 'utf-8',
      env: { ...process.env, WU_ID: id },
    });

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Preflight tasks:validate passed`);
    return {
      valid: true,
      errors: [],
      abortedBeforeMerge: false,
      localMainModified: false,
      hasStampStatusError: false,
    };
  } catch (err) {
    // Validation failed - extract errors from output
    const output = err.stdout || err.message || 'Unknown validation error';
    const errors = output
      .split('\n')
      .filter((line) => line.includes('[') && line.includes(']'))
      .map((line) => line.trim());

    const hasStampStatusError = errors.some((e) => e.includes('stamp but status is not done'));

    console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Preflight tasks:validate failed`);

    return {
      valid: false,
      errors: errors.length > 0 ? errors : [output],
      abortedBeforeMerge: true,
      localMainModified: false,
      hasStampStatusError,
    };
  }
}

/**
 * WU-2308: Validate all pre-commit hooks with worktree context
 */
export function validateAllPreCommitHooks(
  id,
  worktreePath = null,
  options: ExecSyncOverrideOptions = {},
) {
  const execSyncFn = options.execSyncFn || execSyncImport;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Pre-flight: validating all pre-commit hooks...`);

  const errors = [];

  try {
    // WU-2308: Run from worktree context when provided to ensure audit checks
    // the worktree's dependencies (with fixes) not main's stale dependencies
    const execOptions: { stdio: 'inherit' | 'pipe' | 'ignore'; encoding: 'utf-8'; cwd?: string } = {
      stdio: STDIO.INHERIT as 'inherit',
      encoding: 'utf-8' as const,
    };

    // Only set cwd when worktreePath is provided
    if (worktreePath) {
      execOptions.cwd = worktreePath;
    }

    // Run the gates-pre-commit script that contains all validation gates
    execSyncFn('node tools/gates-pre-commit.js', execOptions);

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All pre-commit hooks passed`);
    return { valid: true, errors: [] };
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
