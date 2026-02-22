// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterExistingFiles } from '../gates-utils.js';

const TEMP_DIR_PREFIX = 'gates-utils-wu-2052-';
const MAIN_DIRNAME = 'main';
const WORKTREE_DIRNAME = 'worktree';
const RELATIVE_FILE_PATH = 'docs/deleted-config.yaml';
const FILE_CONTENT = 'fixture';
const DIRECTORY_PERMISSIONS = { recursive: true } as const;

function createSandboxPaths() {
  const sandboxRoot = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  const mainCwd = join(sandboxRoot, MAIN_DIRNAME);
  const worktreeCwd = join(sandboxRoot, WORKTREE_DIRNAME);
  const mainFilePath = join(mainCwd, RELATIVE_FILE_PATH);
  const worktreeFilePath = join(worktreeCwd, RELATIVE_FILE_PATH);
  return { sandboxRoot, mainCwd, worktreeCwd, mainFilePath, worktreeFilePath };
}

function ensureParentDirs(paths: { mainFilePath: string; worktreeFilePath: string }) {
  mkdirSync(join(paths.mainFilePath, '..'), DIRECTORY_PERMISSIONS);
  mkdirSync(join(paths.worktreeFilePath, '..'), DIRECTORY_PERMISSIONS);
}

describe('filterExistingFiles (WU-2052)', () => {
  it('filters deleted files using provided cwd instead of process cwd', async () => {
    const paths = createSandboxPaths();
    ensureParentDirs(paths);
    writeFileSync(paths.mainFilePath, FILE_CONTENT);

    const previousCwd = process.cwd();
    process.chdir(paths.mainCwd);
    try {
      await expect(filterExistingFiles([RELATIVE_FILE_PATH], paths.worktreeCwd)).resolves.toEqual(
        [],
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(paths.sandboxRoot, DIRECTORY_PERMISSIONS);
    }
  });

  it('keeps files that exist under provided cwd even when process cwd differs', async () => {
    const paths = createSandboxPaths();
    ensureParentDirs(paths);
    writeFileSync(paths.worktreeFilePath, FILE_CONTENT);

    const previousCwd = process.cwd();
    process.chdir(paths.mainCwd);
    try {
      await expect(
        filterExistingFiles([RELATIVE_FILE_PATH], paths.worktreeCwd),
      ).resolves.toEqual([RELATIVE_FILE_PATH]);
    } finally {
      process.chdir(previousCwd);
      rmSync(paths.sandboxRoot, DIRECTORY_PERMISSIONS);
    }
  });
});
