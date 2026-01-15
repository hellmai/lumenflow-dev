#!/usr/bin/env node
/**
 * Tests for coverage-gate.mjs
 *
 * WU-1433: TDD for coverage gate with mode flag
 * Uses Node's built-in test runner (node:test)
 *
 * Run: node --test tools/lib/__tests__/coverage-gate.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test fixtures use OS temp directory
const TEST_DIR = join(tmpdir(), 'wu-1433-coverage-test');

// Import the functions to test (will fail until implemented)
import {
  parseCoverageJson,
  isHexCoreFile,
  checkCoverageThresholds,
  formatCoverageDelta,
  COVERAGE_GATE_MODES,
  HEX_CORE_PATTERNS,
  COVERAGE_THRESHOLD,
} from '../coverage-gate.mjs';

describe('coverage-gate constants', () => {
  it('defines COVERAGE_GATE_MODES with warn and block', () => {
    assert.strictEqual(COVERAGE_GATE_MODES.WARN, 'warn');
    assert.strictEqual(COVERAGE_GATE_MODES.BLOCK, 'block');
  });

  it('defines HEX_CORE_PATTERNS for application layer', () => {
    assert.ok(Array.isArray(HEX_CORE_PATTERNS));
    assert.ok(HEX_CORE_PATTERNS.length > 0);
    // Should include application package pattern
    assert.ok(
      HEX_CORE_PATTERNS.some((p) => p.includes('application')),
      'Should include application package pattern'
    );
  });

  it('defines COVERAGE_THRESHOLD as 90', () => {
    assert.strictEqual(COVERAGE_THRESHOLD, 90);
  });
});

describe('isHexCoreFile', () => {
  it('returns true for application package files', () => {
    assert.strictEqual(
      isHexCoreFile('packages/@exampleapp/application/src/usecases/foo.ts'),
      true
    );
    assert.strictEqual(
      isHexCoreFile('packages/@exampleapp/application/src/domain/entity.ts'),
      true
    );
  });

  // WU-2448: Coverage reporters emit absolute paths, so isHexCoreFile must handle them
  it('returns true for absolute application package paths', () => {
    assert.strictEqual(
      isHexCoreFile(join(process.cwd(), 'packages/@exampleapp/application/src/usecases/foo.ts')),
      true
    );
  });

  it('returns false for infrastructure package files', () => {
    assert.strictEqual(
      isHexCoreFile('packages/@exampleapp/infrastructure/src/adapters/db.ts'),
      false
    );
  });

  it('returns false for web app files', () => {
    assert.strictEqual(isHexCoreFile('apps/web/src/app/page.tsx'), false);
  });

  it('returns false for tooling files', () => {
    assert.strictEqual(isHexCoreFile('tools/gates.mjs'), false);
    assert.strictEqual(isHexCoreFile('tools/lib/coverage-gate.mjs'), false);
  });

  it('returns false for null/undefined', () => {
    assert.strictEqual(isHexCoreFile(null), false);
    assert.strictEqual(isHexCoreFile(undefined), false);
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

    assert.ok(result.total);
    assert.strictEqual(result.total.lines.pct, 85);
    assert.ok(result.files);
    assert.ok(result.files['packages/@exampleapp/application/src/usecases/foo.ts']);
  });

  it('returns null for missing file', () => {
    const nonexistentPath = join(TEST_DIR, 'nonexistent-dir', 'coverage.json');
    const result = parseCoverageJson(nonexistentPath);
    assert.strictEqual(result, null);
  });

  it('returns null for invalid JSON', () => {
    const coveragePath = join(TEST_DIR, 'invalid.json');
    writeFileSync(coveragePath, 'not valid json');

    const result = parseCoverageJson(coveragePath);
    assert.strictEqual(result, null);
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

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.failures.length, 0);
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

    assert.strictEqual(result.pass, false);
    assert.ok(result.failures.length > 0);
    assert.ok(result.failures[0].file.includes('foo.ts'));
    assert.strictEqual(result.failures[0].actual, 75);
    assert.strictEqual(result.failures[0].threshold, 90);
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

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.failures.length, 0);
  });

  it('handles empty coverage data gracefully', () => {
    const result = checkCoverageThresholds({ total: { lines: { pct: 0 } }, files: {} });

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.failures.length, 0);
  });

  it('handles null coverage data gracefully', () => {
    const result = checkCoverageThresholds(null);

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.failures.length, 0);
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

    assert.ok(typeof output === 'string');
    assert.ok(output.includes('85.5'), 'Should include total coverage');
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

    assert.ok(output.includes('foo.ts'), 'Should include file name');
    assert.ok(output.includes('75'), 'Should include actual coverage');
  });

  it('returns empty string for null data', () => {
    const output = formatCoverageDelta(null);
    assert.strictEqual(output, '');
  });
});

describe('coverage gate integration', () => {
  it('exports runCoverageGate function', async () => {
    const { runCoverageGate } = await import('../coverage-gate.mjs');
    assert.ok(typeof runCoverageGate === 'function');
  });

  it('runCoverageGate accepts mode parameter', async () => {
    const { runCoverageGate, COVERAGE_GATE_MODES } = await import('../coverage-gate.mjs');

    // Function should accept mode as option and return result object
    // Note: This will need actual coverage file to run properly
    const nonexistentCoveragePath = join(TEST_DIR, 'does-not-exist', 'coverage.json');
    const result = await runCoverageGate({
      mode: COVERAGE_GATE_MODES.WARN,
      coveragePath: nonexistentCoveragePath,
    });

    assert.ok(typeof result === 'object');
    assert.ok('ok' in result);
    assert.ok('mode' in result);
    assert.strictEqual(result.mode, 'warn');
  });

  // WU-2448: Block mode must return ok:false when coverage is below threshold (not silent pass)
  it('blocks when coverage is below threshold in block mode', async () => {
    mkdirSync(TEST_DIR, { recursive: true });

    try {
      const { runCoverageGate, COVERAGE_GATE_MODES } = await import('../coverage-gate.mjs');

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

      assert.strictEqual(result.ok, false);
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });
});
