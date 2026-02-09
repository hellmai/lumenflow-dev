/**
 * WU Spec Linter (WU-2252)
 *
 * Validates WU specs against two critical rules:
 * 1. Acceptance criteria cannot reference file paths absent from code_paths
 * 2. Acceptance/code_paths cannot conflict with invariants.yml
 *
 * This prevents specs that create work contradicting prior fixes.
 *
 * @module tools/lib/wu-lint
 */

import { existsSync } from 'node:fs';
import { minimatch } from 'minimatch';
import { loadInvariants, INVARIANT_TYPES } from './invariants-runner.js';

/**
 * Error type constants for WU spec linting
 */
export const WU_LINT_ERROR_TYPES = {
  ACCEPTANCE_PATH_NOT_IN_CODE_PATHS: 'acceptance_path_not_in_code_paths',
  CODE_PATH_CONFLICTS_INVARIANT: 'code_path_conflicts_invariant',
  ACCEPTANCE_CONFLICTS_INVARIANT: 'acceptance_conflicts_invariant',
  /** WU-1504: CLI command registration parity missing */
  REGISTRATION_PARITY_MISSING: 'registration_parity_missing',
};

/**
 * WU-1504: Registration surface paths that must be present when CLI commands change
 */
export const REGISTRATION_SURFACES = {
  PUBLIC_MANIFEST: 'packages/@lumenflow/cli/src/public-manifest.ts',
  MCP_TOOLS: 'packages/@lumenflow/mcp/src/tools.ts',
} as const;

/**
 * WU-1504 + WU-1530: Patterns that indicate a CLI command surface change.
 *
 * Only package.json triggers parity checks (indicates new bin entry).
 * Existing CLI source files can have internal changes without needing
 * registration surface updates.
 */
export const CLI_COMMAND_PATTERNS: string[] = ['packages/@lumenflow/cli/package.json'];

/**
 * WU-1504: Patterns that exclude files from parity check trigger.
 * Test files, lib/shared helpers, and the registration surfaces themselves
 * do not imply a new command registration.
 */
const CLI_COMMAND_EXCLUDE_PATTERNS: string[] = [
  '__tests__/',
  '/lib/',
  '/shared/',
  '/commands/',
  // WU-1518: init.ts is scaffolding logic, not a CLI command registration
  '/init.ts',
  REGISTRATION_SURFACES.PUBLIC_MANIFEST,
  REGISTRATION_SURFACES.MCP_TOOLS,
];

/**
 * Regex to detect file paths in acceptance criteria text
 * Matches patterns like: apps/web/src/file.ts, tools/lib/helper.ts
 * Uses explicit character sets to avoid regex backtracking issues
 */
const FILE_PATH_PATTERN = /(?:^|[\s'"`])([a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/g;

/**
 * Extract file paths from acceptance criteria text
 *
 * @param {string} text - Acceptance criterion text
 * @returns {string[]} Array of file paths found
 */
function extractFilePaths(text) {
  const paths = [];
  let match;

  while ((match = FILE_PATH_PATTERN.exec(text)) !== null) {
    paths.push(match[1]);
  }

  // Reset regex state
  FILE_PATH_PATTERN.lastIndex = 0;

  return paths;
}

/**
 * Check if a file path matches any pattern in code_paths
 * Supports glob patterns (e.g., apps/web/src/**\/*.ts)
 *
 * @param {string} filePath - File path to check
 * @param {string[]} codePaths - Array of code_paths (may include globs)
 * @returns {boolean} True if path matches any code_paths pattern
 */
function pathMatchesCodePaths(filePath, codePaths) {
  for (const pattern of codePaths) {
    // Exact match
    if (filePath === pattern) {
      return true;
    }

    // Glob match
    if (minimatch(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate that acceptance criteria only reference paths in code_paths
 *
 * @param {object} wu - WU spec object
 * @param {string} wu.id - WU ID
 * @param {string[]} wu.acceptance - Acceptance criteria
 * @param {string[]} wu.code_paths - Code paths
 * @returns {{valid: boolean, errors: Array<object>}} Validation result
 */
export function validateAcceptanceCodePaths(wu) {
  const { id, acceptance = [], code_paths = [] } = wu;
  const errors = [];

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

/**
 * Check forbidden-file invariant for conflicts
 *
 * @param {object} invariant - Invariant definition
 * @param {object} wu - WU spec object
 * @returns {Array<object>} Array of errors (empty if no conflicts)
 */
function checkForbiddenFileInvariant(invariant, wu) {
  const { id, acceptance = [], code_paths = [] } = wu;
  const errors = [];

  // Check if code_paths includes the forbidden file
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

  // Check if acceptance mentions creating the forbidden file
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

/**
 * Check mutual-exclusivity invariant for conflicts
 *
 * @param {object} invariant - Invariant definition
 * @param {object} wu - WU spec object
 * @returns {Array<object>} Array of errors (empty if no conflicts)
 */
function checkMutualExclusivityInvariant(invariant, wu) {
  const { id, code_paths = [] } = wu;
  const errors = [];

  // Check if code_paths includes multiple files from the mutual-exclusivity set
  const conflictingPaths = invariant.paths.filter((p) => code_paths.includes(p));
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
 *
 * @param {object} wu - WU spec object
 * @param {Array<object>} invariants - Array of invariant definitions
 * @returns {{valid: boolean, errors: Array<object>}} Validation result
 */
export function validateInvariantsCompliance(wu, invariants) {
  const errors = [];

  for (const invariant of invariants) {
    if (invariant.type === INVARIANT_TYPES.FORBIDDEN_FILE) {
      errors.push(...checkForbiddenFileInvariant(invariant, wu));
    } else if (invariant.type === INVARIANT_TYPES.MUTUAL_EXCLUSIVITY) {
      errors.push(...checkMutualExclusivityInvariant(invariant, wu));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * WU-1504 + WU-1530: Check if a code_path indicates a CLI command surface
 * change that would require registration in public-manifest and MCP tools.
 *
 * A path triggers parity checks if it:
 * 1. Matches any CLI_COMMAND_PATTERNS prefix
 * 2. Does NOT match any exclusion pattern (tests, lib, shared, etc.)
 */
function isCliCommandPath(codePath: string): boolean {
  const matchesCommand = CLI_COMMAND_PATTERNS.some((pattern) => codePath.includes(pattern));
  if (!matchesCommand) return false;

  const isExcluded = CLI_COMMAND_EXCLUDE_PATTERNS.some((pattern) => codePath.includes(pattern));
  return !isExcluded;
}

/**
 * WU-1504: Terminal WU statuses that should skip parity validation.
 * Matches the same set used by WU-1384 for completeness check skipping.
 */
const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'completed', 'abandoned', 'superseded']);

/**
 * WU-1504: Validate CLI command registration parity.
 *
 * When WU code_paths include package.json bin-entry changes, registration
 * surfaces (public-manifest.ts and MCP tools.ts) must also be present in
 * code_paths.
 *
 * Skips validation for terminal WU statuses (done, cancelled, etc.) since
 * those specs are historical and should not be retroactively flagged.
 *
 * @param wu - WU spec object with id, code_paths, and optional status
 * @returns Validation result with errors for missing registration surfaces
 */
export function validateRegistrationParity(wu: {
  id: string;
  code_paths?: string[];
  status?: string;
}): {
  valid: boolean;
  errors: Array<{ type: string; wuId: string; message: string; suggestion: string }>;
} {
  const { id, code_paths = [], status } = wu;
  const errors: Array<{ type: string; wuId: string; message: string; suggestion: string }> = [];

  // Skip parity check for terminal WU statuses (WU-1384 pattern)
  if (status && TERMINAL_STATUSES.has(status)) {
    return { valid: true, errors };
  }

  // Check if any code_path triggers the parity heuristic
  const hasCliCommandPath = code_paths.some((p) => isCliCommandPath(p));
  if (!hasCliCommandPath) {
    return { valid: true, errors };
  }

  // Check for missing registration surfaces
  const hasPublicManifest = code_paths.includes(REGISTRATION_SURFACES.PUBLIC_MANIFEST);
  const hasMcpTools = code_paths.includes(REGISTRATION_SURFACES.MCP_TOOLS);

  if (!hasPublicManifest) {
    errors.push({
      type: WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING,
      wuId: id,
      message: `CLI command change detected but '${REGISTRATION_SURFACES.PUBLIC_MANIFEST}' (public-manifest.ts) is not in code_paths`,
      suggestion: `Add '${REGISTRATION_SURFACES.PUBLIC_MANIFEST}' to code_paths if this WU adds or changes a CLI command`,
    });
  }

  if (!hasMcpTools) {
    errors.push({
      type: WU_LINT_ERROR_TYPES.REGISTRATION_PARITY_MISSING,
      wuId: id,
      message: `CLI command change detected but '${REGISTRATION_SURFACES.MCP_TOOLS}' (tools.ts) is not in code_paths`,
      suggestion: `Add '${REGISTRATION_SURFACES.MCP_TOOLS}' to code_paths if this WU adds or changes a CLI command`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
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
}

/**
 * Lint a WU spec against all rules
 *
 * @param {object} wu - WU spec object
 * @param {LintWUSpecOptions} [options={}] - Options
 * @returns {{valid: boolean, errors: Array<object>}} Lint result
 */
export function lintWUSpec(wu, options: LintWUSpecOptions = {}) {
  const allErrors = [];

  // 1. Validate acceptance/code_paths consistency
  const acceptanceResult = validateAcceptanceCodePaths(wu);
  allErrors.push(...acceptanceResult.errors);

  // 2. Load invariants if not provided
  let invariants = options.invariants || [];
  if (!options.invariants && options.invariantsPath) {
    try {
      if (existsSync(options.invariantsPath)) {
        invariants = loadInvariants(options.invariantsPath);
      }
    } catch {
      // If invariants can't be loaded, continue without them
    }
  }

  // 3. Validate invariants compliance
  if (invariants.length > 0) {
    const invariantsResult = validateInvariantsCompliance(wu, invariants);
    allErrors.push(...invariantsResult.errors);
  }

  // 4. WU-1504: Validate CLI command registration parity
  const parityResult = validateRegistrationParity(wu);
  allErrors.push(...parityResult.errors);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Format lint errors for display
 *
 * @param {Array<object>} errors - Array of lint errors
 * @returns {string} Formatted error message
 */
export function formatLintErrors(errors) {
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
