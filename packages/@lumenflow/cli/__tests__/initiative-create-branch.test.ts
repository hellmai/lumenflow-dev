// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2244: initiative:create should work from any branch because it uses
 * micro-worktree isolation. The ensureOnMain() check is unnecessary and
 * blocks agents working in worktrees from creating initiatives.
 *
 * Tests:
 * 1. Source does NOT call ensureOnMain (the branch check is removed)
 * 2. Source still uses withMicroWorktree (isolation preserved)
 * 3. Source does NOT import ensureOnMain (dead import removed)
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_PATH = path.join(__dirname, '..', 'src', 'initiative-create.ts');

describe('WU-2244: initiative:create works from any branch', () => {
  it('does NOT call ensureOnMain() in the main function', () => {
    const content = fs.readFileSync(SRC_PATH, 'utf-8');

    // The main() function should not call ensureOnMain because
    // micro-worktree isolation makes branch checks unnecessary
    expect(content).not.toMatch(/await\s+ensureOnMain\s*\(/);
  });

  it('does NOT import ensureOnMain from wu-helpers', () => {
    const content = fs.readFileSync(SRC_PATH, 'utf-8');

    // The import should be removed since ensureOnMain is no longer used
    expect(content).not.toMatch(/import\s*\{[^}]*ensureOnMain[^}]*\}\s*from/);
  });

  it('still uses withMicroWorktree for isolation', () => {
    const content = fs.readFileSync(SRC_PATH, 'utf-8');

    // Micro-worktree isolation must remain - it handles the branch safety
    expect(content).toContain('withMicroWorktree');
  });

  it('does not import getGitForCwd if only used for ensureOnMain', () => {
    const content = fs.readFileSync(SRC_PATH, 'utf-8');

    // If getGitForCwd was only used for ensureOnMain, it should be removed too
    // Check if getGitForCwd is used anywhere OTHER than the ensureOnMain call
    const usages = content.match(/getGitForCwd/g);
    if (usages) {
      // If it is still imported, it must be used somewhere meaningful
      // (not just for ensureOnMain)
      const hasNonImportUsage = content.match(/getGitForCwd\(\)/g);
      const importLine = content.match(/import.*getGitForCwd.*from/);
      // If only import + one call that was for ensureOnMain, both should be gone
      if (importLine && hasNonImportUsage && hasNonImportUsage.length === 1) {
        // Check if the single usage is NOT in an ensureOnMain call
        const ensureOnMainUsage = content.match(/ensureOnMain\s*\(\s*getGitForCwd\(\)\s*\)/);
        expect(ensureOnMainUsage).toBeNull();
      }
    }
  });
});
