/**
 * Tests for coverage-gate
 *
 * WU-1433: TDD for coverage gate with mode flag
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test fixtures use OS temp directory
const TEST_DIR = join(tmpdir(), 'wu-1433-coverage-test');

// Import the functions to test
import {
  parseCoverageJson,
  isHexCoreFile,
  checkCoverageThresholds,
  formatCoverageDelta,
  COVERAGE_GATE_MODES,
  HEX_CORE_PATTERNS,
  COVERAGE_THRESHOLD,
} from '../coverage-gate.js';

describe('coverage-gate constants', () => {
  it('defines COVERAGE_GATE_MODES with warn and block', () => {
    expect(COVERAGE_GATE_MODES.WARN).toBe('warn');
    expect(COVERAGE_GATE_MODES.BLOCK).toBe('block');
  });

  it('defines HEX_CORE_PATTERNS for application layer', () => {
    expect(Array.isArray(HEX_CORE_PATTERNS)).toBe(true);
    expect(HEX_CORE_PATTERNS.length > 0).toBeTruthy();
    // Should include application package pattern
    expect(HEX_CORE_PATTERNS.some((p) => p.includes('application'))).toBe(true);
  });

  it('defines COVERAGE_THRESHOLD as 90', () => {
    expect(COVERAGE_THRESHOLD).toBe(90);
  });
});

describe('isHexCoreFile', () => {
  it('returns true for application package files', () => {
    expect(isHexCoreFile('packages/@exampleapp/application/src/usecases/foo.ts')).toBe(true);
    expect(isHexCoreFile('packages/@exampleapp/application/src/domain/entity.ts')).toBe(true);
  });

  // WU-2448: Coverage reporters emit absolute paths, so isHexCoreFile must handle them
  it('returns true for absolute application package paths', () => {
    expect(
      isHexCoreFile(join(process.cwd(), 'packages/@exampleapp/application/src/usecases/foo.ts'))
    ).toBe(true);
  });

  it('returns false for infrastructure package files', () => {
    expect(isHexCoreFile('packages/@exampleapp/infrastructure/src/adapters/db.ts')).toBe(false);
  });

  it('returns false for web app files', () => {
    expect(isHexCoreFile('apps/web/src/app/page.tsx')).toBe(false);
  });

  it('returns false for tooling files', () => {
    expect(isHexCoreFile('tools/gates.js')).toBe(false);
    expect(isHexCoreFile('tools/lib/coverage-gate.js')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isHexCoreFile(null)).toBe(false);
    expect(isHexCoreFile(undefined)).toBe(false);
  });
});

describe('parseCoverageJson', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('parses coverage-summary.json correctly', () => {
    const coverageData = {
      total: {
        lines: { total: 100, covered: 85, pct: 85 },
        statements: { total: 100, covered: 85, pct: 85 },
        functions: { total: 20, covered: 18, pct: 90 },
        branches: { total: 30, covered: 24, pct: 80 },
      },
      'packages/@exampleapp/application/src/usecases/foo.ts': {
        lines: { total: 50, covered: 48, pct: 96 },
        statements: { total: 50, covered: 48, pct: 96 },
        functions: { total: 10, covered: 10, pct: 100 },
        branches: { total: 15, covered: 14, pct: 93.33 },
      },
    };

    const coveragePath = join(TEST_DIR, 'coverage-summary.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));

    const result = parseCoverageJson(coveragePath);

    expect(result.total).toBeTruthy();
    expect(result.total.lines.pct).toBe(85);
    expect(result.files).toBeTruthy();
    expect(result.files['packages/@exampleapp/application/src/usecases/foo.ts']).toBeTruthy();
  });

  it('returns null for missing file', () => {
    const nonexistentPath = join(TEST_DIR, 'nonexistent-dir', 'coverage.json');
    const result = parseCoverageJson(nonexistentPath);
    expect(result).toBe(null);
  });

  it('returns null for invalid JSON', () => {
    const coveragePath = join(TEST_DIR, 'invalid.json');
    writeFileSync(coveragePath, 'not valid json');

    const result = parseCoverageJson(coveragePath);
    expect(result).toBe(null);
  });
});

describe('checkCoverageThresholds', () => {
  it('returns passing result when all hex core files meet threshold', () => {
    const coverageData = {
      total: { lines: { pct: 85 } },
      files: {
        'packages/@exampleapp/application/src/usecases/foo.ts': {
          lines: { pct: 95 },
          statements: { pct: 95 },
          functions: { pct: 95 },
          branches: { pct: 92 },
        },
      },
    };

    const result = checkCoverageThresholds(coverageData);

    expect(result.pass).toBe(true);
    expect(result.failures.length).toBe(0);
  });

  it('returns failing result when hex core file below threshold', () => {
    const coverageData = {
      total: { lines: { pct: 85 } },
      files: {
        'packages/@exampleapp/application/src/usecases/foo.ts': {
          lines: { pct: 75 },
          statements: { pct: 75 },
          functions: { pct: 75 },
          branches: { pct: 70 },
        },
      },
    };

    const result = checkCoverageThresholds(coverageData);

    expect(result.pass).toBe(false);
    expect(result.failures.length > 0).toBeTruthy();
    expect(result.failures[0].file.includes('foo.ts')).toBe(true);
    expect(result.failures[0].actual).toBe(75);
    expect(result.failures[0].threshold).toBe(90);
  });

  it('ignores non-hex-core files even with low coverage', () => {
    const coverageData = {
      total: { lines: { pct: 85 } },
      files: {
        'apps/web/src/app/page.tsx': {
          lines: { pct: 50 },
          statements: { pct: 50 },
          functions: { pct: 50 },
          branches: { pct: 50 },
        },
        'packages/@exampleapp/application/src/usecases/foo.ts': {
          lines: { pct: 95 },
          statements: { pct: 95 },
          functions: { pct: 95 },
          branches: { pct: 95 },
        },
      },
    };

    const result = checkCoverageThresholds(coverageData);

    expect(result.pass).toBe(true);
    expect(result.failures.length).toBe(0);
  });

  it('handles empty coverage data gracefully', () => {
    const result = checkCoverageThresholds({ total: { lines: { pct: 0 } }, files: {} });

    expect(result.pass).toBe(true);
    expect(result.failures.length).toBe(0);
  });

  it('handles null coverage data gracefully', () => {
    const result = checkCoverageThresholds(null);

    expect(result.pass).toBe(true);
    expect(result.failures.length).toBe(0);
  });
});

describe('formatCoverageDelta', () => {
  it('formats coverage delta for display', () => {
    const coverageData = {
      total: { lines: { pct: 85.5 } },
      files: {
        'packages/@exampleapp/application/src/usecases/foo.ts': {
          lines: { pct: 95.2 },
        },
      },
    };

    const output = formatCoverageDelta(coverageData);

    expect(typeof output === 'string').toBeTruthy();
    expect(output.includes('85.5')).toBe(true);
  });

  it('highlights files below threshold', () => {
    const coverageData = {
      total: { lines: { pct: 85 } },
      files: {
        'packages/@exampleapp/application/src/usecases/foo.ts': {
          lines: { pct: 75 },
        },
      },
    };

    const output = formatCoverageDelta(coverageData);

    expect(output.includes('foo.ts')).toBe(true);
    expect(output.includes('75')).toBe(true);
  });

  it('returns empty string for null data', () => {
    const output = formatCoverageDelta(null);
    expect(output).toBe('');
  });
});

describe('coverage gate integration', () => {
  it('exports runCoverageGate function', async () => {
    const { runCoverageGate } = await import('../coverage-gate.js');
    expect(typeof runCoverageGate === 'function').toBeTruthy();
  });

  it('runCoverageGate accepts mode parameter', async () => {
    const { runCoverageGate, COVERAGE_GATE_MODES } = await import('../coverage-gate.js');

    // Function should accept mode as option and return result object
    // Note: This will need actual coverage file to run properly
    const nonexistentCoveragePath = join(TEST_DIR, 'does-not-exist', 'coverage.json');
    const result = await runCoverageGate({
      mode: COVERAGE_GATE_MODES.WARN,
      coveragePath: nonexistentCoveragePath,
    });

    expect(typeof result === 'object').toBeTruthy();
    expect('ok' in result).toBeTruthy();
    expect('mode' in result).toBeTruthy();
    expect(result.mode).toBe('warn');
  });

  // WU-2448: Block mode must return ok:false when coverage is below threshold (not silent pass)
  it('blocks when coverage is below threshold in block mode', async () => {
    mkdirSync(TEST_DIR, { recursive: true });

    try {
      const { runCoverageGate, COVERAGE_GATE_MODES } = await import('../coverage-gate.js');

      // Coverage data with hex core file below 90% threshold (using absolute path as reporters do)
      const coverageData = {
        total: {
          lines: { total: 100, covered: 85, pct: 85 },
          statements: { total: 100, covered: 85, pct: 85 },
          functions: { total: 20, covered: 18, pct: 90 },
          branches: { total: 30, covered: 24, pct: 80 },
        },
        [join(process.cwd(), 'packages/@exampleapp/application/src/usecases/foo.ts')]: {
          lines: { total: 50, covered: 20, pct: 40 },
          statements: { total: 50, covered: 20, pct: 40 },
          functions: { total: 10, covered: 4, pct: 40 },
          branches: { total: 15, covered: 5, pct: 33.33 },
        },
      };

      const coveragePath = join(TEST_DIR, 'coverage-summary.json');
      writeFileSync(coveragePath, JSON.stringify(coverageData));

      const result = await runCoverageGate({
        mode: COVERAGE_GATE_MODES.BLOCK,
        coveragePath,
        logger: { log: () => {} },
      });

      expect(result.ok).toBe(false);
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });
});
