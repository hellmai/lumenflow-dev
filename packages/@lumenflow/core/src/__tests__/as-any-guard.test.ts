// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview AST-based guard preventing reintroduction of `as any` casts.
 *
 * WU-2112: Uses TypeScript AST (ts.isAsExpression + ts.SyntaxKind.AnyKeyword)
 * to detect explicit `as any` casts across all 7 runtime packages. Current
 * production count is zero, so this guard uses strict-zero enforcement (not
 * ratcheted). Allowlists test files and e2e files.
 *
 * Pattern follows path-literal-guard.test.ts (WU-2093) and
 * type-safety-guard.test.ts (WU-2110).
 */

import { describe, it, expect } from 'vitest';
import { glob } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanTarget {
  label: string;
  dir: string;
}

interface AsAnyViolation {
  file: string;
  line: number;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

/**
 * Scan all 7 runtime packages -- consistent with path-literal-guard.test.ts
 * and type-safety-guard.test.ts.
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

function getLineText(sourceText: string, lineNumber: number): string {
  const lines = sourceText.split('\n');
  return lines[lineNumber - 1]?.trim() ?? '';
}

/**
 * Uses TypeScript AST to find all `as any` cast expressions.
 * Detects: `expr as any` where the target type is the `any` keyword.
 */
function scanForAsAnyCasts(sourceText: string, fileName: string): AsAnyViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: AsAnyViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
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

function scanFileForAsAny(filePath: string): AsAnyViolation[] {
  const sourceText = readFileSync(filePath, 'utf-8');
  return scanForAsAnyCasts(sourceText, filePath);
}

function formatViolationReport(violations: AsAnyViolation[], maxLines: number = 20): string {
  const lines = violations.slice(0, maxLines).map((v) => `  ${v.file}:${v.line} ${v.snippet}`);

  if (violations.length > maxLines) {
    lines.push(`  ... and ${violations.length - maxLines} more`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WU-2112: as any AST guard', () => {
  it('detects as any cast expressions via AST', () => {
    const source = [
      'const data = JSON.parse("{}") as any;',
      'const typed: string = someValue as any;',
      'const safe: string = "hello";',
      'function process(input: unknown) { return input as any; }',
    ].join('\n');

    const violations = scanForAsAnyCasts(source, 'fixtures/test.ts');

    // Line 1: JSON.parse("{}") as any
    // Line 2: someValue as any
    // Line 4: input as any
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.line)).toEqual([1, 2, 4]);
  });

  it('does not flag "as unknown" or "as string" casts', () => {
    const source = [
      'const a = value as unknown;',
      'const b = value as string;',
      'const c = value as number;',
      'const d = value as Record<string, unknown>;',
    ].join('\n');

    const violations = scanForAsAnyCasts(source, 'fixtures/safe-casts.ts');
    expect(violations).toHaveLength(0);
  });

  it('does not flag string occurrences of "as any" (only type casts)', () => {
    const source = [
      "const msg = 'cast as any is bad';",
      "const comment = '// x as any';",
      'const safe = 42;',
    ].join('\n');

    const violations = scanForAsAnyCasts(source, 'fixtures/strings.ts');
    expect(violations).toHaveLength(0);
  });

  it('detects as any in nested expressions', () => {
    const source = [
      'const result = (obj.method() as any).property;',
      'const arr = [1, 2, 3].map((x) => x as any);',
    ].join('\n');

    const violations = scanForAsAnyCasts(source, 'fixtures/nested.ts');
    expect(violations).toHaveLength(2);
  });
});

describe('WU-2112: as any strict-zero regression guard', () => {
  it('scans all 7 runtime packages for as any casts (strict zero)', async () => {
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
    const allViolations: AsAnyViolation[] = [];
    for (const { files } of filesPerTarget) {
      for (const file of files) {
        const violations = scanFileForAsAny(file);
        allViolations.push(...violations);
      }
    }

    if (allViolations.length > 0) {
      expect.fail(
        `Found ${allViolations.length} "as any" cast(s) in production code.\n\n` +
          `Use proper type narrowing, \`as unknown\`, or discriminated unions instead of \`as any\`.\n` +
          `Violations:\n${formatViolationReport(allViolations)}`,
      );
    }

    // Strict zero: no as any casts allowed in production code
    expect(allViolations).toHaveLength(0);
    console.log('as any guard: 0 violations (strict-zero enforced)');
  });

  it('would fail if a new as any cast were added', () => {
    // Simulate: existing clean code + one new as any cast
    const existingSource = 'const safe: string = "hello";';
    const newSource = [existingSource, 'const data = JSON.parse("{}") as any;'].join('\n');

    const existingViolations = scanForAsAnyCasts(existingSource, 'fixtures/existing.ts');
    const newViolations = scanForAsAnyCasts(newSource, 'fixtures/new.ts');

    // Adding as any increases the count
    expect(newViolations.length).toBeGreaterThan(existingViolations.length);
  });
});
