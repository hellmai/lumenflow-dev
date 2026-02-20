// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { GitAdapter } from '../git-adapter.js';
import type {
  DeleteBranchOptions,
  IGitAdapter,
  MergeOptions,
  MergeResult,
  PushOptions,
  WorktreeRemoveOptions,
} from '../ports/git-validator.ports.js';

describe('git-validator ports', () => {
  it('should export option/result types (compile-time check)', () => {
    const pushOptions: PushOptions = { setUpstream: true };
    const mergeOptions: MergeOptions = { ffOnly: true };
    const deleteOptions: DeleteBranchOptions = { force: true };
    const worktreeOptions: WorktreeRemoveOptions = { force: true };
    const result: MergeResult = { success: true };

    expect(pushOptions.setUpstream).toBe(true);
    expect(mergeOptions.ffOnly).toBe(true);
    expect(deleteOptions.force).toBe(true);
    expect(worktreeOptions.force).toBe(true);
    expect(result.success).toBe(true);
  });

  it('should keep GitAdapter compatible with IGitAdapter (compile-time check)', () => {
    const adapter: IGitAdapter = new GitAdapter({ baseDir: process.cwd() });

    expect(typeof adapter.getCurrentBranch).toBe('function');
    expect(typeof adapter.merge).toBe('function');
    expect(typeof adapter.worktreeRemove).toBe('function');
  });

  it('should load ports index with git-validator port exports', async () => {
    await expect(import('../ports/index.js')).resolves.toBeDefined();
  });
});
