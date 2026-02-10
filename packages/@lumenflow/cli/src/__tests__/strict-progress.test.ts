import { describe, it, expect } from 'vitest';
import {
  parseTypeScriptErrors,
  buildStrictSnapshot,
  compareSnapshotToBaseline,
  type StrictBaseline,
} from '../strict-progress.js';

describe('strict-progress parsing', () => {
  it('parses total errors, code counts, and file counts from tsc output', () => {
    const output = [
      'src/a.ts(10,2): error TS7006: Parameter "x" implicitly has an "any" type.',
      'src/a.ts(12,4): error TS7006: Parameter "y" implicitly has an "any" type.',
      'src/b.ts(5,1): error TS2339: Property "message" does not exist on type "unknown".',
      'noise line that should be ignored',
    ].join('\n');

    const parsed = parseTypeScriptErrors(output);

    expect(parsed.totalErrors).toBe(3);
    expect(parsed.errorCodes).toEqual({
      TS7006: 2,
      TS2339: 1,
    });
    expect(parsed.fileErrors).toEqual({
      'src/a.ts': 2,
      'src/b.ts': 1,
    });
  });

  it('returns empty counts for empty output', () => {
    const parsed = parseTypeScriptErrors('');

    expect(parsed.totalErrors).toBe(0);
    expect(parsed.errorCodes).toEqual({});
    expect(parsed.fileErrors).toEqual({});
  });
});

describe('strict-progress baseline comparison', () => {
  const baseline: StrictBaseline = {
    version: 1,
    generated_at: '2026-02-10T00:00:00.000Z',
    totals: {
      total_errors: 30,
    },
    packages: {
      '@lumenflow/core': {
        total_errors: 20,
        error_codes: { TS7006: 12, TS2339: 8 },
        file_errors: { 'src/core-a.ts': 11, 'src/core-b.ts': 9 },
      },
      '@lumenflow/cli': {
        total_errors: 10,
        error_codes: { TS7006: 6, TS2339: 4 },
        file_errors: { 'src/cli-a.ts': 10 },
      },
    },
  };

  it('reports regressions when package totals increase', () => {
    const snapshot = buildStrictSnapshot([
      {
        packageName: '@lumenflow/core',
        totalErrors: 21,
        errorCodes: { TS7006: 12, TS2339: 9 },
        fileErrors: { 'src/core-a.ts': 11, 'src/core-b.ts': 10 },
      },
      {
        packageName: '@lumenflow/cli',
        totalErrors: 10,
        errorCodes: { TS7006: 6, TS2339: 4 },
        fileErrors: { 'src/cli-a.ts': 10 },
      },
    ]);

    const comparison = compareSnapshotToBaseline(snapshot, baseline);

    expect(comparison.hasRegression).toBe(true);
    expect(comparison.regressions.some((r) => r.includes('@lumenflow/core total errors increased'))).toBe(
      true,
    );
  });

  it('does not report regressions when totals and per-file counts do not increase', () => {
    const snapshot = buildStrictSnapshot([
      {
        packageName: '@lumenflow/core',
        totalErrors: 19,
        errorCodes: { TS7006: 11, TS2339: 8 },
        fileErrors: { 'src/core-a.ts': 10, 'src/core-b.ts': 9 },
      },
      {
        packageName: '@lumenflow/cli',
        totalErrors: 10,
        errorCodes: { TS7006: 6, TS2339: 4 },
        fileErrors: { 'src/cli-a.ts': 10 },
      },
    ]);

    const comparison = compareSnapshotToBaseline(snapshot, baseline);

    expect(comparison.hasRegression).toBe(false);
    expect(comparison.regressions).toEqual([]);
  });

  it('treats new packages in current snapshot as regression when they have errors', () => {
    const snapshot = buildStrictSnapshot([
      {
        packageName: '@lumenflow/core',
        totalErrors: 20,
        errorCodes: { TS7006: 12, TS2339: 8 },
        fileErrors: { 'src/core-a.ts': 11, 'src/core-b.ts': 9 },
      },
      {
        packageName: '@lumenflow/cli',
        totalErrors: 10,
        errorCodes: { TS7006: 6, TS2339: 4 },
        fileErrors: { 'src/cli-a.ts': 10 },
      },
      {
        packageName: '@lumenflow/new-package',
        totalErrors: 1,
        errorCodes: { TS7006: 1 },
        fileErrors: { 'src/new.ts': 1 },
      },
    ]);

    const comparison = compareSnapshotToBaseline(snapshot, baseline);

    expect(comparison.hasRegression).toBe(true);
    expect(
      comparison.regressions.some((r) => r.includes('@lumenflow/new-package has 1 errors with no baseline entry')),
    ).toBe(true);
  });
});
