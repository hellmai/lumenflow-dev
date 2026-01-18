/**
 * Docs Path Validator tests
 *
 * Validates docs-only staged-file allow/deny rules, including tooling-managed metadata.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

import { validateDocsOnly, getAllowedPathsDescription } from '../docs-path-validator.js';
import { BEACON_PATHS, DIRECTORIES } from '../wu-constants.js';
import { WU_EVENTS_FILE_NAME } from '../wu-state-store.js';

describe('docs-path-validator', () => {
  it('allows documentation prefixes and markdown files', () => {
    const result = validateDocsOnly([
      `${DIRECTORIES.DOCS}04-operations/tasks/status.md`,
      `${DIRECTORIES.AI}onboarding/starting-prompt.md`,
      `${DIRECTORIES.CLAUDE}plans/example.md`,
      `${DIRECTORIES.MEMORY_BANK}README.md`,
      'README.md',
    ]);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('allows tooling-managed WU lifecycle event log', () => {
    const wuEventsPath = path.posix.join(BEACON_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);
    const result = validateDocsOnly([wuEventsPath]);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('allows stamp files', () => {
    const stampPath = path.posix.join(BEACON_PATHS.STAMPS_DIR, 'WU-123.done');
    const result = validateDocsOnly([stampPath]);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('allows test files under tools/__tests__ and packages/**/__tests__', () => {
    const result = validateDocsOnly([
      path.posix.join(DIRECTORIES.TOOLS, '__tests__', 'example.test.js'),
      path.posix.join(DIRECTORIES.PACKAGES, 'pkg', '__tests__', 'example.test.ts'),
    ]);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects application and non-test package paths', () => {
    const result = validateDocsOnly([
      path.posix.join('apps', 'web', 'src', 'app', 'page.tsx'),
      path.posix.join(DIRECTORIES.PACKAGES, 'pkg', 'src', 'index.ts'),
    ]);

    expect(result.valid).toBe(false);
    assert.deepEqual(result.violations, [
      path.posix.join('apps', 'web', 'src', 'app', 'page.tsx'),
      path.posix.join(DIRECTORIES.PACKAGES, 'pkg', 'src', 'index.ts'),
    ]);
  });

  it('describes the allowed event log path', () => {
    const description = getAllowedPathsDescription();
    expect(description).toContain(`${BEACON_PATHS.STATE_DIR}/${WU_EVENTS_FILE_NAME}`);
  });
});
