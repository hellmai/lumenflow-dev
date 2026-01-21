/**
 * @file gates.test.ts
 * WU-1042: Tests for prettier guidance helpers in gates.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPrettierWriteCommand,
  formatFormatCheckGuidance,
  parsePrettierListOutput,
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
