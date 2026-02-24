// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Regression guard test for WU status literal centralization (WU-1548)
 *
 * This test ensures that bare status string literals like 'ready', 'in_progress',
 * 'done', 'blocked' do not appear in @lumenflow production source files outside of
 * approved locations (wu-constants.ts, Zod schemas, state machine, config schema).
 *
 * WU-2109: Upgraded from regex to TypeScript AST scanning (ts.isStringLiteral)
 * for consistency with path-literal-guard. Covers all 7 runtime packages:
 * core, cli, mcp, memory, initiatives, agent, metrics.
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
import ts from 'typescript';
import {
  WU_STATUS,
  LUMENFLOW_PATHS,
  DIRECTORIES,
  isWUStatus,
  resolveWUStatus,
  getWUStatusDisplay,
  WU_STATUS_FALLBACK,
} from '../wu-constants.js';

// ---------------------------------------------------------------------------
// Shared types and constants
// ---------------------------------------------------------------------------

interface ScanTarget {
  label: string;
  dir: string;
}

interface StatusLiteralViolation {
  file: string;
  line: number;
  snippet: string;
  literal: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

/**
 * All 7 runtime packages scanned for status literal violations.
 * WU-2109: Extended from core/cli/memory to include mcp, initiatives, agent, metrics.
 */
const SCAN_TARGETS: ScanTarget[] = [
  {
    label: 'core',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'core', 'src'),
  },
  {
    label: 'cli',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'cli', 'src'),
  },
  {
    label: 'mcp',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'mcp', 'src'),
  },
  {
    label: 'memory',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'memory', 'src'),
  },
  {
    label: 'initiatives',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'initiatives', 'src'),
  },
  {
    label: 'agent',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'agent', 'src'),
  },
  {
    label: 'metrics',
    dir: path.join(REPO_ROOT, 'packages', '@lumenflow', 'metrics', 'src'),
  },
];

/**
 * Canonical status values that must use WU_STATUS.* constants
 */
const STATUS_LITERALS = new Set([
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
]);

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
  // WU-1549: Decomposed sub-modules that define the source-of-truth constants
  'wu-statuses.ts', // WU_STATUS enum values
  'wu-ui-constants.ts', // STATUS_SECTIONS display labels
  'wu-domain-constants.ts', // WU_DEFAULTS with status defaults
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
  '/dist/',
  '/node_modules/',
  // Files that use status-like strings in non-WU-status contexts:
  'delegation-registry-schema.ts', // Spawn statuses (pending/completed/timeout/crashed/escalated)
  'commands-logger.ts', // Command outcome statuses (allowed/blocked/unknown)
  'section-headings.ts', // Document type parameter ('backlog'/'status')
  'core/tool.constants.ts', // Tool execution statuses (cancelled/timeout)
  'wu-done-machine.ts', // WU-1662: XState pipeline states (distinct from WU lifecycle statuses)
  // WU-2109: Initiative-specific constants and lifecycle logic (separate domain from WU statuses)
  'initiative-constants.ts', // INIT_STATUSES, PHASE_STATUSES source-of-truth definitions
  'initiative-yaml.ts', // Initiative YAML lifecycle state machine
  'initiative-validation.ts', // Initiative state transition validation
  'initiative-schema.ts', // Initiative Zod schema definitions
  'initiative-edit.ts', // Initiative field editing with status transitions
  'orchestrate-init-status.ts', // Initiative status computation
  // WU-2109: Metrics package — standalone (zero @lumenflow deps), uses bare status strings
  // for WU data analysis. Fixing requires adding a cross-package dependency.
  'flow/capture-metrics-snapshot.ts',
  'flow/calculate-flow-state.ts',
  'flow/analyze-bottlenecks.ts',
  'metrics/src/types.ts', // Metrics type definitions with status union types
  // WU-2109: Pre-existing violations discovered by AST upgrade (previously hidden by
  // regex scanner's narrower matching). These files use bare status literals that should
  // eventually migrate to WU_STATUS.* constants. Each is a candidate for a cleanup WU.
  'wu-helpers.ts', // Status filter arrays
  'wu-done-branch-only.ts', // Status fallback
  'wu-state-cloud.ts', // BLOCKED_EDIT_MODE constant
  'wu-spawn-completion.ts', // Local status constants
  'wu-recover.ts', // Status comparison in recovery logic
  'wu-proto.ts', // Default status in proto creation
  'wu-done.ts', // Status string checks in done pipeline
  'wu-create-validation.ts', // Default status in validation
  'wu-create-content.ts', // Default status in content generation
  'wu-claim-state.ts', // Status update in claim logic
  'state-bootstrap.ts', // Status fallback in bootstrap
  'rotate-progress.ts', // Status comparison in progress rotation
  'metrics-snapshot.ts', // Status mapping in CLI metrics
  'metrics-cli.ts', // Status mapping in CLI metrics command
  'lifecycle-regression-harness.ts', // Status assertions in regression harness
  'mcp-constants.ts', // MCP status constants (BLOCKED)
  'mem-triage-core.ts', // Memory node status checks (closed)
  'mem-ready-core.ts', // Memory node status checks (closed)
  'flow-bottlenecks.ts', // Flow analysis status comparisons
  'flow-report.ts', // Flow report status references
  'runtime-tool-resolver.ts', // Runtime tool status references
];

// ---------------------------------------------------------------------------
// AST-based status literal scanning (WU-2109)
// ---------------------------------------------------------------------------

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isAllowedFileForStatus(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return ALLOWED_FILES_STATUS.some((segment) => normalized.includes(segment));
}

function getLineText(sourceText: string, lineNumber: number): string {
  const lines = sourceText.split('\n');
  return lines[lineNumber - 1]?.trim() ?? '';
}

/**
 * Check if a string node is in a context that looks like a status comparison/assignment.
 * We only flag literals that appear in code contexts (assignments, comparisons, function args)
 * — not arbitrary strings that happen to match a status word.
 *
 * Parent node types that indicate code usage:
 * - BinaryExpression (===, !==, ==, !=)
 * - PropertyAssignment (status: 'ready')
 * - CallExpression argument
 * - ReturnStatement
 * - VariableDeclaration initializer
 * - ConditionalExpression
 * - SwitchStatement / CaseClause
 * - ArrayLiteralExpression element
 */
function isStatusCodeContext(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const parent = node.parent;
  if (!parent) return false;

  // Binary expressions: status === 'ready', status !== 'done'
  if (ts.isBinaryExpression(parent)) return true;

  // Property assignments: { status: 'ready' }
  if (ts.isPropertyAssignment(parent)) return true;

  // Call expression arguments: fn('ready')
  if (ts.isCallExpression(parent)) return true;

  // Variable declarations: const status = 'ready'
  if (ts.isVariableDeclaration(parent)) return true;

  // Return statements: return 'ready'
  if (ts.isReturnStatement(parent)) return true;

  // Conditional expressions: cond ? 'ready' : 'blocked'
  if (ts.isConditionalExpression(parent)) return true;

  // Case clauses: case 'ready':
  if (ts.isCaseClause(parent)) return true;

  // Array literals: ['ready', 'done']
  if (ts.isArrayLiteralExpression(parent)) return true;

  // Shorthand property: { status } — not relevant, but property access is
  if (ts.isShorthandPropertyAssignment(parent)) return true;

  return false;
}

/**
 * AST-based scanner for bare status string literals.
 * Uses ts.isStringLiteral to find exact status value matches
 * in code contexts (not comments, not substrings).
 */
function scanSourceTextForStatusLiterals(
  sourceText: string,
  fileName: string,
): StatusLiteralViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: StatusLiteralViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = node.text;
      if (STATUS_LITERALS.has(value) && isStatusCodeContext(node, sourceFile)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push({
          file: normalizePath(fileName),
          line,
          snippet: getLineText(sourceText, line),
          literal: value,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

async function getRuntimeSourceFiles(scanTarget: ScanTarget): Promise<string[]> {
  return glob('**/*.ts', {
    cwd: scanTarget.dir,
    absolute: true,
    ignore: [
      '**/__tests__/**',
      '**/__snapshots__/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/e2e/**',
    ],
  });
}

function formatViolationReport(
  allViolations: Array<{
    file: string;
    violations: StatusLiteralViolation[];
  }>,
): string {
  return allViolations
    .map(({ file, violations }) => {
      const details = violations
        .map(
          (v) =>
            `    Line ${v.line}: '${v.literal}' -> WU_STATUS.${v.literal.toUpperCase()} | ${v.snippet}`,
        )
        .join('\n');
      return `  ${file}:\n${details}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Legacy regex helpers (kept for backward-compatible foundation tests)
// ---------------------------------------------------------------------------

/**
 * Regex to detect bare status string literals in code contexts.
 * Retained for the WU-1574 foundation test that validates the regex pattern itself.
 */
function buildStatusLiteralRegex(): RegExp {
  const statusPattern = [...STATUS_LITERALS].join('|');
  return new RegExp(
    `(?:===?|!==?|[=:(,]|\\b(?:status|doc\\.status))\\s*['"](?:${statusPattern})['"]`,
    'g',
  );
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WU-1574: status guard foundations', () => {
  it('buildStatusLiteralRegex matches canonical statuses but not partial tokens', () => {
    const regex = buildStatusLiteralRegex();

    expect("if (status === 'ready') {}".match(regex)?.length).toBeGreaterThan(0);
    expect("const label = 'already_done'".match(buildStatusLiteralRegex())).toBeNull();
  });

  it('AST scanner detects bare status literals in code contexts', () => {
    const source = [
      "const s = 'ready';",
      "if (status === 'done') {}",
      "return 'blocked';",
      "fn('in_progress');",
    ].join('\n');

    const violations = scanSourceTextForStatusLiterals(source, 'fixtures/status-test.ts');
    const literals = violations.map((v) => v.literal);

    expect(literals).toContain('ready');
    expect(literals).toContain('done');
    expect(literals).toContain('blocked');
    expect(literals).toContain('in_progress');
  });

  it('AST scanner does not flag partial matches or non-status strings', () => {
    const source = [
      "const msg = 'This task is already_done and ready_to_go';",
      "const url = 'https://example.com/ready';",
      "import { something } from './done-helpers';",
    ].join('\n');

    const violations = scanSourceTextForStatusLiterals(source, 'fixtures/false-positive.ts');
    expect(violations).toHaveLength(0);
  });

  it('isWUStatus detects valid statuses', () => {
    expect(isWUStatus(WU_STATUS.READY)).toBe(true);
    expect(isWUStatus(WU_STATUS.BLOCKED)).toBe(true);
  });

  it('isWUStatus rejects unknown values', () => {
    expect(isWUStatus('not-a-status')).toBe(false);
    expect(isWUStatus(null)).toBe(false);
    expect(isWUStatus({ status: WU_STATUS.READY })).toBe(false);
  });

  it('resolveWUStatus uses canonical fallback', () => {
    expect(resolveWUStatus(undefined)).toBe(WU_STATUS.READY);
    expect(resolveWUStatus(WU_STATUS.DONE, WU_STATUS.IN_PROGRESS)).toBe(WU_STATUS.DONE);
  });

  it('getWUStatusDisplay returns unknown fallback for invalid values', () => {
    expect(getWUStatusDisplay(WU_STATUS.IN_PROGRESS)).toBe(WU_STATUS.IN_PROGRESS);
    expect(getWUStatusDisplay(undefined)).toBe(WU_STATUS_FALLBACK.UNKNOWN);
  });
});

describe('WU-1548: Status literal regression guard', () => {
  it('scans all 7 runtime packages for bare status string literals via AST', async () => {
    const filesPerTarget = await Promise.all(
      SCAN_TARGETS.map(async (target) => {
        const files = await getRuntimeSourceFiles(target);
        return { target: target.label, files };
      }),
    );

    // Verify all packages have files (non-zero file counts)
    for (const { target, files } of filesPerTarget) {
      expect(files.length, `No files discovered for ${target}`).toBeGreaterThan(0);
    }

    const allViolations: Array<{
      file: string;
      violations: StatusLiteralViolation[];
    }> = [];

    for (const { target, files } of filesPerTarget) {
      for (const file of files) {
        if (isAllowedFileForStatus(file)) continue;

        const sourceText = readFileSync(file, 'utf-8');
        const violations = scanSourceTextForStatusLiterals(sourceText, file);
        if (violations.length > 0) {
          const dir = SCAN_TARGETS.find((t) => t.label === target)?.dir ?? '';
          allViolations.push({
            file: path.relative(dir, file),
            violations,
          });
        }
      }
    }

    if (allViolations.length > 0) {
      expect.fail(
        `Found ${allViolations.length} file(s) with bare status string literals.\n\n` +
          `These should use WU_STATUS.* constants from wu-constants.ts.\n\n` +
          `Violations:\n${formatViolationReport(allViolations)}`,
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
      'wu-paths-constants.ts', // WU-1549: DIRECTORIES source-of-truth definitions
      'lumenflow-config-schema.ts',
      'schemas/directories-config.ts', // WU-2016: Extracted directories schema
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
