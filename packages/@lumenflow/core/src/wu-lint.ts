// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Spec Linter (WU-2252)
 *
 * Validates WU specs against two critical rules:
 * 1. Acceptance criteria cannot reference file paths absent from code_paths
 * 2. Acceptance/code_paths cannot conflict with invariants.yml
 *
 * Shared phase-aware checks are delegated to wu-rules-engine.
 */

import { existsSync } from 'node:fs';
import { minimatch } from 'minimatch';
import { loadInvariants, INVARIANT_TYPES } from './invariants-runner.js';
import { WU_STATUS } from './wu-constants.js';
import {
  CLI_PACKAGE_JSON_PATH,
  REGISTRATION_SURFACES as RULE_REGISTRATION_SURFACES,
  RULE_CODES,
  normalizeValidationIssue,
  type ValidationIssue,
  type ValidationPhase,
  validateWURulesSync,
} from './wu-rules-engine.js';

/**
 * WU-2119: Interfaces for lint input types, replacing untyped parameters.
 */

/** Minimal WU shape required for lint validation */
interface LintableWU {
  id: string;
  type?: string;
  status?: string;
  acceptance?: string[] | Record<string, string[]>;
  code_paths?: string[];
  tests?: { unit?: string[]; e2e?: string[]; integration?: string[]; manual?: string[] };
  test_paths?: { unit?: string[]; e2e?: string[]; integration?: string[]; manual?: string[] };
}

/** Forbidden file invariant shape */
interface ForbiddenFileInvariant {
  type: string;
  id: string;
  path: string;
  description: string;
  message?: string;
}

/** Mutual exclusivity invariant shape */
interface MutualExclusivityInvariant {
  type: string;
  id: string;
  paths: string[];
  description?: string;
  message?: string;
}

/** Union of invariant types for the lint checker */
type LintInvariant = ForbiddenFileInvariant | MutualExclusivityInvariant;

/** Lint error shape produced by lint functions */
interface LintError {
  type: string;
  wuId: string;
  message: string;
  suggestion?: string;
  path?: string;
  criterion?: string;
  invariantId?: string;
  paths?: string[];
}

/**
 * Error type constants for WU spec linting
 */
export const WU_LINT_ERROR_TYPES = {
  ACCEPTANCE_PATH_NOT_IN_CODE_PATHS: 'acceptance_path_not_in_code_paths',
  CODE_PATH_CONFLICTS_INVARIANT: 'code_path_conflicts_invariant',
  ACCEPTANCE_CONFLICTS_INVARIANT: 'acceptance_conflicts_invariant',
  /** CLI registration parity surface missing */
  REGISTRATION_PARITY_MISSING: 'registration_parity_missing',
  /** Backward-compatible key for minimum test intent */
  UNIT_TESTS_REQUIRED: 'unit_tests_required',
  /** Canonical minimum test intent key */
  MINIMUM_TEST_INTENT_REQUIRED: 'minimum_test_intent_required',
};

/**
 * Registration surface paths required when CLI bin changes.
 */
export const REGISTRATION_SURFACES = {
  PUBLIC_MANIFEST: RULE_REGISTRATION_SURFACES.PUBLIC_MANIFEST,
  MCP_TOOLS: RULE_REGISTRATION_SURFACES.MCP_TOOLS,
} as const;

/**
 * Paths historically used to indicate CLI command surface changes.
 * Kept exported for compatibility and docs/tests.
 */
export const CLI_COMMAND_PATTERNS: string[] = [CLI_PACKAGE_JSON_PATH];

/**
 * WU-1504: Patterns that exclude files from parity check trigger.
 * Kept for backwards compatibility; parity is now reality-phase + diff-aware.
 */
const CLI_COMMAND_EXCLUDE_PATTERNS: string[] = [
  '__tests__/',
  '/lib/',
  '/shared/',
  '/commands/',
  '/init.ts',
  REGISTRATION_SURFACES.PUBLIC_MANIFEST,
  REGISTRATION_SURFACES.MCP_TOOLS,
];

/**
 * Regex to detect file paths in acceptance criteria text
 */
const FILE_PATH_PATTERN = /(?:^|[\s'"`])([a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/g;

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  let match;

  while ((match = FILE_PATH_PATTERN.exec(text)) !== null) {
    const captured = match[1];
    if (captured) {
      paths.push(captured);
    }
  }

  FILE_PATH_PATTERN.lastIndex = 0;
  return paths;
}

/**
 * Check if a file path matches any pattern in code_paths
 */
function pathMatchesCodePaths(filePath: string, codePaths: string[]): boolean {
  for (const pattern of codePaths) {
    if (filePath === pattern) {
      return true;
    }

    if (minimatch(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate that acceptance criteria only reference paths in code_paths
 */
export function validateAcceptanceCodePaths(wu: LintableWU) {
  const { id, code_paths = [] } = wu;
  const acceptance = Array.isArray(wu.acceptance) ? wu.acceptance : [];
  const errors: LintError[] = [];

  for (const criterion of acceptance) {
    const referencedPaths = extractFilePaths(criterion);

    for (const referencedPath of referencedPaths) {
      if (!pathMatchesCodePaths(referencedPath, code_paths)) {
        errors.push({
          type: WU_LINT_ERROR_TYPES.ACCEPTANCE_PATH_NOT_IN_CODE_PATHS,
          wuId: id,
          path: referencedPath,
          criterion,
          message: `Acceptance criterion references '${referencedPath}' which is not in code_paths`,
          suggestion: `Add '${referencedPath}' to code_paths or remove the reference from acceptance criteria`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function checkForbiddenFileInvariant(invariant: ForbiddenFileInvariant, wu: LintableWU) {
  const { id, code_paths = [] } = wu;
  const acceptance = Array.isArray(wu.acceptance) ? wu.acceptance : [];
  const errors: LintError[] = [];

  if (code_paths.includes(invariant.path)) {
    errors.push({
      type: WU_LINT_ERROR_TYPES.CODE_PATH_CONFLICTS_INVARIANT,
      wuId: id,
      invariantId: invariant.id,
      path: invariant.path,
      message: `code_paths includes '${invariant.path}' which conflicts with invariant ${invariant.id}: ${invariant.description}`,
      suggestion: invariant.message || `Remove '${invariant.path}' from code_paths`,
    });
  }

  for (const criterion of acceptance) {
    if (criterion.includes(invariant.path)) {
      errors.push({
        type: WU_LINT_ERROR_TYPES.ACCEPTANCE_CONFLICTS_INVARIANT,
        wuId: id,
        invariantId: invariant.id,
        path: invariant.path,
        criterion,
        message: `Acceptance criterion references forbidden file '${invariant.path}' (${invariant.id}: ${invariant.description})`,
        suggestion: invariant.message,
      });
    }
  }

  return errors;
}

function checkMutualExclusivityInvariant(invariant: MutualExclusivityInvariant, wu: LintableWU) {
  const { id, code_paths = [] } = wu;
  const errors: LintError[] = [];

  const conflictingPaths = invariant.paths.filter((p: string) => code_paths.includes(p));
  if (conflictingPaths.length > 1) {
    errors.push({
      type: WU_LINT_ERROR_TYPES.CODE_PATH_CONFLICTS_INVARIANT,
      wuId: id,
      invariantId: invariant.id,
      paths: conflictingPaths,
      message: `code_paths includes multiple mutually exclusive files (${invariant.id}): ${conflictingPaths.join(', ')}`,
      suggestion:
        invariant.message || `Only one of these files should exist: ${invariant.paths.join(', ')}`,
    });
  }

  return errors;
}

/**
 * Validate that code_paths and acceptance do not conflict with invariants
 */
export function validateInvariantsCompliance(wu: LintableWU, invariants: LintInvariant[]) {
  const errors: LintError[] = [];

  for (const invariant of invariants) {
    if (invariant.type === INVARIANT_TYPES.FORBIDDEN_FILE) {
      errors.push(...checkForbiddenFileInvariant(invariant as ForbiddenFileInvariant, wu));
    } else if (invariant.type === INVARIANT_TYPES.MUTUAL_EXCLUSIVITY) {
      errors.push(...checkMutualExclusivityInvariant(invariant as MutualExclusivityInvariant, wu));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Legacy parity trigger helper kept for compatibility tests/docs.
 */
function isCliCommandPath(codePath: string): boolean {
  const matchesCommand = CLI_COMMAND_PATTERNS.some((pattern) => codePath.includes(pattern));
  if (!matchesCommand) return false;

  const isExcluded = CLI_COMMAND_EXCLUDE_PATTERNS.some((pattern) => codePath.includes(pattern));
  return !isExcluded;
}

const TERMINAL_STATUSES = new Set([
  WU_STATUS.DONE,
  WU_STATUS.CANCELLED,
  WU_STATUS.COMPLETED,
  WU_STATUS.ABANDONED,
  WU_STATUS.SUPERSEDED,
]);

const LINT_TYPE_BY_RULE_CODE: Record<string, string> = {
  [RULE_CODES.MINIMUM_TEST_INTENT]: WU_LINT_ERROR_TYPES.MINIMUM_TEST_INTENT_REQUIRED,
  [RULE_CODES.PARITY_MISSING_SURFACE]: WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING,
};

function toLintIssue(wuId: string, issue: ValidationIssue) {
  const normalized = normalizeValidationIssue(issue, {
    wuId,
    typeByCode: LINT_TYPE_BY_RULE_CODE,
  });

  return {
    type: normalized.type,
    wuId,
    message: normalized.message,
    suggestion: normalized.suggestion,
  };
}

/**
 * Backward-compatible adapter for minimum test intent.
 */
export function validateUnitTestsRequirement(wu: {
  id: string;
  type?: string;
  status?: string;
  code_paths?: string[];
  tests?: { unit?: string[]; e2e?: string[]; integration?: string[]; manual?: string[] };
}): {
  valid: boolean;
  errors: Array<{ type: string; wuId: string; message: string; suggestion: string }>;
} {
  const result = validateWURulesSync(
    {
      id: wu.id,
      type: wu.type,
      status: wu.status,
      code_paths: wu.code_paths,
      tests: wu.tests,
    },
    { phase: 'structural' },
  );

  const errors = result.errors
    .filter((issue) => issue.code === RULE_CODES.MINIMUM_TEST_INTENT)
    .map((issue) => ({
      ...toLintIssue(wu.id, issue),
      type: WU_LINT_ERROR_TYPES.UNIT_TESTS_REQUIRED,
    }));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Adapter for parity surface validation.
 *
 * Parity is enforced in reality-phase preflight where git diff context is available.
 * This adapter only enforces when caller explicitly confirms `binChanged`.
 */
export function validateRegistrationParity(
  wu: {
    id: string;
    code_paths?: string[];
    status?: string;
  },
  options: {
    binChanged?: boolean;
  } = {},
): {
  valid: boolean;
  errors: Array<{ type: string; wuId: string; message: string; suggestion: string }>;
  warnings?: Array<{ type: string; wuId: string; message: string; suggestion: string }>;
} {
  const { id, code_paths = [], status } = wu;
  const errors: Array<{ type: string; wuId: string; message: string; suggestion: string }> = [];
  const warnings: Array<{ type: string; wuId: string; message: string; suggestion: string }> = [];

  if (status && TERMINAL_STATUSES.has(status)) {
    return { valid: true, errors, warnings };
  }

  if (!options.binChanged) {
    const hasCliCommandPath = code_paths.some((p) => isCliCommandPath(p));
    if (hasCliCommandPath) {
      warnings.push({
        type: WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING,
        wuId: id,
        message:
          'Parity check requires diff context and is enforced in reality phase (wu:prep/wu:done preflight).',
        suggestion:
          'Run wu:prep or wu:done preflight to evaluate bin-diff-aware registration parity.',
      });
    }
    return { valid: true, errors, warnings };
  }

  const hasPublicManifest = code_paths.includes(REGISTRATION_SURFACES.PUBLIC_MANIFEST);
  const hasMcpTools = code_paths.includes(REGISTRATION_SURFACES.MCP_TOOLS);

  if (!hasPublicManifest) {
    errors.push({
      type: WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING,
      wuId: id,
      message: `CLI bin change detected but '${REGISTRATION_SURFACES.PUBLIC_MANIFEST}' is not in code_paths`,
      suggestion: `Add '${REGISTRATION_SURFACES.PUBLIC_MANIFEST}' to code_paths`,
    });
  }

  if (!hasMcpTools) {
    errors.push({
      type: WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING,
      wuId: id,
      message: `CLI bin change detected but '${REGISTRATION_SURFACES.MCP_TOOLS}' is not in code_paths`,
      suggestion: `Add '${REGISTRATION_SURFACES.MCP_TOOLS}' to code_paths`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Options for linting WU spec
 */
export interface LintWUSpecOptions {
  /** Pre-loaded invariants */
  invariants?: unknown[];
  /** Path to invariants.yml */
  invariantsPath?: string;
  /** Validation phase for shared rule engine */
  phase?: ValidationPhase;
  /** Optional validation context */
  context?: {
    cwd?: string;
    baseRef?: string;
    headRef?: string;
  };
}

/**
 * Lint a WU spec against all rules
 */
export function lintWUSpec(wu: LintableWU, options: LintWUSpecOptions = {}) {
  const allErrors: LintError[] = [];
  const allWarnings: LintError[] = [];
  const phase = options.phase || 'structural';

  const acceptanceResult = validateAcceptanceCodePaths(wu);
  allErrors.push(...acceptanceResult.errors);

  let invariants = options.invariants || [];
  if (!options.invariants && options.invariantsPath) {
    try {
      if (existsSync(options.invariantsPath)) {
        invariants = loadInvariants(options.invariantsPath);
      }
    } catch {
      // Continue without invariants when loading fails.
    }
  }

  if (invariants.length > 0) {
    const invariantsResult = validateInvariantsCompliance(wu, invariants as LintInvariant[]);
    allErrors.push(...invariantsResult.errors);
  }

  const rulesResult = validateWURulesSync(
    {
      id: wu.id,
      type: wu.type,
      status: wu.status,
      code_paths: wu.code_paths,
      tests: wu.tests || wu.test_paths,
      cwd: options.context?.cwd,
      baseRef: options.context?.baseRef,
      headRef: options.context?.headRef,
    },
    { phase },
  );

  for (const issue of rulesResult.errors) {
    allErrors.push(toLintIssue(wu.id, issue));
  }

  for (const issue of rulesResult.warnings) {
    allWarnings.push(toLintIssue(wu.id, issue));
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Format lint errors for display
 */
export function formatLintErrors(errors: LintError[]): string {
  if (errors.length === 0) {
    return '';
  }

  const lines = ['WU SPEC LINT ERRORS:', ''];

  for (const error of errors) {
    lines.push(`- ${error.message}`);
    if (error.suggestion) {
      lines.push(`  Fix: ${error.suggestion}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
