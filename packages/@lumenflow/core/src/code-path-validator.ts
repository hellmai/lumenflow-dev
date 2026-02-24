#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unified Code Path Validator (WU-1825)
 *
 * Consolidates three separate code path validators into one module:
 * - validateCodePathsExist (wu-done-validators.ts) - file existence for wu:done
 * - validateLaneCodePaths (lane-validator.ts) - lane pattern matching
 * - validateWUCodePaths (wu-validator.ts) - code quality (TODOs, mocks)
 *
 * Usage:
 *   import { validate } from './code-path-validator.js';
 *
 *   // Mode: 'exist' - check file existence (wu:done workflow)
 *   const result = await validate(paths, { mode: 'exist', worktreePath, targetBranch });
 *
 *   // Mode: 'lane' - check lane pattern matching (wu:claim workflow)
 *   const result = validate(paths, { mode: 'lane', lane: 'Operations: Tooling' });
 *
 *   // Mode: 'quality' - check code quality (TODOs, mocks)
 *   const result = validate(paths, { mode: 'quality', worktreePath, allowTodos: false });
 *
 * Part of INIT-023: Workflow Integrity initiative.
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import micromatch from 'micromatch';

import { getGitForCwd } from './git-adapter.js';
import { extractParent } from './lane-checker.js';
import {
  LANE_PATH_PATTERNS,
  BRANCHES,
  STRING_LITERALS,
  GIT_COMMANDS,
  LOG_PREFIX,
  EMOJI,
} from './wu-constants.js';
// WU-2010: Import validation constants to eliminate magic numbers
import { INLINE_KEYWORD_MAX_OFFSET } from './constants/validation-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

// Type definitions
interface ExistValidationResult {
  valid: boolean;
  errors: string[];
  missing: string[];
}

interface LaneValidationResult {
  hasWarnings: boolean;
  warnings: string[];
  violations: string[];
  skipped: boolean;
}

interface QualityValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface QualityOptions {
  allowTodos?: boolean;
  worktreePath?: string | null;
}

interface ValidateOptions {
  mode?: string;
  worktreePath?: string;
  targetBranch?: string;
  lane?: string;
  allowTodos?: boolean;
}

// ============================================================================
// VALIDATION MODE CONSTANTS
// ============================================================================

/**
 * Validation modes for the unified validator
 * @enum {string}
 */
export const VALIDATION_MODES = Object.freeze({
  /** Check file existence - used by wu:done */
  EXIST: 'exist',
  /** Check lane pattern matching - used by wu:claim */
  LANE: 'lane',
  /** Check code quality (TODOs, mocks) - used by wu:done */
  QUALITY: 'quality',
});

// ============================================================================
// FILE EXISTENCE VALIDATION (MODE: 'exist')
// ============================================================================

/**
 * Check if a file path is a test file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is a test file
 */
function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const testPatterns = [
    /\.test\.(ts|tsx|js|jsx|mjs)$/,
    /\.spec\.(ts|tsx|js|jsx|mjs)$/,
    /__tests__\//,
    /\.test-utils\./,
    /\.mock\./,
  ];
  return testPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Check if a file path is a markdown file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is a markdown file
 */
function isMarkdownFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /\.md$/i.test(normalized);
}

/**
 * Get the repo root directory
 * @returns {string} Absolute path to repo root
 */
function getRepoRoot(): string {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Validate that files exist (worktree mode)
 * @param {string[]} codePaths - Array of file paths
 * @param {string} worktreePath - Worktree directory path
 * @returns {ExistValidationResult} Validation result
 */
function validateExistenceInWorktree(
  codePaths: string[],
  worktreePath: string,
): ExistValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];

  for (const filePath of codePaths) {
    const fullPath = path.join(worktreePath, filePath);
    if (!existsSync(fullPath)) {
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

  return { valid: errors.length === 0, errors, missing };
}

/**
 * Validate that files exist on a git branch (branch-only mode)
 * @param {string[]} codePaths - Array of file paths
 * @param {string} targetBranch - Branch to check files against
 * @returns {Promise<ExistValidationResult>} Validation result
 */
async function validateExistenceOnBranch(
  codePaths: string[],
  targetBranch: string,
): Promise<ExistValidationResult> {
  const missing: string[] = [];
  const errors: string[] = [];

  try {
    const gitAdapter = getGitForCwd();

    for (const filePath of codePaths) {
      try {
        const result = await gitAdapter.raw([GIT_COMMANDS.LS_TREE, targetBranch, '--', filePath]);
        if (!result || result.trim() === '') {
          missing.push(filePath);
        }
      } catch {
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
          `  2. Update code_paths in WU YAML to match actual files\n` +
          `  3. Remove files that were intentionally not created\n\n` +
          `Context: WU-1351 prevents false completions from INIT-WORKFLOW-INTEGRITY`,
      );
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not validate code_paths: ${errMessage}`,
    );
    return { valid: true, errors: [], missing: [] };
  }

  return { valid: errors.length === 0, errors, missing };
}

// ============================================================================
// LANE PATTERN VALIDATION (MODE: 'lane')
// ============================================================================

/**
 * Validate code paths against lane patterns
 * @param {string[]} codePaths - Array of file paths
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {LaneValidationResult} Validation result
 */
function validateLanePatterns(codePaths: string[], lane: string): LaneValidationResult {
  // Skip validation if no code_paths
  if (!codePaths || codePaths.length === 0) {
    return {
      hasWarnings: false,
      warnings: [],
      violations: [],
      skipped: true,
    };
  }

  // Extract parent lane (e.g., "Operations" from "Operations: Tooling")
  const parentLane = extractParent(lane);

  // Get patterns for this lane parent
  const patterns = LANE_PATH_PATTERNS[parentLane as keyof typeof LANE_PATH_PATTERNS];

  // Skip validation if no patterns defined for this lane
  if (!patterns) {
    return {
      hasWarnings: false,
      warnings: [],
      violations: [],
      skipped: true,
    };
  }

  const { exclude = [], allowExceptions = [] } = patterns;

  // Find violations: paths that match exclude patterns but NOT exception patterns
  const violations = codePaths.filter((codePath) => {
    const matchesExclude = micromatch.isMatch(codePath, exclude, { nocase: true });
    if (!matchesExclude) return false;

    if (allowExceptions.length > 0) {
      const matchesException = micromatch.isMatch(codePath, allowExceptions, { nocase: true });
      if (matchesException) return false;
    }

    return true;
  });

  if (violations.length === 0) {
    return {
      hasWarnings: false,
      warnings: [],
      violations: [],
      skipped: false,
    };
  }

  // Build warning messages
  const warnings = violations.map((violatingPath) => {
    return `Lane "${lane}" typically doesn't include "${violatingPath}" (expected for different lane)`;
  });

  return {
    hasWarnings: true,
    warnings,
    violations,
    skipped: false,
  };
}

// ============================================================================
// CODE QUALITY VALIDATION (MODE: 'quality')
// ============================================================================

/**
 * Scan a file for TODO/FIXME/HACK/XXX comments
 * @param {string} filePath - Path to file to scan
 * @returns {{found: boolean, matches: Array<{line: number, text: string, pattern: string}>}}
 */
function scanFileForTODOs(filePath: string): {
  found: boolean;
  matches: Array<{ line: number; text: string; pattern: string | null }>;
} {
  if (!existsSync(filePath)) {
    return { found: false, matches: [] };
  }

  if (isTestFile(filePath)) {
    return { found: false, matches: [] };
  }

  if (isMarkdownFile(filePath)) {
    return { found: false, matches: [] };
  }

  try {
    const content = readFileSync(filePath, { encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);
    const matches: Array<{ line: number; text: string; pattern: string | null }> = [];

    const checkForActionableMarker = (line: string): { found: boolean; pattern: string | null } => {
      const trimmed = line.trim();

      // Skip documentation lines
      if (trimmed.includes('// TODO:,') || trimmed.includes('/* TODO */')) {
        return { found: false, pattern: null };
      }
      if (trimmed.includes('@todo,') || trimmed.includes('@-prefixed:')) {
        return { found: false, pattern: null };
      }

      // Pattern 1: @-prefixed tags at start of JSDoc comment line
      const atTagMatch = trimmed.match(/^\*\s+@(todo|fixme|hack|xxx)\b/i);
      if (atTagMatch) {
        const atTag = atTagMatch[1];
        return atTag
          ? { found: true, pattern: atTag.toUpperCase() }
          : { found: false, pattern: null };
      }

      // Pattern 2: Keyword at start of comment content
      const commentStartMatch = trimmed.match(
        /^(?:\/\/|\/\*+|\*|<!--|#)\s*(TODO|FIXME|HACK|XXX)(?::|[\s]|$)/i,
      );
      if (commentStartMatch) {
        const commentKeyword = commentStartMatch[1];
        if (!commentKeyword) {
          return { found: false, pattern: null };
        }
        const afterKeyword = trimmed.slice(trimmed.indexOf(commentKeyword) + commentKeyword.length);
        if (!afterKeyword.startsWith('/')) {
          return { found: true, pattern: commentKeyword.toUpperCase() };
        }
      }

      // Pattern 3: Keyword in inline comment after code
      const inlineCommentMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)(?::|[\s]|$)/i);
      if (inlineCommentMatch && !line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)\//i)) {
        const inlineKeyword = inlineCommentMatch[1];
        if (!inlineKeyword) {
          return { found: false, pattern: null };
        }
        const doubleSlashIndex = line.indexOf('//');
        const beforeSlash = line.slice(0, doubleSlashIndex);
        const singleQuotes = (beforeSlash.match(/(?<!\\)'/g) || []).length;
        const doubleQuotes = (beforeSlash.match(/(?<!\\)"/g) || []).length;
        const backticks = (beforeSlash.match(/(?<!\\)`/g) || []).length;
        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
          return { found: false, pattern: null };
        }

        const commentPart = line.slice(doubleSlashIndex);
        const keywordIndex = commentPart.search(/\b(TODO|FIXME|HACK|XXX)\b/i);
        if (keywordIndex >= 0 && keywordIndex <= INLINE_KEYWORD_MAX_OFFSET) {
          return { found: true, pattern: inlineKeyword.toUpperCase() };
        }
      }

      // Exclude WU-XXX placeholders
      if (trimmed.match(/\bWU-XXX\b/i)) {
        return { found: false, pattern: null };
      }

      return { found: false, pattern: null };
    };

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmed = line.trim();

      const isComment =
        /^(\/\/|\/\*|\*|<!--|#)/.test(trimmed) || line.includes('//') || line.includes('/*');

      if (isComment) {
        const result = checkForActionableMarker(line);
        if (result.found) {
          matches.push({
            line: lineNumber,
            text: trimmed,
            pattern: result.pattern,
          });
        }
      }
    });

    return { found: matches.length > 0, matches };
  } catch {
    return { found: false, matches: [] };
  }
}

/**
 * Scan a file for Mock/Stub/Fake class/function names
 * @param {string} filePath - Path to file to scan
 * @returns {{found: boolean, matches: Array<{line: number, text: string, type: string}>}}
 */
function scanFileForMocks(filePath: string): {
  found: boolean;
  matches: Array<{ line: number; text: string; type: string }>;
} {
  if (!existsSync(filePath)) {
    return { found: false, matches: [] };
  }

  if (isTestFile(filePath)) {
    return { found: false, matches: [] };
  }

  try {
    const content = readFileSync(filePath, { encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);
    const matches: Array<{ line: number; text: string; type: string }> = [];

    const mockPatterns = [
      { name: 'Mock', regex: /\b(class|export\s+class)\s+(\w*Mock\w*)/i },
      { name: 'Stub', regex: /\b(class|export\s+class)\s+(\w*Stub\w*)/i },
      { name: 'Fake', regex: /\b(class|export\s+class)\s+(\w*Fake\w*)/i },
      { name: 'Placeholder', regex: /\b(class|export\s+class)\s+(\w*Placeholder\w*)/i },
      { name: 'Mock', regex: /\b(function|const|let|var)\s+(\w*mock\w*)/i },
      { name: 'Stub', regex: /\b(function|const|let|var)\s+(\w*stub\w*)/i },
      { name: 'Fake', regex: /\b(function|const|let|var)\s+(\w*fake\w*)/i },
      { name: 'Placeholder', regex: /\b(function|const|let|var)\s+(\w*placeholder\w*)/i },
    ];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      mockPatterns.forEach(({ name, regex }) => {
        const match = regex.exec(line);
        if (match) {
          matches.push({
            line: lineNumber,
            text: line.trim(),
            type: name,
          });
        }
      });
    });

    return { found: matches.length > 0, matches };
  } catch {
    return { found: false, matches: [] };
  }
}

/**
 * Format TODO findings for display
 * @param {Array} findings - TODO findings
 * @returns {string} Formatted message
 */
function formatTODOFindings(
  findings: Array<{ path: string; matches: Array<{ line: number; text: string }> }>,
): string {
  let msg = '\n❌ TODO/FIXME/HACK/XXX comments found in production code:\n';

  findings.forEach(({ path: filePath, matches }) => {
    msg += `\n  ${filePath}:\n`;
    matches.forEach(({ line, text }) => {
      msg += `    Line ${line}: ${text}\n`;
    });
  });

  msg += '\nThese indicate incomplete work and must be resolved before WU completion.';
  msg += '\nEither complete the work or use --allow-todo with justification in WU notes.';

  return msg;
}

/**
 * Format Mock findings for display
 * @param {Array} findings - Mock findings
 * @returns {string} Formatted message
 */
function formatMockFindings(
  findings: Array<{ path: string; matches: Array<{ line: number; text: string }> }>,
): string {
  let msg = '\n⚠️  Mock/Stub/Fake/Placeholder classes found in production code:\n';

  findings.forEach(({ path: filePath, matches }) => {
    msg += `\n  ${filePath}:\n`;
    matches.forEach(({ line, text }) => {
      msg += `    Line ${line}: ${text}\n`;
    });
  });

  msg += '\nThese suggest incomplete implementation (interface ≠ implementation).';
  msg += '\nVerify these are actual implementations, not placeholder code.';

  return msg;
}

/**
 * Validate code quality (TODOs, mocks)
 * @param {string[]} codePaths - Array of file paths
 * @param {object} options - Options
 * @param {boolean} options.allowTodos - Allow TODO comments (with warning)
 * @param {string} options.worktreePath - Worktree path for file lookups
 * @returns {QualityValidationResult} Validation result
 */
function validateCodeQuality(
  codePaths: string[],
  options: QualityOptions = {},
): QualityValidationResult {
  const { allowTodos = false, worktreePath = null } = options;
  const errors: string[] = [];
  const warnings: string[] = [];
  const repoRoot = worktreePath || getRepoRoot();

  if (!codePaths || codePaths.length === 0) {
    return { valid: true, errors, warnings };
  }

  const todoFindings: Array<{
    path: string;
    found: boolean;
    matches: Array<{ line: number; text: string; pattern: string | null }>;
  }> = [];
  const mockFindings: Array<{
    path: string;
    found: boolean;
    matches: Array<{ line: number; text: string; type: string }>;
  }> = [];

  for (const codePath of codePaths) {
    const absolutePath = path.join(repoRoot, codePath);

    if (!existsSync(absolutePath)) {
      errors.push(
        `\n❌ Code path validation failed: File does not exist: ${codePath}\n\n` +
          `This indicates the WU claims to have created/modified a file that doesn't exist.\n` +
          `Either create the file, or remove it from code_paths in the WU YAML.\n`,
      );
      continue;
    }

    const todoResult = scanFileForTODOs(absolutePath);
    if (todoResult.found) {
      todoFindings.push({ path: codePath, ...todoResult });
    }

    const mockResult = scanFileForMocks(absolutePath);
    if (mockResult.found) {
      mockFindings.push({ path: codePath, ...mockResult });
    }
  }

  if (todoFindings.length > 0) {
    const message = formatTODOFindings(todoFindings);
    if (allowTodos) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }

  if (mockFindings.length > 0) {
    warnings.push(formatMockFindings(mockFindings));
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// UNIFIED VALIDATE API
// ============================================================================

/**
 * Unified code path validation function
 *
 * @param {string[]} codePaths - Array of file paths to validate
 * @param {object} options - Validation options
 * @param {string} options.mode - Validation mode: 'exist', 'lane', or 'quality'
 * @param {string} [options.worktreePath] - Worktree path (for 'exist' and 'quality' modes)
 * @param {string} [options.targetBranch] - Target branch (for 'exist' mode, branch-only)
 * @param {string} [options.lane] - Lane name (for 'lane' mode)
 * @param {boolean} [options.allowTodos] - Allow TODO comments (for 'quality' mode)
 * @returns {Promise<ExistValidationResult|LaneValidationResult|QualityValidationResult>}
 */
export async function validate(
  codePaths: string[],
  options: ValidateOptions = {},
): Promise<ExistValidationResult | LaneValidationResult | QualityValidationResult> {
  const { mode = VALIDATION_MODES.EXIST } = options;

  switch (mode) {
    case VALIDATION_MODES.EXIST: {
      const { worktreePath, targetBranch = BRANCHES.MAIN } = options;

      if (!codePaths || codePaths.length === 0) {
        return { valid: true, errors: [], missing: [] };
      }

      if (worktreePath && existsSync(worktreePath)) {
        return validateExistenceInWorktree(codePaths, worktreePath);
      }

      return validateExistenceOnBranch(codePaths, targetBranch);
    }

    case VALIDATION_MODES.LANE: {
      const { lane } = options;
      if (!lane) {
        throw createError(
          ErrorCodes.INVALID_ARGUMENT,
          'Lane name is required for lane validation mode',
        );
      }
      return validateLanePatterns(codePaths, lane);
    }

    case VALIDATION_MODES.QUALITY: {
      const { worktreePath, allowTodos } = options;
      return validateCodeQuality(codePaths, { worktreePath, allowTodos });
    }

    default:
      throw createError(ErrorCodes.INVALID_ARGUMENT, `Unknown validation mode: ${mode}`);
  }
}

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// These re-export the original function signatures for consumers
// that haven't migrated to the unified API yet.
// ============================================================================

// WU-2044: Use canonical WUDocBase instead of local definition
type WUDoc = Pick<import('./wu-doc-types.js').WUDocBase, 'code_paths'>;

interface ExistOptions {
  targetBranch?: string;
  worktreePath?: string | null;
}

/**
 * @deprecated Use validate(paths, { mode: 'exist' }) instead
 * Backward-compatible wrapper for validateCodePathsExist
 */
export async function validateCodePathsExist(
  doc: WUDoc,
  _id: string,
  options: ExistOptions = {},
): Promise<ExistValidationResult> {
  const codePaths = doc.code_paths || [];
  const { targetBranch = BRANCHES.MAIN, worktreePath = null } = options;

  if (codePaths.length === 0) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} No code_paths to validate for ${_id}`);
    return { valid: true, errors: [], missing: [] };
  }

  console.log(`${LOG_PREFIX.DONE} Validating ${codePaths.length} code_paths exist...`);

  const result = (await validate(codePaths, {
    mode: VALIDATION_MODES.EXIST,
    worktreePath: worktreePath ?? undefined,
    targetBranch,
  })) as ExistValidationResult;

  if (result.valid) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All ${codePaths.length} code_paths verified`);
  }

  return result;
}

/**
 * @deprecated Use validate(paths, { mode: 'lane', lane }) instead
 * Backward-compatible wrapper for validateLaneCodePaths
 * NOTE: This must remain SYNCHRONOUS for backward compatibility
 */
export function validateLaneCodePaths(doc: WUDoc, lane: string): LaneValidationResult {
  const codePaths = doc.code_paths || [];
  // Call the sync internal function directly to maintain sync behavior
  return validateLanePatterns(codePaths, lane);
}

/**
 * @deprecated Use validate(paths, { mode: 'quality' }) instead
 * Backward-compatible wrapper for validateWUCodePaths
 * NOTE: This must remain SYNCHRONOUS for backward compatibility
 */
export function validateWUCodePaths(
  codePaths: string[],
  options: QualityOptions = {},
): QualityValidationResult {
  const { allowTodos = false, worktreePath = null } = options;
  // Call the sync internal function directly to maintain sync behavior
  return validateCodeQuality(codePaths, { worktreePath, allowTodos });
}

/**
 * Log lane validation warnings to console.
 * Helper function to format and display warnings consistently.
 *
 * @param {LaneValidationResult} result - Result from validateLaneCodePaths
 * @param {string} logPrefix - Log prefix (e.g., "[wu-claim]")
 */
export function logLaneValidationWarnings(
  result: LaneValidationResult,
  logPrefix = '[wu-claim]',
): void {
  if (!result.hasWarnings) {
    return;
  }

  console.warn(`${logPrefix} Lane/code_paths mismatch detected (advisory only):`);
  for (const warning of result.warnings) {
    console.warn(`${logPrefix}   ${warning}`);
  }
  console.warn(`${logPrefix} This is a warning only - proceeding with claim.`);
}

// Re-export helper functions for consumers that need them
export { isTestFile, isMarkdownFile, scanFileForTODOs, scanFileForMocks };
