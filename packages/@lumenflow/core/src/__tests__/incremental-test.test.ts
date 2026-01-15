/**
 * @file incremental-test.test.mjs
 * @description Tests for Vitest --changed command helpers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVitestChangedArgs,
  CODE_FILE_EXTENSIONS,
  isCodeFilePath,
  VITEST_CHANGED_EXCLUDES,
} from '../incremental-test.mjs';
import { GIT_REFS } from '../wu-constants.mjs';

describe('VITEST_CHANGED_EXCLUDES', () => {
  it('should include integration and golden test exclusions', () => {
    assert.ok(VITEST_CHANGED_EXCLUDES.includes('**/*.integration.*'));
    assert.ok(VITEST_CHANGED_EXCLUDES.includes('**/golden-*.test.*'));
  });
});

describe('CODE_FILE_EXTENSIONS', () => {
  it('should include TypeScript and JavaScript extensions', () => {
    assert.ok(CODE_FILE_EXTENSIONS.includes('.ts'));
    assert.ok(CODE_FILE_EXTENSIONS.includes('.tsx'));
    assert.ok(CODE_FILE_EXTENSIONS.includes('.js'));
    assert.ok(CODE_FILE_EXTENSIONS.includes('.jsx'));
  });
});

describe('isCodeFilePath', () => {
  it('should return true for code file extensions', () => {
    assert.equal(isCodeFilePath('apps/web/src/app/page.tsx'), true);
    assert.equal(isCodeFilePath('packages/@exampleapp/shared/src/index.ts'), true);
    assert.equal(isCodeFilePath('tools/scripts/build.mjs'), true);
  });

  it('should return false for non-code files', () => {
    assert.equal(isCodeFilePath('README.md'), false);
    assert.equal(isCodeFilePath('docs/guide.yaml'), false);
  });
});

describe('buildVitestChangedArgs', () => {
  it('should default to origin/main for --changed', () => {
    const args = buildVitestChangedArgs();
    assert.ok(args.includes('--changed'));
    assert.ok(args.includes(GIT_REFS.ORIGIN_MAIN));
  });

  it('should allow a custom base branch', () => {
    const args = buildVitestChangedArgs({ baseBranch: 'origin/develop' });
    assert.ok(args.includes('origin/develop'));
  });

  it('should include --run and passWithNoTests', () => {
    const args = buildVitestChangedArgs();
    assert.ok(args.includes('--run'));
    assert.ok(args.includes('--passWithNoTests'));
  });

  it('should limit worker concurrency and allow extra teardown time', () => {
    const args = buildVitestChangedArgs();
    assert.ok(args.includes('--maxWorkers=1'));
    assert.ok(args.includes('--teardownTimeout=30000'));
  });

  it('should include all exclude flags', () => {
    const args = buildVitestChangedArgs();
    const excludeArgs = args.filter((arg) => arg.startsWith('--exclude='));
    assert.equal(excludeArgs.length, VITEST_CHANGED_EXCLUDES.length);
  });
});
