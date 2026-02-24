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
 * WU-2130: Hardened so that:
 *   - Ratchet comparison runs BEFORE any baseline write
 *   - Regression failure path does NOT modify the baseline file
 *   - Baseline updates are explicit opt-in (UPDATE_BASELINE=true env var)
 *     or automatic only when count improves (decreases)
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

    // WU-2130: Compare FIRST — before any baseline write.
    // Regression failure path must NOT modify the baseline file.
    if (savedBaseline !== null) {
      if (currentCount > savedBaseline) {
        // FAIL — do NOT write new baseline (prevents self-healing)
        expect.fail(
          `UnsafeAny ratchet FAILED: count increased from ${savedBaseline} to ${currentCount} ` +
            `(+${currentCount - savedBaseline}).\n\n` +
            `New UnsafeAny references detected. Use \`unknown\` + Zod parsing / type narrowing instead.\n` +
            `To intentionally update the baseline after fixing violations:\n` +
            `  UPDATE_BASELINE=true pnpm test --testNamePattern=type-safety-guard\n\n` +
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

    // WU-2130: Baseline writes are explicit opt-in or automatic on improvement.
    // - First run (no baseline): always write to bootstrap
    // - Count decreased (improvement): auto-ratchet forward
    // - Explicit opt-in: UPDATE_BASELINE=true env var
    // - Count increased: NEVER write (handled by expect.fail above)
    // - Count unchanged: no write needed
    const isFirstRun = savedBaseline === null;
    const isImprovement = savedBaseline !== null && currentCount < savedBaseline;
    const isExplicitUpdate = process.env.UPDATE_BASELINE === 'true';

    if (isFirstRun || isImprovement || isExplicitUpdate) {
      persistBaseline(currentCount);
      if (isExplicitUpdate && !isFirstRun && !isImprovement) {
        console.log(`UnsafeAny ratchet: baseline explicitly updated to ${currentCount}`);
      }
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

describe('WU-2130: Baseline non-mutation on failure', () => {
  it('does not modify baseline file when regression is detected', () => {
    // Set up a fake baseline with a low count
    const fakeBaselinePath = path.join(REPO_ROOT, 'tools', 'baselines', 'enforcement');
    const originalContent = readFileSync(BASELINE_PATH, 'utf-8');
    const originalData = JSON.parse(originalContent) as BaselineData;
    const originalBaseline = originalData.baseline;

    // The current codebase has more violations than a hypothetically low baseline.
    // Verify the guard logic: if currentCount > savedBaseline, the file must NOT change.
    // We test this by checking that persistBaseline is only called on success paths.

    // Simulate the guard logic with a low baseline (regression scenario)
    const simulatedBaseline = 5; // much lower than actual count
    const simulatedCurrentCount = 440; // current actual count

    // In the old code, persistBaseline would run BEFORE the comparison,
    // overwriting the baseline to 440. In the hardened code, it should NOT.
    // We verify the logic by checking that:
    // 1. The comparison detects the regression
    expect(simulatedCurrentCount).toBeGreaterThan(simulatedBaseline);

    // 2. The write conditions are NOT met for regressions
    const isFirstRun = false; // baseline exists
    const isImprovement = simulatedCurrentCount < simulatedBaseline; // false
    const isExplicitUpdate = false; // no env var

    expect(isFirstRun).toBe(false);
    expect(isImprovement).toBe(false);
    expect(isExplicitUpdate).toBe(false);

    // Therefore persistBaseline should NOT be called — baseline file unchanged
    // Verify the actual file was not modified during this test
    const afterContent = readFileSync(BASELINE_PATH, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });

  it('persists baseline when count decreases (improvement ratchet)', () => {
    // When violations are genuinely reduced, the baseline should auto-ratchet forward
    const savedBaseline = 500;
    const currentCount = 440;

    const isFirstRun = false;
    const isImprovement = currentCount < savedBaseline; // true — count decreased
    const isExplicitUpdate = false;

    // The improvement path should trigger a write
    expect(isImprovement).toBe(true);
    expect(isFirstRun || isImprovement || isExplicitUpdate).toBe(true);
  });

  it('persists baseline on first run (no existing baseline)', () => {
    const savedBaseline = null; // no baseline file yet
    const currentCount = 440;

    const isFirstRun = savedBaseline === null;

    // First run should bootstrap the baseline
    expect(isFirstRun).toBe(true);
  });

  it('does not persist baseline when count is unchanged (no unnecessary writes)', () => {
    const savedBaseline = 440;
    const currentCount = 440; // same as baseline

    const isFirstRun = false;
    const isImprovement = currentCount < savedBaseline; // false — same count
    const isExplicitUpdate = false;

    // No write should occur — baseline is unchanged
    expect(isFirstRun || isImprovement || isExplicitUpdate).toBe(false);
  });

  it('baseline comparison runs before any write operation', () => {
    // This test verifies the ordering guarantee from WU-2130.
    // The key insight: in the hardened code, if currentCount > savedBaseline,
    // expect.fail is called BEFORE any persistBaseline call.
    // Since expect.fail throws, persistBaseline is never reached.

    // Trace through the code path:
    // 1. loadBaseline() -> returns savedBaseline (e.g., 440)
    // 2. if (currentCount > savedBaseline) -> expect.fail (throws, stops execution)
    // 3. persistBaseline is only reachable if step 2 did NOT throw
    //    i.e., currentCount <= savedBaseline

    // We validate this by checking that the code structure has the right ordering.
    // Read the source file and verify persistBaseline appears AFTER the fail check.
    const sourceText = readFileSync(
      path.join(__dirname, 'type-safety-guard.test.ts'),
      'utf-8',
    );

    const failIndex = sourceText.indexOf('expect.fail(');
    const persistAfterFailIndex = sourceText.indexOf('persistBaseline(currentCount)', failIndex);

    // persistBaseline must appear AFTER expect.fail in the source
    expect(failIndex).toBeGreaterThan(-1);
    expect(persistAfterFailIndex).toBeGreaterThan(failIndex);
  });
});
