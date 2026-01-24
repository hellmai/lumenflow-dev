/**
 * @file gates.test.ts
 * WU-1042: Tests for prettier guidance helpers in gates.
 * WU-1087: Tests for createWUParser-based argument parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPrettierWriteCommand,
  formatFormatCheckGuidance,
  parsePrettierListOutput,
  parseGatesOptions,
  GATES_OPTIONS,
} from '../src/gates.js';

describe('gates prettier helpers (WU-1042)', () => {
  it('parses list-different output into file paths', () => {
    const output = [
      'Checking formatting...',
      '[error] packages/foo.ts',
      'packages/bar.ts',
      '[error] Code style issues found in 2 files. Forgot to run Prettier?',
      'All matched files use Prettier',
      '',
    ].join('\n');

    expect(parsePrettierListOutput(output)).toEqual(['packages/foo.ts', 'packages/bar.ts']);
  });

  it('builds a prettier write command with quoted files', () => {
    const command = buildPrettierWriteCommand(['packages/foo.ts', 'docs/readme.md']);
    expect(command).toBe('pnpm prettier --write "packages/foo.ts" "docs/readme.md"');
  });

  it('formats guidance with command and file list', () => {
    const lines = formatFormatCheckGuidance(['packages/foo.ts']);
    const output = lines.join('\n');

    expect(output).toContain('format:check failed');
    expect(output).toContain('pnpm prettier --write "packages/foo.ts"');
    expect(output).toContain('- packages/foo.ts');
  });

  it('returns empty guidance when no files provided', () => {
    expect(formatFormatCheckGuidance([])).toEqual([]);
  });
});

describe('gates argument parsing (WU-1087)', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    // Reset argv before each test
    process.argv = ['node', 'gates.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('GATES_OPTIONS', () => {
    it('exports gates-specific option definitions', () => {
      expect(GATES_OPTIONS).toBeDefined();
      expect(GATES_OPTIONS.docsOnly).toBeDefined();
      expect(GATES_OPTIONS.fullLint).toBeDefined();
      expect(GATES_OPTIONS.fullTests).toBeDefined();
      expect(GATES_OPTIONS.fullCoverage).toBeDefined();
      expect(GATES_OPTIONS.coverageMode).toBeDefined();
      expect(GATES_OPTIONS.verbose).toBeDefined();
    });

    it('has correct flag definitions', () => {
      expect(GATES_OPTIONS.docsOnly.flags).toBe('--docs-only');
      expect(GATES_OPTIONS.fullLint.flags).toBe('--full-lint');
      expect(GATES_OPTIONS.fullTests.flags).toBe('--full-tests');
      expect(GATES_OPTIONS.fullCoverage.flags).toBe('--full-coverage');
      expect(GATES_OPTIONS.coverageMode.flags).toBe('--coverage-mode <mode>');
      expect(GATES_OPTIONS.verbose.flags).toBe('--verbose');
    });
  });

  describe('parseGatesOptions', () => {
    it('parses --docs-only flag', () => {
      process.argv = ['node', 'gates.js', '--docs-only'];
      const opts = parseGatesOptions();
      expect(opts.docsOnly).toBe(true);
    });

    it('parses --full-lint flag', () => {
      process.argv = ['node', 'gates.js', '--full-lint'];
      const opts = parseGatesOptions();
      expect(opts.fullLint).toBe(true);
    });

    it('parses --full-tests flag', () => {
      process.argv = ['node', 'gates.js', '--full-tests'];
      const opts = parseGatesOptions();
      expect(opts.fullTests).toBe(true);
    });

    it('parses --full-coverage flag', () => {
      process.argv = ['node', 'gates.js', '--full-coverage'];
      const opts = parseGatesOptions();
      expect(opts.fullCoverage).toBe(true);
    });

    it('parses --coverage-mode with value', () => {
      process.argv = ['node', 'gates.js', '--coverage-mode', 'warn'];
      const opts = parseGatesOptions();
      expect(opts.coverageMode).toBe('warn');
    });

    it('defaults --coverage-mode to block', () => {
      process.argv = ['node', 'gates.js'];
      const opts = parseGatesOptions();
      expect(opts.coverageMode).toBe('block');
    });

    it('parses --verbose flag', () => {
      process.argv = ['node', 'gates.js', '--verbose'];
      const opts = parseGatesOptions();
      expect(opts.verbose).toBe(true);
    });

    it('handles multiple flags together', () => {
      process.argv = ['node', 'gates.js', '--docs-only', '--verbose'];
      const opts = parseGatesOptions();
      expect(opts.docsOnly).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it('filters pnpm -- separator correctly', () => {
      // When invoked via `pnpm gates -- --docs-only`, pnpm passes ["--", "--docs-only"]
      process.argv = ['node', 'gates.js', '--', '--docs-only'];
      const opts = parseGatesOptions();
      expect(opts.docsOnly).toBe(true);
    });
  });
});
