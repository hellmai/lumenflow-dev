#!/usr/bin/env node

/**
 * Preflight validation functions for wu:preflight and wu:done.
 *
 * Uses phase-aware rules from wu-rules-engine:
 * - intent/structural: syntax + policy intent checks
 * - reality: disk/diff/parity/test existence checks
 */

import { WU_PATHS } from './wu-paths.js';
import { readWURaw } from './wu-yaml.js';
import { TEST_TYPES, LOG_PREFIX, EMOJI } from './wu-constants.js';
import { BaseWUSchema } from './wu-schema.js';
import { detectFixableIssues, FIXABLE_ISSUES } from './wu-yaml-fixer.js';
import fg from 'fast-glob';
import path from 'node:path';
import {
  isPathLikeTestEntry,
  pathReferenceExistsSync,
  RULE_CODES,
  type ValidationPhase,
  validateWURules,
  validateWURulesSync,
} from './wu-rules-engine.js';

/**
 * Create a PreflightResult object
 */
export function createPreflightResult({
  valid,
  errors = [],
  warnings = [],
  missingCodePaths = [],
  missingCoverageCodePaths = [],
  missingTestPaths = [],
  changedFiles = [],
  suggestedTestPaths = {},
}) {
  return {
    valid,
    errors,
    warnings,
    missingCodePaths,
    missingCoverageCodePaths,
    missingTestPaths,
    changedFiles,
    suggestedTestPaths,
  };
}

function validateSchema(doc, id) {
  const errors = [];

  if (doc.id !== id) {
    errors.push(`WU ID mismatch: expected ${id}, found ${doc.id}`);
  }

  const fixableIssues = detectFixableIssues(doc);
  const createdIssue = fixableIssues.find(
    (issue) => issue.type === FIXABLE_ISSUES.DATE_ISO_TIMESTAMP,
  );

  if (createdIssue) {
    errors.push(
      `created field has invalid format: "${createdIssue.current}" is an ISO timestamp. ` +
        `Expected YYYY-MM-DD format. Suggested fix: change to "${createdIssue.suggested}". ` +
        `Fix by editing the WU YAML file (created: '${createdIssue.suggested}').`,
    );
  }

  const schemaResult = BaseWUSchema.safeParse(doc);

  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      const fieldPath = issue.path.join('.');
      const message = issue.message;

      if (fieldPath === 'created' && createdIssue) {
        continue;
      }

      errors.push(`${fieldPath}: ${message}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate code_paths files/globs exist on disk.
 */
export function validateCodePathsExistence(codePaths, rootDir) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return { valid: true, errors: [], missing: [] };
  }

  const missing = [];

  for (const filePath of codePaths) {
    if (!filePath || typeof filePath !== 'string') continue;

    if (!pathReferenceExistsSync(filePath, rootDir)) {
      missing.push(filePath);
    }
  }

  if (missing.length > 0) {
    const errors = [
      `code_paths validation failed - ${missing.length} path(s) not found:`,
      ...missing.map((p) => `  - ${p}`),
    ];
    return { valid: false, errors, missing };
  }

  return { valid: true, errors: [], missing: [] };
}

/**
 * Validate automated test file paths/globs exist.
 *
 * Non-path-like prose entries are ignored here; they are classified by
 * reality-phase rule R-007.
 */
export function validateTestPathsExistence(tests, rootDir) {
  if (!tests || typeof tests !== 'object') {
    return { valid: true, errors: [], missing: [] };
  }

  const missing = [];
  const fileTestTypes = [TEST_TYPES.UNIT, TEST_TYPES.E2E, TEST_TYPES.INTEGRATION];

  for (const testType of fileTestTypes) {
    const paths = tests[testType];
    if (!paths || !Array.isArray(paths)) continue;

    for (const filePath of paths) {
      if (!filePath || typeof filePath !== 'string') continue;
      if (!isPathLikeTestEntry(filePath)) continue;

      if (!pathReferenceExistsSync(filePath, rootDir)) {
        missing.push(filePath);
      }
    }
  }

  if (missing.length > 0) {
    const errors = [
      `test paths validation failed - ${missing.length} automated test path(s) not found:`,
      ...missing.map((p) => `  - ${p}`),
    ];
    return { valid: false, errors, missing };
  }

  return { valid: true, errors: [], missing: [] };
}

export interface ValidatePreflightOptions {
  /** Root directory for path resolution (fallback) */
  rootDir?: string;
  /** Worktree path (preferred source for YAML and file checks) */
  worktreePath?: string | null;
  /** Validation phase (default: reality for preflight entrypoints) */
  phase?: ValidationPhase;
  /** Optional git base ref for reality diff-aware checks */
  baseRef?: string;
  /** Optional git head ref for reality diff-aware checks */
  headRef?: string;
}

function appendIssueDetails(target: string[], issue): void {
  target.push(issue.message);

  if (!issue.metadata || typeof issue.metadata !== 'object') {
    return;
  }

  const metadata = issue.metadata as Record<string, unknown>;

  const missingCodePaths = metadata.missingCodePaths;
  if (Array.isArray(missingCodePaths) && missingCodePaths.length > 0) {
    target.push(...missingCodePaths.map((entry) => `  - ${entry}`));
  }

  const missingTestPaths = metadata.missingTestPaths;
  if (Array.isArray(missingTestPaths) && missingTestPaths.length > 0) {
    target.push(...missingTestPaths.map((entry) => `  - ${entry}`));
  }

  if (issue.code === RULE_CODES.CODE_PATH_COVERAGE) {
    const changedFiles = metadata.changedFiles;
    if (Array.isArray(changedFiles)) {
      target.push('Changed files considered:');
      if (changedFiles.length === 0) {
        target.push('  - (none)');
      } else {
        target.push(...changedFiles.map((entry) => `  - ${entry}`));
      }
    }
  }
}

export async function validatePreflight(id, options: ValidatePreflightOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const worktreePath = options.worktreePath || rootDir;
  const phase = options.phase || 'reality';

  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const missingCodePaths: string[] = [];
  const missingCoverageCodePaths: string[] = [];
  const missingTestPaths: string[] = [];
  const changedFiles: string[] = [];

  const wuPath = path.join(worktreePath, WU_PATHS.WU(id));

  let doc;
  try {
    doc = readWURaw(wuPath);
  } catch (err) {
    return createPreflightResult({
      valid: false,
      errors: [`Failed to read WU YAML: ${err.message}`],
    });
  }

  const schemaResult = validateSchema(doc, id);
  if (!schemaResult.valid) {
    allErrors.push(...schemaResult.errors);
  }

  const rulesContext = {
    id,
    type: doc.type,
    status: doc.status,
    code_paths: doc.code_paths,
    tests: doc.tests || doc.test_paths || {},
    cwd: worktreePath,
    baseRef: options.baseRef,
    headRef: options.headRef,
  };

  const rulesResult =
    phase === 'reality'
      ? await validateWURules(rulesContext, { phase })
      : validateWURulesSync(rulesContext, { phase });

  for (const issue of rulesResult.errors) {
    appendIssueDetails(allErrors, issue);
  }

  for (const issue of rulesResult.warnings) {
    appendIssueDetails(allWarnings, issue);
  }

  missingCodePaths.push(...rulesResult.metadata.missingCodePaths);
  missingCoverageCodePaths.push(...rulesResult.metadata.missingCoverageCodePaths);
  missingTestPaths.push(...rulesResult.metadata.missingTestPaths);
  changedFiles.push(...rulesResult.metadata.changedFiles);

  let suggestedTestPaths = {};
  if (missingTestPaths.length > 0) {
    const searchRoot = worktreePath || rootDir;
    try {
      suggestedTestPaths = await findSuggestedTestPaths(missingTestPaths, searchRoot);
    } catch (err) {
      if (process.env.DEBUG) {
        console.log(`[wu-preflight] Failed to find suggestions: ${err.message}`);
      }
    }
  }

  return createPreflightResult({
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    missingCodePaths,
    missingCoverageCodePaths,
    missingTestPaths,
    changedFiles,
    suggestedTestPaths,
  });
}

export function formatPreflightResult(id, result) {
  if (result.valid) {
    const lines = [
      `${LOG_PREFIX.PREFLIGHT} ${EMOJI.SUCCESS} Preflight validation passed for ${id}`,
    ];
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      lines.push('');
      lines.push(`${LOG_PREFIX.PREFLIGHT} ${EMOJI.WARNING} Warnings:`);
      lines.push(...result.warnings.map((warning) => `  - ${warning}`));
    }
    return lines.join('\n');
  }

  const lines = [
    `${LOG_PREFIX.PREFLIGHT} ${EMOJI.FAILURE} Preflight validation failed for ${id}`,
    '',
    ...result.errors,
  ];

  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    lines.push('');
    lines.push(`${LOG_PREFIX.PREFLIGHT} ${EMOJI.WARNING} Warnings:`);
    lines.push(...result.warnings.map((warning) => `  - ${warning}`));
  }

  if (result.missingCodePaths.length > 0) {
    lines.push('');
    lines.push('Fix options for missing code_paths:');
    lines.push('  1. Create the missing files/glob targets');
    lines.push(`  2. Update code_paths in ${id}.yaml to match actual files`);
  }

  if (result.missingCoverageCodePaths.length > 0) {
    lines.push('');
    lines.push('Fix options for code_paths coverage vs branch diff:');
    lines.push('  1. Commit changes that touch each missing scoped code_path');
    lines.push(`  2. Update code_paths in ${id}.yaml to match actual branch scope`);
    lines.push(`  3. Re-run: pnpm wu:prep --id ${id}`);
  }

  if (result.missingTestPaths.length > 0) {
    lines.push('');
    lines.push('Fix options for automated test paths:');
    lines.push('  1. Create the missing test files/glob targets');
    lines.push(`  2. Update tests in ${id}.yaml to match actual files`);
    lines.push('  3. Move prose/non-path test notes into tests.manual');
  }

  return lines.join('\n');
}

export const PreflightResult = {};

export async function findSuggestedTestPaths(missingPaths, rootDir) {
  const suggestions = {};

  if (missingPaths.length === 0) return suggestions;

  const globOptions = {
    cwd: rootDir,
    caseSensitiveMatch: false,
    limit: 5,
    ignore: ['**/node_modules/**'],
  };

  for (const missingPath of missingPaths) {
    const filename = missingPath.split('/').pop() || missingPath;
    const basename = filename.replace(/\.[^/.]+$/, '');
    const cleanBasename = basename.replace(/(\.test|\.spec)$/, '');

    let matches = await fg(`**/${filename}`, globOptions);

    if (matches.length === 0) {
      matches = await fg(`**/${basename}.{ts,js,mjs,tsx,jsx}`, globOptions);
    }

    if (matches.length === 0) {
      matches = await fg(`**/${cleanBasename}.{ts,js,mjs,tsx,jsx}`, globOptions);
    }

    if (matches.length > 0) {
      suggestions[missingPath] = matches.filter((m) => m !== missingPath);
    }
  }

  return suggestions;
}
