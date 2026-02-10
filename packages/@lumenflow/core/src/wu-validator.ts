#!/usr/bin/env node
/**
 * WU Validator - Enforces code quality rules from Definition of Done
 *
 * Validates WU completion requirements:
 * - No TODO/FIXME/HACK/XXX comments in production code
 * - No Mock/Stub/Fake classes in production code
 * - Excludes test files from scans
 * - Excludes markdown files from TODO scans (documentation prose)
 *
 * Used by wu:done before creating stamp.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { STDIO } from './wu-constants.js';
import { PLACEHOLDER_SENTINEL } from './wu-schema.js';

/**
 * Check if a file path is a test file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is a test file
 */
export function isTestFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  // Test file patterns
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
export function isMarkdownFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return /\.md$/i.test(normalized);
}

/**
 * Scan a file for TODO/FIXME/HACK/XXX comments
 * @param {string} filePath - Path to file to scan
 * @returns {{found: boolean, matches: Array<{line: number, text: string, pattern: string}>}}
 */
export function scanFileForTODOs(filePath) {
  if (!existsSync(filePath)) {
    return { found: false, matches: [] };
  }

  // Skip test files
  if (isTestFile(filePath)) {
    return { found: false, matches: [] };
  }

  // Skip markdown files (documentation prose often mentions TODO in workflow explanations)
  if (isMarkdownFile(filePath)) {
    return { found: false, matches: [] };
  }

  try {
    const content = readFileSync(filePath, { encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);
    const matches = [];

    // Match TODO/FIXME/HACK/XXX as actionable markers in comments
    // Covers: // TODO:, /* TODO */, * TODO, <!-- TODO -->, # TODO, @todo, etc.
    //
    // WU-1807: Tightened detection to prevent false positives:
    // - Only matches markers at the START of comment text (after comment symbol)
    // - Excludes slash-separated keyword lists like "TODO/FIXME/HACK" (documentation)
    // - Excludes WU-XXX placeholders (not an XXX marker)
    // - Excludes keywords appearing mid-sentence in prose
    //
    // Pattern explanation:
    // - Comment start: ^[\s]*(\/\/|\/\*+|\*|<!--|#)[\s]* captures comment prefixes
    // - Keyword at start: TODO/FIXME/HACK/XXX immediately after comment start
    // - Or @-prefixed: @todo, @fixme, @hack, @xxx anywhere in comment

    /**
     * Check if a line contains an actionable TODO/FIXME/HACK/XXX marker
     * @param {string} line - Line to check
     * @returns {{found: boolean, pattern: string|null}} Match result
     */
    const checkForActionableMarker = (line) => {
      const trimmed = line.trim();

      // Skip lines that are documentation about the patterns themselves
      // These contain keywords as examples, not actionable markers
      if (trimmed.includes('// TODO:,') || trimmed.includes('/* TODO */')) {
        return { found: false, pattern: null };
      }
      if (trimmed.includes('@todo,') || trimmed.includes('@-prefixed:')) {
        return { found: false, pattern: null };
      }

      // Pattern 1: @-prefixed tags at start of JSDoc comment line
      // Matches: * @todo Implement this
      // Does NOT match: // mentions @todo in documentation
      const atTagMatch = trimmed.match(/^\*\s+@(todo|fixme|hack|xxx)\b/i);
      if (atTagMatch) {
        return { found: true, pattern: atTagMatch[1].toUpperCase() };
      }

      // Pattern 2: Keyword at start of comment content
      // Matches: // TODO:, /* TODO, * TODO, # TODO, <!-- TODO
      // Does NOT match: // mentions TODO in workflow, // TODO/FIXME/HACK list
      const commentStartMatch = trimmed.match(
        /^(?:\/\/|\/\*+|\*|<!--|#)\s*(TODO|FIXME|HACK|XXX)(?::|[\s]|$)/i,
      );
      if (commentStartMatch) {
        // Check it is not followed by / (slash-separated list)
        const afterKeyword = trimmed.slice(
          trimmed.indexOf(commentStartMatch[1]) + commentStartMatch[1].length,
        );
        if (!afterKeyword.startsWith('/')) {
          return { found: true, pattern: commentStartMatch[1].toUpperCase() };
        }
      }

      // Pattern 3: Keyword in inline comment after code
      // Matches: someCode(); // TODO: fix this
      // Does NOT match: someCode(); // mentions TODO in prose
      // Does NOT match: error('// TODO'); (// inside string literal)
      const inlineCommentMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)(?::|[\s]|$)/i);
      if (inlineCommentMatch && !line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)\//i)) {
        // Verify the // is not inside a string literal
        const doubleSlashIndex = line.indexOf('//');
        const beforeSlash = line.slice(0, doubleSlashIndex);
        // Count unescaped quotes - if odd number, we're inside a string
        const singleQuotes = (beforeSlash.match(/(?<!\\)'/g) || []).length;
        const doubleQuotes = (beforeSlash.match(/(?<!\\)"/g) || []).length;
        const backticks = (beforeSlash.match(/(?<!\\)`/g) || []).length;
        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
          // The // is inside a string literal, not a real comment
          return { found: false, pattern: null };
        }

        // Verify the keyword is right after // (not buried in prose)
        const commentPart = line.slice(doubleSlashIndex);
        const keywordIndex = commentPart.search(/\b(TODO|FIXME|HACK|XXX)\b/i);
        // Only flag if keyword appears within first 10 chars of comment
        if (keywordIndex >= 0 && keywordIndex <= 10) {
          return { found: true, pattern: inlineCommentMatch[1].toUpperCase() };
        }
      }

      // Pattern 4: Special check for XXX - must not be preceded by WU-
      // This is handled by patterns above, but add explicit WU-XXX exclusion
      if (trimmed.match(/\bWU-XXX\b/i)) {
        return { found: false, pattern: null };
      }

      return { found: false, pattern: null };
    };

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmed = line.trim();

      // Check if line contains a comment marker
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

    return {
      found: matches.length > 0,
      matches,
    };
  } catch {
    // If file can't be read, skip it
    return { found: false, matches: [] };
  }
}

/**
 * Scan a file for Mock/Stub/Fake class/function names
 * @param {string} filePath - Path to file to scan
 * @returns {{found: boolean, matches: Array<{line: number, text: string, type: string}>}}
 */
export function scanFileForMocks(filePath) {
  if (!existsSync(filePath)) {
    return { found: false, matches: [] };
  }

  // Skip test files
  if (isTestFile(filePath)) {
    return { found: false, matches: [] };
  }

  try {
    const content = readFileSync(filePath, { encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);
    const matches = [];

    // Match Mock/Stub/Fake/Placeholder in class/function/const names
    const mockPatterns = [
      // Classes: class MockService, export class StubAdapter
      { name: 'Mock', regex: /\b(class|export\s+class)\s+(\w*Mock\w*)/i },
      { name: 'Stub', regex: /\b(class|export\s+class)\s+(\w*Stub\w*)/i },
      { name: 'Fake', regex: /\b(class|export\s+class)\s+(\w*Fake\w*)/i },
      { name: 'Placeholder', regex: /\b(class|export\s+class)\s+(\w*Placeholder\w*)/i },
      // Functions: function mockService, const stubAdapter =
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

    return {
      found: matches.length > 0,
      matches,
    };
  } catch {
    // If file can't be read, skip it
    return { found: false, matches: [] };
  }
}

/**
 * Get the repo root directory
 * @returns {string} Absolute path to repo root
 */
function getRepoRoot() {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: [STDIO.PIPE, STDIO.PIPE, STDIO.IGNORE],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Options for validating WU code paths
 */
export interface ValidateWUCodePathsOptions {
  /** Allow TODO comments (with warning) */
  allowTodos?: boolean;
  /** Optional worktree path to validate files from */
  worktreePath?: string | null;
}

/**
 * Validate all code paths for a WU
 * @param {Array<string>} codePaths - Array of file/directory paths from WU YAML
 * @param {ValidateWUCodePathsOptions} options - Validation options
 * @returns {{valid: boolean, errors: Array<string>, warnings: Array<string>}}
 */
export function validateWUCodePaths(codePaths, options: ValidateWUCodePathsOptions = {}) {
  const { allowTodos = false, worktreePath = null } = options;
  const errors = [];
  const warnings = [];
  const repoRoot = worktreePath || getRepoRoot();

  if (!codePaths || codePaths.length === 0) {
    return { valid: true, errors, warnings };
  }

  const todoFindings = [];
  const mockFindings = [];

  // Scan each code path
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

    // Scan for TODOs
    const todoResult = scanFileForTODOs(absolutePath);
    if (todoResult.found) {
      todoFindings.push({ path: codePath, ...todoResult });
    }

    // Scan for Mocks
    const mockResult = scanFileForMocks(absolutePath);
    if (mockResult.found) {
      mockFindings.push({ path: codePath, ...mockResult });
    }
  }

  // Report TODO findings
  if (todoFindings.length > 0) {
    const message = formatTODOFindings(todoFindings);
    if (allowTodos) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }

  // Report Mock findings (always warnings, not errors)
  if (mockFindings.length > 0) {
    warnings.push(formatMockFindings(mockFindings));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format TODO findings for display
 * @param {Array} findings - TODO findings
 * @returns {string} Formatted message
 */
function formatTODOFindings(findings) {
  let msg = '\n❌ TODO/FIXME/HACK/XXX comments found in production code:\n';

  findings.forEach(({ path, matches }) => {
    msg += `\n  ${path}:\n`;
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
function formatMockFindings(findings) {
  let msg = '\n⚠️  Mock/Stub/Fake/Placeholder classes found in production code:\n';

  findings.forEach(({ path, matches }) => {
    msg += `\n  ${path}:\n`;
    matches.forEach(({ line, text }) => {
      msg += `    Line ${line}: ${text}\n`;
    });
  });

  msg += '\nThese suggest incomplete implementation (interface ≠ implementation).';
  msg += '\nVerify these are actual implementations, not placeholder code.';

  return msg;
}

// =============================================================================
// WU-1025: Placeholder Detection for wu:create and wu:claim
// =============================================================================

/**
 * Result of placeholder validation
 */
export interface PlaceholderValidationResult {
  /** Whether validation passed (no placeholders found) */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
  /** Fields that contain placeholders */
  fieldsWithPlaceholders: string[];
}

/**
 * WU-1025: Validate that WU spec content does not contain PLACEHOLDER markers
 *
 * Used by wu:create (for inline content) and wu:claim (for full spec).
 * Provides clear error messages telling the user which fields need to be fixed.
 *
 * @param {object} spec - WU spec content to validate
 * @param {string} [spec.description] - WU description
 * @param {string[]|object} [spec.acceptance] - Acceptance criteria (array or object)
 * @returns {PlaceholderValidationResult} Validation result with errors and affected fields
 *
 * @example
 * // wu:create validation (inline content only)
 * const result = validateNoPlaceholders({ description: args.description });
 * if (!result.valid) {
 *   die(`Cannot create WU:\n${result.errors.join('\n')}`);
 * }
 *
 * @example
 * // wu:claim validation (full spec)
 * const result = validateNoPlaceholders(wuDoc);
 * if (!result.valid) {
 *   die(`Cannot claim WU:\n${result.errors.join('\n')}`);
 * }
 */
export function validateNoPlaceholders(spec: {
  description?: string;
  acceptance?: string[] | Record<string, string[]>;
}): PlaceholderValidationResult {
  const errors: string[] = [];
  const fieldsWithPlaceholders: string[] = [];

  // Check description
  if (spec.description && spec.description.includes(PLACEHOLDER_SENTINEL)) {
    fieldsWithPlaceholders.push('description');
    errors.push(
      `Description contains ${PLACEHOLDER_SENTINEL} marker.\n` +
        `  Fix: Replace placeholder text with actual description.\n` +
        `  Example: --description "Implement X feature to enable Y functionality"`,
    );
  }

  // Check acceptance criteria (supports both array and object formats)
  if (spec.acceptance) {
    const hasPlaceholder = checkForPlaceholderInAcceptance(spec.acceptance);
    if (hasPlaceholder) {
      fieldsWithPlaceholders.push('acceptance');
      errors.push(
        `Acceptance criteria contain ${PLACEHOLDER_SENTINEL} markers.\n` +
          `  Fix: Replace placeholder text with actual acceptance criteria.\n` +
          `  Example: --acceptance "Feature X works as expected" --acceptance "Tests pass"`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    fieldsWithPlaceholders,
  };
}

/**
 * Helper: Recursively check acceptance criteria for placeholder markers
 *
 * Supports both formats:
 * - Flat array: ["criterion 1", "criterion 2"]
 * - Nested object: { functional: ["criterion"], technical: ["criterion"] }
 *
 * @param {string[]|object} acceptance - Acceptance criteria
 * @returns {boolean} True if any placeholder found
 */
function checkForPlaceholderInAcceptance(acceptance: string[] | Record<string, string[]>): boolean {
  if (Array.isArray(acceptance)) {
    return acceptance.some(
      (item) => typeof item === 'string' && item.includes(PLACEHOLDER_SENTINEL),
    );
  }

  if (typeof acceptance === 'object' && acceptance !== null) {
    return Object.values(acceptance).some((value) => {
      if (Array.isArray(value)) {
        return value.some(
          (item) => typeof item === 'string' && item.includes(PLACEHOLDER_SENTINEL),
        );
      }
      return false;
    });
  }

  return false;
}

/**
 * WU-1025: Build error message for placeholder validation failure
 *
 * Creates a user-friendly error message with actionable guidance.
 *
 * @param {string} command - Command that failed ('wu:create' or 'wu:claim')
 * @param {PlaceholderValidationResult} result - Validation result
 * @param {string} [wuId] - WU ID (for wu:claim error messages)
 * @returns {string} Formatted error message
 */
export function buildPlaceholderErrorMessage(
  command: string,
  result: PlaceholderValidationResult,
  wuId?: string,
): string {
  const header =
    command === 'wu:create'
      ? `Cannot create WU with placeholder markers`
      : `Cannot claim ${wuId || 'WU'} - spec contains placeholder markers`;

  const fieldsText = result.fieldsWithPlaceholders.join(', ');

  let message = `
❌ ${header}

Fields with ${PLACEHOLDER_SENTINEL} markers: ${fieldsText}

${result.errors.join('\n\n')}
`;

  if (command === 'wu:claim' && wuId) {
    message += `
To fix, edit the WU spec:
  pnpm wu:edit --id ${wuId} --description "..." --acceptance "..."

Or manually edit: docs/04-operations/tasks/wu/${wuId}.yaml
`;
  }

  return message;
}
