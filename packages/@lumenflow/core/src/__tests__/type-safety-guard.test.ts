// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Ratcheting AST guard for UnsafeAny type alias usage.
 *
 * WU-2110: UnsafeAny = ReturnType<typeof JSON.parse> resolves to `any`,
 * completely bypassing @typescript-eslint/no-explicit-any. This guard uses
 * TypeScript AST (ts.isTypeReferenceNode) to detect UnsafeAny type references
 * across all runtime packages. Dynamic baseline is computed at test-time,
 * persisted in tools/baselines/enforcement/, and the guard fails if count
 * increases (ratchet).
 *
 * Pattern follows path-literal-guard.test.ts (WU-2093).
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

interface UnsafeAnyViolation {
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

const UNSAFE_ANY_TYPE_NAME = 'UnsafeAny';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const BASELINE_PATH = path.join(
  REPO_ROOT,
  'tools',
  'baselines',
  'enforcement',
  'unsafe-any-baseline.json',
);

/**
 * Scan all 7 runtime packages — consistent with path-literal-guard.test.ts.
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
 * Files that define UnsafeAny are excluded from violation counting.
 * The type alias declarations themselves are not "usage" — they are the
 * definition sites that the guard tracks usage of.
 */
const DEFINITION_FILES = ['types.d.ts'];

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
    ],
  });
}

function isDefinitionFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return DEFINITION_FILES.some((defFile) => normalized.endsWith(defFile));
}

function getLineText(sourceText: string, lineNumber: number): string {
  const lines = sourceText.split('\n');
  return lines[lineNumber - 1]?.trim() ?? '';
}

/**
 * Uses TypeScript AST to find all UnsafeAny type reference nodes.
 * Detects: variable type annotations, function parameters, return types,
 * generic arguments, type assertions, and any other position where
 * UnsafeAny appears as a type reference.
 */
function scanForUnsafeAnyReferences(sourceText: string, fileName: string): UnsafeAnyViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: UnsafeAnyViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === UNSAFE_ANY_TYPE_NAME
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

function scanFileForUnsafeAny(filePath: string): UnsafeAnyViolation[] {
  if (isDefinitionFile(filePath)) {
    return [];
  }

  const sourceText = readFileSync(filePath, 'utf-8');
  return scanForUnsafeAnyReferences(sourceText, filePath);
}

function formatViolationReport(violations: UnsafeAnyViolation[], maxLines: number = 20): string {
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
    description: 'Ratcheting baseline for UnsafeAny type alias usage. Count must not increase.',
    wuId: 'WU-2110',
    lastUpdated: new Date().toISOString().split('T')[0],
    baseline: count,
    note: `Computed from codebase scan. ${count} UnsafeAny references across production files.`,
  };

  writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WU-2110: UnsafeAny AST type-safety guard', () => {
  it('detects UnsafeAny type references via AST', () => {
    const source = [
      "const data: UnsafeAny = JSON.parse('{}')",
      'function process(input: UnsafeAny): UnsafeAny { return input; }',
      'const safe: string = "hello";',
      'type Wrapper = { value: UnsafeAny };',
    ].join('\n');

    const violations = scanForUnsafeAnyReferences(source, 'fixtures/test.ts');

    // Line 1: const data: UnsafeAny
    // Line 2: function process(input: UnsafeAny): UnsafeAny
    // Line 4: type Wrapper = { value: UnsafeAny }
    expect(violations).toHaveLength(4);
    expect(violations.map((v) => v.line)).toEqual([1, 2, 2, 4]);
  });

  it('does not flag string occurrences of UnsafeAny (only type references)', () => {
    const source = [
      "const msg = 'UnsafeAny is a type alias';",
      "const comment = '// UnsafeAny usage';",
      'const safeVar = 42;',
    ].join('\n');

    const violations = scanForUnsafeAnyReferences(source, 'fixtures/no-type.ts');
    expect(violations).toHaveLength(0);
  });

  it('skips definition files (types.d.ts)', () => {
    expect(isDefinitionFile('/repo/packages/@lumenflow/core/src/types.d.ts')).toBe(true);
    expect(isDefinitionFile('/repo/packages/@lumenflow/cli/src/types.d.ts')).toBe(true);
    expect(isDefinitionFile('/repo/packages/@lumenflow/core/src/wu-yaml.ts')).toBe(false);
  });

  it('detects UnsafeAny in generic type arguments', () => {
    const source = [
      'const items: Array<UnsafeAny> = [];',
      'const map: Map<string, UnsafeAny> = new Map();',
    ].join('\n');

    const violations = scanForUnsafeAnyReferences(source, 'fixtures/generics.ts');
    expect(violations).toHaveLength(2);
  });

  it('detects UnsafeAny in type assertions', () => {
    const source = 'const value = data as UnsafeAny;';

    const violations = scanForUnsafeAnyReferences(source, 'fixtures/assertion.ts');
    expect(violations).toHaveLength(1);
  });
});

describe('WU-2110: UnsafeAny ratcheting regression guard', () => {
  it('scans all 7 runtime packages for UnsafeAny references', async () => {
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
    const allViolations: UnsafeAnyViolation[] = [];
    for (const { files } of filesPerTarget) {
      for (const file of files) {
        const violations = scanFileForUnsafeAny(file);
        allViolations.push(...violations);
      }
    }

    const currentCount = allViolations.length;
    const savedBaseline = loadBaseline();

    // Persist baseline: always update to current count so the ratchet
    // moves forward when violations are removed
    persistBaseline(currentCount);

    if (savedBaseline !== null) {
      // Ratchet check: current count must not exceed saved baseline
      if (currentCount > savedBaseline) {
        expect.fail(
          `UnsafeAny ratchet FAILED: count increased from ${savedBaseline} to ${currentCount} ` +
            `(+${currentCount - savedBaseline}).\n\n` +
            `New UnsafeAny references detected. Use \`unknown\` + Zod parsing / type narrowing instead.\n` +
            `Violations:\n${formatViolationReport(allViolations)}`,
        );
      }

      // Log ratchet status for visibility
      const delta = savedBaseline - currentCount;
      const status = delta > 0 ? `IMPROVED: reduced by ${delta}` : 'STABLE: no change';
      console.log(`UnsafeAny ratchet: ${currentCount} (baseline: ${savedBaseline}) -- ${status}`);
    } else {
      // First run: baseline established
      console.log(`UnsafeAny ratchet: baseline established at ${currentCount} references`);
    }

    // The test itself passes as long as count does not increase
    expect(currentCount).toBeGreaterThanOrEqual(0);
  });

  it('would fail if a new UnsafeAny usage were added', () => {
    // Simulate: existing code + one new UnsafeAny reference
    const existingSource = 'const safe: string = "hello";';
    const newSource = [existingSource, 'const data: UnsafeAny = JSON.parse("{}");'].join('\n');

    const existingViolations = scanForUnsafeAnyReferences(existingSource, 'fixtures/existing.ts');
    const newViolations = scanForUnsafeAnyReferences(newSource, 'fixtures/new.ts');

    // Adding UnsafeAny increases the count
    expect(newViolations.length).toBeGreaterThan(existingViolations.length);
  });
});
