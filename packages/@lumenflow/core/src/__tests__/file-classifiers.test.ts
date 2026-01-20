#!/usr/bin/env node
/**
 * File Classifiers Tests
 *
 * WU-1848: DRY Consolidation - Tests for shared file classification utilities
 *
 * TDD: Tests written BEFORE implementation (RED phase).
 */

import { describe, it, expect } from 'vitest';
import { isTestFile, isMarkdownFile, isDocumentationPath } from '../file-classifiers.js';

describe('isTestFile', () => {
  describe('test file extensions', () => {
    it('should detect .test.ts files', () => {
      expect(isTestFile('src/utils.test.ts')).toBe(true);
      expect(isTestFile('apps/web/src/lib/utils.test.tsx')).toBe(true);
    });

    it('should detect .spec.ts files', () => {
      expect(isTestFile('src/utils.spec.ts')).toBe(true);
      expect(isTestFile('packages/app/utils.spec.tsx')).toBe(true);
    });

    it('should detect .test.js and .test.mjs files', () => {
      expect(isTestFile('src/utils.test.js')).toBe(true);
      expect(isTestFile('tools/lib/utils.test.js')).toBe(true);
    });

    it('should detect files in __tests__ directories', () => {
      expect(isTestFile('src/__tests__/utils.ts')).toBe(true);
      expect(isTestFile('apps/web/src/__tests__/helpers/mock.ts')).toBe(true);
    });

    it('should detect .test-utils. files', () => {
      expect(isTestFile('src/test-utils.ts')).toBe(false); // Not in a test directory
      expect(isTestFile('src/component.test-utils.ts')).toBe(true);
    });

    it('should detect .mock. files', () => {
      expect(isTestFile('src/api.mock.ts')).toBe(true);
    });
  });

  describe('non-test files', () => {
    it('should return false for regular source files', () => {
      expect(isTestFile('src/utils.ts')).toBe(false);
      expect(isTestFile('src/component.tsx')).toBe(false);
      expect(isTestFile('tools/lib/validator.js')).toBe(false);
    });

    it('should return false for configuration files', () => {
      expect(isTestFile('vitest.config.ts')).toBe(false);
      expect(isTestFile('tsconfig.json')).toBe(false);
    });
  });

  describe('path normalisation', () => {
    it('should normalise Windows paths', () => {
      expect(isTestFile('src\\__tests__\\utils.ts')).toBe(true);
      expect(isTestFile('src\\utils.test.ts')).toBe(true);
    });
  });
});

describe('isMarkdownFile', () => {
  it('should detect .md files', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('docs/guide.md')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isMarkdownFile('README.MD')).toBe(true);
    expect(isMarkdownFile('guide.Md')).toBe(true);
  });

  it('should return false for non-markdown files', () => {
    expect(isMarkdownFile('src/utils.ts')).toBe(false);
    expect(isMarkdownFile('data.json')).toBe(false);
  });

  it('should normalise Windows paths', () => {
    expect(isMarkdownFile('docs\\guide.md')).toBe(true);
  });
});

describe('isDocumentationPath', () => {
  it('should detect docs/ directory', () => {
    expect(isDocumentationPath('docs/guide.md')).toBe(true);
    expect(isDocumentationPath('docs/04-operations/tasks/wu/WU-1848.yaml')).toBe(true);
  });

  it('should detect ai/ directory', () => {
    expect(
      isDocumentationPath('docs/04-operations/_frameworks/lumenflow/agent/onboarding/guide.md'),
    ).toBe(true);
    expect(isDocumentationPath('ai/prompts/safety.txt')).toBe(true);
  });

  it('should detect .claude/ directory', () => {
    expect(isDocumentationPath('.claude/skills/SKILL.md')).toBe(true);
  });

  it('should detect memory-bank/ directory', () => {
    expect(isDocumentationPath('memory-bank/notes.md')).toBe(true);
  });

  it('should detect README files at root', () => {
    expect(isDocumentationPath('README.md')).toBe(true);
    expect(isDocumentationPath('readme.md')).toBe(true);
  });

  it('should detect CLAUDE.md at root', () => {
    expect(isDocumentationPath('CLAUDE.md')).toBe(true);
    expect(isDocumentationPath('CLAUDE-core.md')).toBe(true);
  });

  it('should return false for code files', () => {
    expect(isDocumentationPath('src/utils.ts')).toBe(false);
    expect(isDocumentationPath('apps/web/src/lib/helper.ts')).toBe(false);
    expect(isDocumentationPath('tools/lib/validator.js')).toBe(false);
  });
});
