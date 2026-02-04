/**
 * @fileoverview Regression guard test for path literal centralization (WU-1430)
 *
 * This test ensures that raw `.lumenflow` and `docs/04-operations` literals
 * do not creep back into @lumenflow/core source files outside of:
 * - The constants module (wu-constants.ts)
 * - The config schema module (lumenflow-config-schema.ts)
 * - Test files (__tests__/)
 * - Comments and documentation strings
 *
 * If this test fails, it means someone added a hardcoded path string that
 * should instead use centralized constants from:
 * - LUMENFLOW_PATHS (for .lumenflow directory paths)
 * - DIRECTORIES (for docs/04-operations paths)
 * - WU_PATHS (for configurable path functions)
 *
 * @module __tests__/path-literal-guard.test
 */

import { describe, it, expect } from 'vitest';
import { glob } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Allowed files that can contain raw path literals:
 * - Constants definition files (the source of truth)
 * - Config schema (defines defaults with Zod)
 * - Test files (test assertions may contain literal strings)
 * - This guard test file itself
 */
const ALLOWED_FILES = [
  'wu-constants.ts', // Primary constants source
  'lumenflow-config-schema.ts', // Zod schema with defaults
  'lumenflow-config.ts', // Config file name constant
  'lumenflow-home.ts', // Home directory handling (uses LUMENFLOW_PATHS internally but has docstrings)
  'domain/orchestration.constants.ts', // Domain-specific constants (uses LUMENFLOW_PATHS where possible)
  '__tests__/', // Test files can have literals for assertions
  '__snapshots__/', // Snapshot files
];

/**
 * Patterns to detect raw path literals.
 * These patterns are designed to catch actual string usages, not just comments.
 */
const LITERAL_PATTERNS = {
  /**
   * Matches '.lumenflow' as a standalone path component or at start of path.
   * Catches: '.lumenflow/', '.lumenflow/state', etc.
   * Allows: Comments mentioning .lumenflow
   */
  LUMENFLOW_DIR: /['"`]\.lumenflow[/'"`]/,

  /**
   * Matches 'docs/04-operations' path pattern.
   * Catches: 'docs/04-operations/tasks', 'docs/04-operations/plans', etc.
   */
  DOCS_04_OPERATIONS: /['"`]docs\/04-operations/,
};

/**
 * Check if a line is a comment (single-line or JSDoc)
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('/**')
  );
}

/**
 * Check if a line is a @see or @link reference (documentation)
 */
function isDocReference(line: string): boolean {
  return /@see|@link|@module|@fileoverview/.test(line);
}

/**
 * Check if a line is inside a template string that generates documentation/help text.
 * These are allowed because they show users what paths look like, not functional code.
 * Detects patterns like: return `...`, `## Section`, `- item`, `\`\`\`bash`, etc.
 */
function isTemplateDocumentation(line: string): boolean {
  const trimmed = line.trim();
  // Lines that start a template literal with markdown content
  if (/^return\s+`/.test(trimmed)) return false; // Let the content inside be checked
  // Lines that ARE markdown content inside template literals
  if (/^`?##?\s/.test(trimmed)) return true; // Markdown headers
  if (/^\*\*/.test(trimmed)) return true; // Bold text
  if (/^-\s/.test(trimmed)) return true; // List items
  if (/^\d+\.\s/.test(trimmed)) return true; // Numbered list items
  if (/^```/.test(trimmed)) return true; // Code blocks
  if (/^#\s/.test(trimmed)) return true; // Markdown header
  // Template content that shows examples to users
  if (/cat\s+.*\.lumenflow/.test(line)) return true; // Shell command examples
  if (/mkdir\s+-p\s+.*\.lumenflow/.test(line)) return true; // mkdir examples
  if (/touch\s+.*\.lumenflow/.test(line)) return true; // touch examples
  if (/\$WORKTREE_ROOT\/\.lumenflow/.test(line)) return true; // Variable path examples
  if (/Check\s+`.*\.lumenflow/.test(line)) return true; // Instruction text
  // Backtick-escaped paths in documentation (e.g., `\.lumenflow/path`)
  if (/\\`\.lumenflow/.test(line)) return true; // Escaped backtick paths in template strings
  // Lines explaining what .lumenflow is (e.g., "When creating `.lumenflow/` stamps")
  if (/When\s+creating\s+.*\.lumenflow/.test(line)) return true;
  // Lines that compare/check against a pattern (e.g., "Gates compare test results against")
  if (/compare.*against\s+.*\.lumenflow/.test(line)) return true;
  return false;
}

/**
 * Check if a line is doing pattern matching on user input (not path construction).
 * These are allowed because they check if arbitrary user strings contain a pattern.
 */
function isPatternMatchCheck(line: string): boolean {
  // ref.includes('.lumenflow') - checking if user-provided ref contains pattern
  if (/\.includes\(['"`]\.lumenflow['"`]\)/.test(line)) return true;
  // Similar patterns for other string checks
  if (/\.endsWith\(['"`]\.lumenflow/.test(line)) return true;
  if (/\.startsWith\(['"`]\.lumenflow/.test(line)) return true;
  if (/\.match\(.*\.lumenflow/.test(line)) return true;
  return false;
}

/**
 * Get all TypeScript source files in @lumenflow/core/src, excluding tests
 */
async function getCoreSourceFiles(): Promise<string[]> {
  const coreDir = path.resolve(__dirname, '..');
  const files = await glob('**/*.ts', {
    cwd: coreDir,
    absolute: true,
    ignore: ['**/__tests__/**', '**/__snapshots__/**', '**/dist/**', '**/node_modules/**'],
  });
  return files;
}

/**
 * Check if a file is in the allowed list
 */
function isAllowedFile(filePath: string): boolean {
  return ALLOWED_FILES.some((allowed) => filePath.includes(allowed));
}

/**
 * Scan a file for forbidden literal patterns
 * Returns an array of violations with line numbers and content
 */
function scanFileForLiterals(
  filePath: string,
): Array<{ line: number; content: string; pattern: string }> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Array<{ line: number; content: string; pattern: string }> = [];

  lines.forEach((line, index) => {
    // Skip comment lines, doc references, template documentation, and pattern match checks
    if (
      isCommentLine(line) ||
      isDocReference(line) ||
      isTemplateDocumentation(line) ||
      isPatternMatchCheck(line)
    ) {
      return;
    }

    // Check for .lumenflow literals
    if (LITERAL_PATTERNS.LUMENFLOW_DIR.test(line)) {
      violations.push({
        line: index + 1,
        content: line.trim(),
        pattern: '.lumenflow',
      });
    }

    // Check for docs/04-operations literals
    if (LITERAL_PATTERNS.DOCS_04_OPERATIONS.test(line)) {
      violations.push({
        line: index + 1,
        content: line.trim(),
        pattern: 'docs/04-operations',
      });
    }
  });

  return violations;
}

describe('WU-1430: Path literal regression guard', () => {
  it('should not have raw .lumenflow or docs/04-operations literals in core source files', async () => {
    const sourceFiles = await getCoreSourceFiles();
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; pattern: string }>;
    }> = [];

    for (const file of sourceFiles) {
      // Skip allowed files
      if (isAllowedFile(file)) {
        continue;
      }

      const violations = scanFileForLiterals(file);
      if (violations.length > 0) {
        const relativePath = path.relative(path.resolve(__dirname, '..'), file);
        allViolations.push({ file: relativePath, violations });
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(({ file, violations }) => {
          const details = violations
            .map((v) => `    Line ${v.line}: [${v.pattern}] ${v.content}`)
            .join('\n');
          return `  ${file}:\n${details}`;
        })
        .join('\n\n');

      expect.fail(
        `Found ${allViolations.length} file(s) with hardcoded path literals.\n\n` +
          `These should use centralized constants from wu-constants.ts:\n` +
          `- .lumenflow paths: use LUMENFLOW_PATHS.* constants\n` +
          `- docs/04-operations paths: use DIRECTORIES.* or WU_PATHS.* constants\n\n` +
          `Violations:\n${report}`,
      );
    }

    // If we get here, no violations found - test passes
    expect(allViolations).toHaveLength(0);
  });

  it('should have LUMENFLOW_PATHS constant exported from wu-constants', async () => {
    // Dynamic import to test the actual module exports
    const { LUMENFLOW_PATHS } = await import('../wu-constants.js');

    expect(LUMENFLOW_PATHS).toBeDefined();
    expect(LUMENFLOW_PATHS.BASE).toBe('.lumenflow');
    expect(LUMENFLOW_PATHS.STATE_DIR).toBe('.lumenflow/state');
    expect(LUMENFLOW_PATHS.STAMPS_DIR).toBe('.lumenflow/stamps');
  });

  it('should have DIRECTORIES constant with docs/04-operations paths', async () => {
    const { DIRECTORIES } = await import('../wu-constants.js');

    expect(DIRECTORIES).toBeDefined();
    expect(DIRECTORIES.WU_DIR).toBe('docs/04-operations/tasks/wu');
    expect(DIRECTORIES.INITIATIVES_DIR).toBe('docs/04-operations/tasks/initiatives');
    expect(DIRECTORIES.BACKLOG_PATH).toBe('docs/04-operations/tasks/backlog.md');
    expect(DIRECTORIES.STATUS_PATH).toBe('docs/04-operations/tasks/status.md');
  });
});
