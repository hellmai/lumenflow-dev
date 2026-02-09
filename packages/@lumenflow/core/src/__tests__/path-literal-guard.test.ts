/**
 * @fileoverview Regression guard test for path literal centralization (WU-1430, WU-1539)
 *
 * This test ensures that raw `.lumenflow` and `docs/04-operations` literals
 * do not creep back into @lumenflow/core source files outside of:
 * - The constants module (wu-constants.ts)
 * - The config schema module (lumenflow-config-schema.ts)
 * - Test files (__tests__/)
 * - Comments and documentation strings
 *
 * WU-1539: Expanded to also scan @lumenflow/cli and @lumenflow/initiatives
 * source files for hardcoded .lumenflow/stamps/ and wu-events.jsonl paths.
 * These must use LUMENFLOW_PATHS.STAMPS_DIR, WU_PATHS.STAMP(id), and
 * LUMENFLOW_PATHS.WU_EVENTS instead of inline string literals.
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
  'wu-constants.ts', // Primary constants barrel (re-exports domain modules)
  'wu-paths-constants.ts', // WU-1549: Path constants source-of-truth (extracted from wu-constants.ts)
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
 * WU-1539: Allowed files in CLI and initiatives packages that may contain raw path literals.
 * - Constants definition files (source of truth)
 * - Init/scaffold commands (generate documentation/templates containing literal paths)
 * - Test files (assertions may contain literal strings)
 * - Hooks (shell script generators that embed paths in bash scripts)
 */
const CLI_ALLOWED_FILES = [
  '__tests__/', // Test files
  'e2e/', // E2E test files
  'init.ts', // Scaffold/init generates documentation with literal paths
  'hooks/', // Enforcement hooks generate shell scripts with embedded paths
  'wu-spawn.ts', // Spawn prompt templates contain documentation with literal paths
];

/**
 * WU-1539: Specific banned patterns for stamp and events paths.
 * These are more targeted than the general LITERAL_PATTERNS:
 * they catch local constant definitions that duplicate shared constants.
 */
const BANNED_LOCAL_CONSTANTS = {
  /**
   * Local WU_EVENTS_PATH / WU_EVENTS_FILE constant definitions.
   * These should import LUMENFLOW_PATHS.WU_EVENTS instead.
   */
  WU_EVENTS_LOCAL: /^const\s+(WU_EVENTS_PATH|WU_EVENTS_FILE|SIGNALS_FILE)\s*=/,

  /**
   * Inline stamp path template literals: `.lumenflow/stamps/${...}.done`
   * These should use WU_PATHS.STAMP(id) instead.
   */
  STAMP_TEMPLATE: /[`'"]\.lumenflow\/stamps\/\$\{/,
};

/**
 * WU-1539: Get source files from CLI and initiatives packages for stamp/events scanning
 */
async function getExtendedSourceFiles(): Promise<string[]> {
  const packagesDir = path.resolve(__dirname, '..', '..', '..', '..');
  const cliDir = path.join(packagesDir, '@lumenflow', 'cli', 'src');
  const initiativesDir = path.join(packagesDir, '@lumenflow', 'initiatives', 'src');

  const allFiles: string[] = [];

  for (const dir of [cliDir, initiativesDir]) {
    const files = await glob('**/*.ts', {
      cwd: dir,
      absolute: true,
      ignore: [
        '**/__tests__/**',
        '**/__snapshots__/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/e2e/**',
      ],
    });
    allFiles.push(...files);
  }

  return allFiles;
}

/**
 * WU-1539: Check if a CLI/initiatives file is in the allowed list
 */
function isCliAllowedFile(filePath: string): boolean {
  return CLI_ALLOWED_FILES.some((allowed) => filePath.includes(allowed));
}

/**
 * WU-1539: Scan a file for banned local constant definitions
 */
function scanFileForLocalConstants(
  filePath: string,
): Array<{ line: number; content: string; pattern: string }> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Array<{ line: number; content: string; pattern: string }> = [];

  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;

    if (BANNED_LOCAL_CONSTANTS.WU_EVENTS_LOCAL.test(line.trim())) {
      violations.push({
        line: index + 1,
        content: line.trim(),
        pattern: 'local wu-events constant (use LUMENFLOW_PATHS.WU_EVENTS)',
      });
    }

    if (BANNED_LOCAL_CONSTANTS.STAMP_TEMPLATE.test(line)) {
      violations.push({
        line: index + 1,
        content: line.trim(),
        pattern: 'inline stamp path (use WU_PATHS.STAMP(id))',
      });
    }
  });

  return violations;
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

describe('WU-1539: Stamp and events path literal regression guard', () => {
  it('should not have local WU_EVENTS_PATH/WU_EVENTS_FILE/SIGNALS_FILE constants in CLI or initiatives', async () => {
    const sourceFiles = await getExtendedSourceFiles();
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; pattern: string }>;
    }> = [];

    for (const file of sourceFiles) {
      if (isCliAllowedFile(file)) continue;

      const violations = scanFileForLocalConstants(file);
      if (violations.length > 0) {
        allViolations.push({ file, violations });
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
        `Found ${allViolations.length} file(s) with banned local path constants.\n\n` +
          `These should import shared constants:\n` +
          `- WU_EVENTS_PATH/WU_EVENTS_FILE: use LUMENFLOW_PATHS.WU_EVENTS from @lumenflow/core\n` +
          `- SIGNALS_FILE: use LUMENFLOW_PATHS.MEMORY_SIGNALS from @lumenflow/core\n` +
          `- .lumenflow/stamps/\${id}.done: use WU_PATHS.STAMP(id) from @lumenflow/core\n\n` +
          `Violations:\n${report}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('should not have inline stamp template literals in CLI source files', async () => {
    const sourceFiles = await getExtendedSourceFiles();
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; pattern: string }>;
    }> = [];

    for (const file of sourceFiles) {
      if (isCliAllowedFile(file)) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const violations: Array<{ line: number; content: string; pattern: string }> = [];

      lines.forEach((line, index) => {
        if (isCommentLine(line)) return;
        if (BANNED_LOCAL_CONSTANTS.STAMP_TEMPLATE.test(line)) {
          violations.push({
            line: index + 1,
            content: line.trim(),
            pattern: 'inline stamp path (use WU_PATHS.STAMP(id))',
          });
        }
      });

      if (violations.length > 0) {
        allViolations.push({ file, violations });
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
        `Found ${allViolations.length} file(s) with inline stamp template literals.\n\n` +
          `Use WU_PATHS.STAMP(id) instead of \`.lumenflow/stamps/\${id}.done\`.\n\n` +
          `Violations:\n${report}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('should have LUMENFLOW_PATHS.WU_EVENTS constant available', async () => {
    const { LUMENFLOW_PATHS } = await import('../wu-constants.js');
    expect(LUMENFLOW_PATHS.WU_EVENTS).toBe('.lumenflow/state/wu-events.jsonl');
  });

  it('should have LUMENFLOW_PATHS.STAMPS_DIR constant available', async () => {
    const { LUMENFLOW_PATHS } = await import('../wu-constants.js');
    expect(LUMENFLOW_PATHS.STAMPS_DIR).toBe('.lumenflow/stamps');
  });
});
