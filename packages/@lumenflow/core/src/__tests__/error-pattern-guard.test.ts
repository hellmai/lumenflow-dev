// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Ratcheting AST guard for direct `throw new Error()` usage.
 *
 * WU-2111: 209 occurrences of `throw new Error()` across 72 production files
 * in the 7-package scope. The canonical pattern is `createError(ErrorCodes.*)`
 * from error-handler.ts, but nothing enforces it. This guard uses TypeScript
 * AST (ts.isThrowStatement + ts.isNewExpression) to detect direct Error
 * construction across all runtime packages. Dynamic baseline is computed at
 * test-time, persisted in tools/baselines/enforcement/, and the guard fails
 * if count increases (ratchet).
 *
 * Pattern follows type-safety-guard.test.ts (WU-2110) and
 * path-literal-guard.test.ts (WU-2093).
 */

import { describe, it, expect } from 'vitest';
import { glob } from 'glob';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanTarget {
  label: string;
  dir: string;
}

interface ThrowNewErrorViolation {
  file: string;
  line: number;
  snippet: string;
}

interface BaselineData {
  description: string;
  wuId: string;
  lastUpdated: string;
  baseline: number;
  note: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const BASELINE_PATH = path.join(
  REPO_ROOT,
  'tools',
  'baselines',
  'enforcement',
  'throw-new-error-baseline.json',
);

/**
 * Scan all 7 runtime packages -- consistent with type-safety-guard.test.ts
 * and path-literal-guard.test.ts.
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
 * Allowlisted path segments. Files matching any of these are excluded from
 * violation counting:
 * - error-handler.ts: canonical definition file for createError()
 * - __tests__/ directories
 * - .test.ts files
 * - .spec.ts files
 * - e2e/ directories
 * - dist/ directories
 * - node_modules/ directories
 */
const ALLOWLISTED_PATH_SEGMENTS = [
  'error-handler.ts',
  '__tests__/',
  '__snapshots__/',
  '.test.ts',
  '.spec.ts',
  '/e2e/',
  '/dist/',
  '/node_modules/',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

async function getSourceFiles(scanTarget: ScanTarget): Promise<string[]> {
  return glob('**/*.ts', {
    cwd: scanTarget.dir,
    absolute: true,
    ignore: [
      '**/__tests__/**',
      '**/__snapshots__/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/e2e/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
  });
}

function isAllowlistedFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return ALLOWLISTED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

function getLineText(sourceText: string, lineNumber: number): string {
  const lines = sourceText.split('\n');
  return lines[lineNumber - 1]?.trim() ?? '';
}

/**
 * Uses TypeScript AST to find all `throw new Error(...)` statements.
 * Detects: ThrowStatement where the expression is a NewExpression
 * with callee identifier 'Error'.
 */
function scanForThrowNewError(sourceText: string, fileName: string): ThrowNewErrorViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: ThrowNewErrorViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isThrowStatement(node) &&
      node.expression &&
      ts.isNewExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Error'
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      violations.push({
        file: normalizePath(fileName),
        line,
        snippet: getLineText(sourceText, line),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function scanFileForThrowNewError(filePath: string): ThrowNewErrorViolation[] {
  if (isAllowlistedFile(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf-8');
  return scanForThrowNewError(sourceText, filePath);
}

function formatViolationReport(
  violations: ThrowNewErrorViolation[],
  maxLines: number = 20,
): string {
  const lines = violations.slice(0, maxLines).map((v) => `  ${v.file}:${v.line} ${v.snippet}`);

  if (violations.length > maxLines) {
    lines.push(`  ... and ${violations.length - maxLines} more`);
  }

  return lines.join('\n');
}

function loadBaseline(): number | null {
  if (!existsSync(BASELINE_PATH)) {
    return null;
  }

  const raw = readFileSync(BASELINE_PATH, 'utf-8');
  const data = JSON.parse(raw) as BaselineData;

  if (typeof data.baseline !== 'number') {
    return null;
  }

  return data.baseline;
}

function persistBaseline(count: number): void {
  const data: BaselineData = {
    description:
      'Ratcheting baseline for throw new Error() usage. Count must not increase. Use createError(ErrorCodes.*) from error-handler.ts instead.',
    wuId: 'WU-2111',
    lastUpdated: new Date().toISOString().split('T')[0],
    baseline: count,
    note: `Computed from codebase scan. ${count} throw new Error() occurrences across production files.`,
  };

  writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function shouldPersistBaseline(
  savedBaseline: number | null,
  currentCount: number,
  isExplicitUpdate: boolean,
): boolean {
  const isFirstRun = savedBaseline === null;
  const isImprovement = savedBaseline !== null && currentCount < savedBaseline;
  return isFirstRun || isImprovement || isExplicitUpdate;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WU-2111: throw new Error() AST error-pattern guard', () => {
  it('detects throw new Error() via AST', () => {
    const source = [
      "throw new Error('something went wrong');",
      'throw new Error(`template ${msg}`);',
      'const safe = new Error();', // not a throw statement
      "throw createError(ErrorCodes.INVALID, 'msg');", // not new Error
    ].join('\n');

    const violations = scanForThrowNewError(source, 'fixtures/test.ts');

    // Only the two throw new Error() lines should be detected
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.line)).toEqual([1, 2]);
  });

  it('does not flag throw of non-Error constructors', () => {
    const source = [
      "throw new TypeError('type error');",
      "throw new RangeError('out of range');",
      "throw new CustomError('custom');",
      'throw error;', // re-throw variable
    ].join('\n');

    const violations = scanForThrowNewError(source, 'fixtures/no-error.ts');
    expect(violations).toHaveLength(0);
  });

  it('does not flag Error construction without throw', () => {
    const source = [
      "const err = new Error('stored');",
      "return new Error('returned');",
      "const wrapped = wrapError(new Error('inner'));",
    ].join('\n');

    const violations = scanForThrowNewError(source, 'fixtures/no-throw.ts');
    expect(violations).toHaveLength(0);
  });

  it('detects throw new Error() inside nested blocks', () => {
    const source = [
      'function doWork() {',
      '  if (condition) {',
      "    throw new Error('nested');",
      '  }',
      '  try {',
      '    something();',
      '  } catch (e) {',
      "    throw new Error('in catch');",
      '  }',
      '}',
    ].join('\n');

    const violations = scanForThrowNewError(source, 'fixtures/nested.ts');
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.line)).toEqual([3, 8]);
  });

  it('allowlists error-handler.ts', () => {
    expect(isAllowlistedFile('/repo/packages/@lumenflow/core/src/error-handler.ts')).toBe(true);
  });

  it('allowlists test files', () => {
    expect(isAllowlistedFile('/repo/packages/@lumenflow/core/src/__tests__/foo.test.ts')).toBe(
      true,
    );
    expect(isAllowlistedFile('/repo/packages/@lumenflow/cli/src/some.spec.ts')).toBe(true);
    expect(isAllowlistedFile('/repo/packages/@lumenflow/core/src/__tests__/bar.ts')).toBe(true);
  });

  it('does not allowlist production files', () => {
    expect(isAllowlistedFile('/repo/packages/@lumenflow/core/src/wu-yaml.ts')).toBe(false);
    expect(isAllowlistedFile('/repo/packages/@lumenflow/cli/src/wu-claim.ts')).toBe(false);
  });
});

describe('WU-2111: throw new Error() ratcheting regression guard', () => {
  it('scans all 7 runtime packages for throw new Error() occurrences', async () => {
    const filesPerTarget = await Promise.all(
      SCAN_TARGETS.map(async (target) => {
        const files = await getSourceFiles(target);
        return { target: target.label, files };
      }),
    );

    // Verify all scan targets discovered files
    for (const target of filesPerTarget) {
      expect(
        target.files.length,
        `No source files discovered for ${target.target}`,
      ).toBeGreaterThan(0);
    }

    // Collect all violations
    const allViolations: ThrowNewErrorViolation[] = [];
    for (const { files } of filesPerTarget) {
      for (const file of files) {
        const violations = scanFileForThrowNewError(file);
        allViolations.push(...violations);
      }
    }

    const currentCount = allViolations.length;
    const savedBaseline = loadBaseline();

    // WU-2131: Compare before any write. Regression failure path must not
    // mutate baseline state.
    if (savedBaseline !== null && currentCount > savedBaseline) {
      expect.fail(
        `throw new Error() ratchet FAILED: count increased from ${savedBaseline} to ${currentCount} ` +
          `(+${currentCount - savedBaseline}).\n\n` +
          `New throw new Error() detected. Use \`createError(ErrorCodes.*)\` from error-handler.ts instead.\n` +
          `To intentionally update the baseline after a deliberate migration:\n` +
          `  UPDATE_BASELINE=true pnpm --filter @lumenflow/core exec vitest run src/__tests__/error-pattern-guard.test.ts\n\n` +
          `Violations:\n${formatViolationReport(allViolations)}`,
      );
    }

    if (savedBaseline !== null) {
      // Log ratchet status for visibility
      const delta = savedBaseline - currentCount;
      const status = delta > 0 ? `IMPROVED: reduced by ${delta}` : 'STABLE: no change';
      console.log(
        `throw new Error() ratchet: ${currentCount} (baseline: ${savedBaseline}) -- ${status}`,
      );
    } else {
      // First run: baseline established
      console.log(`throw new Error() ratchet: baseline established at ${currentCount} occurrences`);
    }

    // WU-2131: Baseline writes are controlled, never unconditional.
    const isExplicitUpdate = process.env.UPDATE_BASELINE === 'true';
    if (shouldPersistBaseline(savedBaseline, currentCount, isExplicitUpdate)) {
      persistBaseline(currentCount);
      if (isExplicitUpdate && savedBaseline !== null && currentCount === savedBaseline) {
        console.log(`throw new Error() ratchet: baseline explicitly updated to ${currentCount}`);
      }
    }

    // The test itself passes as long as count does not increase
    expect(currentCount).toBeGreaterThanOrEqual(0);
  });

  it('would fail if a new throw new Error() were added', () => {
    // Simulate: existing code + one new throw new Error()
    const existingSource = 'const safe: string = "hello";';
    const newSource = [existingSource, "throw new Error('deliberate violation');"].join('\n');

    const existingViolations = scanForThrowNewError(existingSource, 'fixtures/existing.ts');
    const newViolations = scanForThrowNewError(newSource, 'fixtures/new.ts');

    // Adding throw new Error() increases the count
    expect(newViolations.length).toBeGreaterThan(existingViolations.length);
  });
});

describe('WU-2131: throw new Error() baseline persistence policy', () => {
  it('persists on first run, improvement, or explicit update', () => {
    expect(shouldPersistBaseline(null, 10, false)).toBe(true);
    expect(shouldPersistBaseline(10, 9, false)).toBe(true);
    expect(shouldPersistBaseline(10, 10, true)).toBe(true);
  });

  it('does not persist on unchanged or regressed counts without explicit update', () => {
    expect(shouldPersistBaseline(10, 10, false)).toBe(false);
    expect(shouldPersistBaseline(10, 11, false)).toBe(false);
  });

  it('keeps regression check before baseline write in source order', () => {
    const sourceText = readFileSync(path.join(__dirname, 'error-pattern-guard.test.ts'), 'utf-8');
    const failIndex = sourceText.indexOf('throw new Error() ratchet FAILED');
    const persistAfterFailIndex = sourceText.indexOf('persistBaseline(currentCount)', failIndex);

    expect(failIndex).toBeGreaterThan(-1);
    expect(persistAfterFailIndex).toBeGreaterThan(failIndex);
  });
});
