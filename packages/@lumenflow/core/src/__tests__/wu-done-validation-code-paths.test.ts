// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateCodePathsExist } from '../wu-done-validation.js';

function createTempWorktree(): string {
  return mkdtempSync(path.join(tmpdir(), 'wu-done-code-paths-'));
}

function writeWorktreeFile(worktreeRoot: string, relativePath: string, content = ''): void {
  const fullPath = path.join(worktreeRoot, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

describe('validateCodePathsExist glob handling', () => {
  const tempWorktrees: string[] = [];

  afterEach(() => {
    for (const tempWorktree of tempWorktrees) {
      rmSync(tempWorktree, { recursive: true, force: true });
    }
    tempWorktrees.length = 0;
  });

  it('accepts glob code_paths in worktree mode when they match existing files', async () => {
    const worktreeRoot = createTempWorktree();
    tempWorktrees.push(worktreeRoot);

    writeWorktreeFile(worktreeRoot, 'packages/@lumenflow/core/src/example.ts', 'export {};');

    const result = await validateCodePathsExist(
      {
        code_paths: ['packages/@lumenflow/core/src/**/*.ts'],
      },
      'WU-1995',
      {
        worktreePath: worktreeRoot,
      },
    );

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
