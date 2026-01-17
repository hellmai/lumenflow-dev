/**
 * @file incremental-test.test.mjs
 * @description Tests for Vitest --changed command helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildVitestChangedArgs,
  CODE_FILE_EXTENSIONS,
  isCodeFilePath,
  VITEST_CHANGED_EXCLUDES,
} from '../incremental-test.js';
import { GIT_REFS } from '../wu-constants.js';

describe('VITEST_CHANGED_EXCLUDES', () => {
  it('should include integration and golden test exclusions', () => {
    expect(VITEST_CHANGED_EXCLUDES).toContain('**/*.integration.*');
    expect(VITEST_CHANGED_EXCLUDES).toContain('**/golden-*.test.*');
  });
});

describe('CODE_FILE_EXTENSIONS', () => {
  it('should include TypeScript and JavaScript extensions', () => {
    expect(CODE_FILE_EXTENSIONS).toContain('.ts');
    expect(CODE_FILE_EXTENSIONS).toContain('.tsx');
    expect(CODE_FILE_EXTENSIONS).toContain('.js');
    expect(CODE_FILE_EXTENSIONS).toContain('.jsx');
  });
});

describe('isCodeFilePath', () => {
  it('should return true for code file extensions', () => {
    expect(isCodeFilePath('apps/web/src/app/page.tsx')).toBe(true);
    expect(isCodeFilePath('packages/@exampleapp/shared/src/index.ts')).toBe(true);
    expect(isCodeFilePath('tools/scripts/build.js')).toBe(true);
  });

  it('should return false for non-code files', () => {
    expect(isCodeFilePath('README.md')).toBe(false);
    expect(isCodeFilePath('docs/guide.yaml')).toBe(false);
  });
});

describe('buildVitestChangedArgs', () => {
  it('should default to origin/main for --changed', () => {
    const args = buildVitestChangedArgs();
    expect(args).toContain('--changed');
    expect(args).toContain(GIT_REFS.ORIGIN_MAIN);
  });

  it('should allow a custom base branch', () => {
    const args = buildVitestChangedArgs({ baseBranch: 'origin/develop' });
    expect(args).toContain('origin/develop');
  });

  it('should include --run and passWithNoTests', () => {
    const args = buildVitestChangedArgs();
    expect(args).toContain('--run');
    expect(args).toContain('--passWithNoTests');
  });

  it('should limit worker concurrency and allow extra teardown time', () => {
    const args = buildVitestChangedArgs();
    expect(args).toContain('--maxWorkers=1');
    expect(args).toContain('--teardownTimeout=30000');
  });

  it('should include all exclude flags', () => {
    const args = buildVitestChangedArgs();
    const excludeArgs = args.filter((arg) => arg.startsWith('--exclude='));
    expect(excludeArgs.length).toBe(VITEST_CHANGED_EXCLUDES.length);
  });
});
