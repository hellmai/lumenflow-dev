/**
 * @fileoverview Regression guard test for WU status literal centralization (WU-1548)
 *
 * This test ensures that bare status string literals like 'ready', 'in_progress',
 * 'done', 'blocked' do not appear in @lumenflow production source files outside of
 * approved locations (wu-constants.ts, Zod schemas, state machine, config schema).
 *
 * If this test fails, someone added a bare status string that should instead use
 * WU_STATUS.* constants from wu-constants.ts.
 *
 * Additionally verifies that duplicated MEMORY_DIR, SIGNALS_FILE, and NodeFsError
 * definitions are consolidated to single shared sources.
 *
 * @module __tests__/status-literal-guard.test
 */

import { describe, it, expect } from 'vitest';
import { glob } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WU_STATUS, LUMENFLOW_PATHS, DIRECTORIES } from '../wu-constants.js';

/**
 * Canonical status values that must use WU_STATUS.* constants
 */
const STATUS_LITERALS = [
  'ready',
  'in_progress',
  'done',
  'blocked',
  'completed',
  'cancelled',
  'abandoned',
  'deferred',
  'closed',
  'superseded',
  'todo',
  'backlog',
];

/**
 * Files that are allowed to contain bare status string literals:
 * - wu-constants.ts: the source of truth for WU_STATUS constants
 * - wu-schema.ts: Zod schema defines allowed values
 * - wu-state-schema.ts: State machine schema definitions
 * - state-machine.ts: State machine transition table
 * - lumenflow-config-schema.ts: Config schema defaults
 * - domain/ schemas: Zod schema definitions
 * - Test files: assertions may contain literal strings
 */
const ALLOWED_FILES_STATUS = [
  'wu-constants.ts',
  'wu-schema.ts',
  'wu-state-schema.ts',
  'state-machine.ts',
  'lumenflow-config-schema.ts',
  'domain/',
  'schemas/',
  'ports/',
  'validation/types.ts',
  '__tests__/',
  '__snapshots__/',
  // Files that use status-like strings in non-WU-status contexts:
  'spawn-registry-schema.ts', // Spawn statuses (pending/completed/timeout/crashed/escalated)
  'compliance-checker.ts', // Compliance gap statuses (not_started/in_progress/completed/blocked)
  'commands-logger.ts', // Command outcome statuses (allowed/blocked/unknown)
  'section-headings.ts', // Document type parameter ('backlog'/'status')
  'core/tool.constants.ts', // Tool execution statuses (cancelled/timeout)
];

/**
 * Regex to detect bare status string literals in code contexts.
 * Matches quoted strings that are exactly one of our canonical status values.
 * Does NOT match substrings (e.g., 'ready_to_go' won't match 'ready').
 */
function buildStatusLiteralRegex(): RegExp {
  const statusPattern = STATUS_LITERALS.join('|');
  // Match quoted status strings preceded by common code patterns:
  // === 'status', !== 'status', = 'status', ('status'), : 'status'
  return new RegExp(
    `(?:===?|!==?|[=:(,]|\\b(?:status|doc\\.status))\\s*['"](?:${statusPattern})['"]`,
    'g',
  );
}

const STATUS_LITERAL_REGEX = buildStatusLiteralRegex();

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
 * Get all TypeScript source files in a package, excluding tests and dist
 */
async function getProductionSourceFiles(packageDir: string): Promise<string[]> {
  const files = await glob('**/*.ts', {
    cwd: packageDir,
    absolute: true,
    ignore: [
      '**/__tests__/**',
      '**/__snapshots__/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/e2e/**',
    ],
  });
  return files;
}

/**
 * Check if a file is in the allowed list for status literals
 */
function isAllowedFileForStatus(filePath: string): boolean {
  return ALLOWED_FILES_STATUS.some((allowed) => filePath.includes(allowed));
}

/**
 * Scan a file for bare status string literals
 */
function scanFileForStatusLiterals(
  filePath: string,
): Array<{ line: number; content: string; literal: string }> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Array<{ line: number; content: string; literal: string }> = [];

  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;

    const matches = line.matchAll(STATUS_LITERAL_REGEX);
    for (const match of matches) {
      // Extract the status literal from the match
      const literalMatch = match[0].match(/['"](\w+)['"]/);
      if (literalMatch) {
        violations.push({
          line: index + 1,
          content: line.trim(),
          literal: literalMatch[1],
        });
      }
    }
  });

  return violations;
}

describe('WU-1548: Status literal regression guard', () => {
  it('should not have bare status string literals in @lumenflow/core production source files', async () => {
    const coreDir = path.resolve(__dirname, '..');
    const sourceFiles = await getProductionSourceFiles(coreDir);
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; literal: string }>;
    }> = [];

    for (const file of sourceFiles) {
      if (isAllowedFileForStatus(file)) continue;

      const violations = scanFileForStatusLiterals(file);
      if (violations.length > 0) {
        const relativePath = path.relative(coreDir, file);
        allViolations.push({ file: relativePath, violations });
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(({ file, violations }) => {
          const details = violations
            .map(
              (v) =>
                `    Line ${v.line}: '${v.literal}' -> WU_STATUS.${v.literal.toUpperCase()} | ${v.content}`,
            )
            .join('\n');
          return `  ${file}:\n${details}`;
        })
        .join('\n\n');

      expect.fail(
        `Found ${allViolations.length} file(s) with bare status string literals.\n\n` +
          `These should use WU_STATUS.* constants from wu-constants.ts.\n\n` +
          `Violations:\n${report}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('should not have bare status string literals in @lumenflow/cli production source files', async () => {
    const cliDir = path.resolve(__dirname, '..', '..', '..', '..', 'cli', 'src');
    const sourceFiles = await getProductionSourceFiles(cliDir);
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; literal: string }>;
    }> = [];

    for (const file of sourceFiles) {
      if (isAllowedFileForStatus(file)) continue;

      const violations = scanFileForStatusLiterals(file);
      if (violations.length > 0) {
        const relativePath = path.relative(cliDir, file);
        allViolations.push({ file: relativePath, violations });
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(({ file, violations }) => {
          const details = violations
            .map(
              (v) =>
                `    Line ${v.line}: '${v.literal}' -> WU_STATUS.${v.literal.toUpperCase()} | ${v.content}`,
            )
            .join('\n');
          return `  ${file}:\n${details}`;
        })
        .join('\n\n');

      expect.fail(
        `Found ${allViolations.length} file(s) with bare status string literals.\n\n` +
          `These should use WU_STATUS.* constants from wu-constants.ts.\n\n` +
          `Violations:\n${report}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('should not have bare status string literals in @lumenflow/memory production source files', async () => {
    const memoryDir = path.resolve(__dirname, '..', '..', '..', '..', 'memory', 'src');
    const sourceFiles = await getProductionSourceFiles(memoryDir);
    const allViolations: Array<{
      file: string;
      violations: Array<{ line: number; content: string; literal: string }>;
    }> = [];

    for (const file of sourceFiles) {
      if (isAllowedFileForStatus(file)) continue;

      const violations = scanFileForStatusLiterals(file);
      if (violations.length > 0) {
        const relativePath = path.relative(memoryDir, file);
        allViolations.push({ file: relativePath, violations });
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(({ file, violations }) => {
          const details = violations
            .map(
              (v) =>
                `    Line ${v.line}: '${v.literal}' -> WU_STATUS.${v.literal.toUpperCase()} | ${v.content}`,
            )
            .join('\n');
          return `  ${file}:\n${details}`;
        })
        .join('\n\n');

      expect.fail(
        `Found ${allViolations.length} file(s) with bare status string literals.\n\n` +
          `These should use WU_STATUS.* constants from wu-constants.ts.\n\n` +
          `Violations:\n${report}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it('should not have duplicated MEMORY_DIR definitions in production code', async () => {
    const packagesDir = path.resolve(__dirname, '..', '..', '..', '..');
    const sourceFiles = await glob('**/src/**/*.ts', {
      cwd: packagesDir,
      absolute: true,
      ignore: ['**/__tests__/**', '**/dist/**', '**/node_modules/**', '**/e2e/**'],
    });

    const duplicates: Array<{ file: string; line: number; content: string }> = [];
    const MEMORY_DIR_PATTERN = /(?:const|let|var)\s+MEMORY_DIR\s*=/;

    for (const file of sourceFiles) {
      // Allow the canonical source (wu-constants.ts)
      if (file.includes('wu-constants.ts')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (MEMORY_DIR_PATTERN.test(line)) {
          duplicates.push({
            file: path.relative(packagesDir, file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    if (duplicates.length > 0) {
      const report = duplicates.map((d) => `  ${d.file}:${d.line}: ${d.content}`).join('\n');

      expect.fail(
        `Found ${duplicates.length} duplicated MEMORY_DIR definition(s).\n\n` +
          `Use LUMENFLOW_PATHS.MEMORY_DIR from @lumenflow/core/wu-constants instead.\n\n` +
          `Duplicates:\n${report}`,
      );
    }

    expect(duplicates).toHaveLength(0);
  });

  it('should not have duplicated SIGNALS_FILE definitions in production code', async () => {
    const packagesDir = path.resolve(__dirname, '..', '..', '..', '..');
    const sourceFiles = await glob('**/src/**/*.ts', {
      cwd: packagesDir,
      absolute: true,
      ignore: ['**/__tests__/**', '**/dist/**', '**/node_modules/**', '**/e2e/**'],
    });

    const duplicates: Array<{ file: string; line: number; content: string }> = [];
    const SIGNALS_FILE_PATTERN = /(?:const|let|var)\s+SIGNALS_FILE\s*=/;

    for (const file of sourceFiles) {
      if (file.includes('wu-constants.ts')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (SIGNALS_FILE_PATTERN.test(line)) {
          duplicates.push({
            file: path.relative(packagesDir, file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    if (duplicates.length > 0) {
      const report = duplicates.map((d) => `  ${d.file}:${d.line}: ${d.content}`).join('\n');

      expect.fail(
        `Found ${duplicates.length} duplicated SIGNALS_FILE definition(s).\n\n` +
          `Use LUMENFLOW_PATHS.MEMORY_SIGNALS from @lumenflow/core/wu-constants instead.\n\n` +
          `Duplicates:\n${report}`,
      );
    }

    expect(duplicates).toHaveLength(0);
  });

  it('should not have duplicated NodeFsError interface definitions in production code', async () => {
    const packagesDir = path.resolve(__dirname, '..', '..', '..', '..');
    const sourceFiles = await glob('**/src/**/*.ts', {
      cwd: packagesDir,
      absolute: true,
      ignore: ['**/__tests__/**', '**/dist/**', '**/node_modules/**', '**/e2e/**'],
    });

    const definitions: Array<{ file: string; line: number; content: string }> = [];
    const NODE_FS_ERROR_PATTERN = /interface\s+NodeFsError\s+extends/;

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (NODE_FS_ERROR_PATTERN.test(line)) {
          definitions.push({
            file: path.relative(packagesDir, file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    // There should be exactly 1 definition (the shared source)
    if (definitions.length > 1) {
      const report = definitions.map((d) => `  ${d.file}:${d.line}: ${d.content}`).join('\n');

      expect.fail(
        `Found ${definitions.length} NodeFsError interface definitions (expected 1 shared source).\n\n` +
          `Consolidate to a single shared definition and re-export.\n\n` +
          `Definitions:\n${report}`,
      );
    }

    expect(definitions.length).toBeLessThanOrEqual(1);
  });

  it('should have WU_STATUS constants that match canonical status values', () => {
    expect(WU_STATUS.READY).toBe('ready');
    expect(WU_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(WU_STATUS.DONE).toBe('done');
    expect(WU_STATUS.BLOCKED).toBe('blocked');
    expect(WU_STATUS.COMPLETED).toBe('completed');
    expect(WU_STATUS.CANCELLED).toBe('cancelled');
    expect(WU_STATUS.ABANDONED).toBe('abandoned');
    expect(WU_STATUS.DEFERRED).toBe('deferred');
    expect(WU_STATUS.CLOSED).toBe('closed');
    expect(WU_STATUS.SUPERSEDED).toBe('superseded');
    expect(WU_STATUS.TODO).toBe('todo');
    expect(WU_STATUS.BACKLOG).toBe('backlog');
  });

  it('should have LUMENFLOW_PATHS.MEMORY_DIR for consolidated memory path', () => {
    expect(LUMENFLOW_PATHS.MEMORY_DIR).toBe('.lumenflow/memory');
  });

  it('should have hardcoded task paths replaced with DIRECTORIES.WU_DIR', async () => {
    const coreDir = path.resolve(__dirname, '..');
    const sourceFiles = await getProductionSourceFiles(coreDir);

    // Files allowed to use hardcoded paths (constants definitions, config schemas)
    const allowedForPaths = [
      'wu-constants.ts',
      'lumenflow-config-schema.ts',
      'wu-paths.ts',
      '__tests__/',
    ];

    const violations: Array<{ file: string; line: number; content: string }> = [];
    const TASK_PATH_PATTERN =
      /['"]docs\/04-operations\/tasks(?:\/(?:wu|backlog\.md|status\.md|initiatives))/;

    for (const file of sourceFiles) {
      if (allowedForPaths.some((allowed) => file.includes(allowed))) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (isCommentLine(line)) return;
        if (TASK_PATH_PATTERN.test(line)) {
          violations.push({
            file: path.relative(coreDir, file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}:${v.line}: ${v.content}`).join('\n');

      expect.fail(
        `Found ${violations.length} hardcoded task path(s) in @lumenflow/core.\n\n` +
          `Use DIRECTORIES.WU_DIR, DIRECTORIES.BACKLOG_PATH, DIRECTORIES.STATUS_PATH, ` +
          `or DIRECTORIES.INITIATIVES_DIR instead.\n\n` +
          `Violations:\n${report}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
