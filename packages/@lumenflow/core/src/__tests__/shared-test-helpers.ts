// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAIN_CWD_DIRNAME = 'main';
const WORKTREE_CWD_DIRNAME = 'worktree';
const REMOVE_RECURSIVE_OPTIONS = { recursive: true, force: true } as const;

export interface DualWorkspacePaths {
  sandboxRoot: string;
  mainCwd: string;
  worktreeCwd: string;
  mainFilePath: string;
  worktreeFilePath: string;
}

export interface CreateDualWorkspacePathsInput {
  relativeFilePath: string;
  tempDirPrefix: string;
}

/**
 * Shared fixture helper for tests that need isolated "main + worktree" paths.
 */
export function createDualWorkspacePaths({
  relativeFilePath,
  tempDirPrefix,
}: CreateDualWorkspacePathsInput): DualWorkspacePaths {
  const sandboxRoot = mkdtempSync(join(tmpdir(), tempDirPrefix));
  const mainCwd = join(sandboxRoot, MAIN_CWD_DIRNAME);
  const worktreeCwd = join(sandboxRoot, WORKTREE_CWD_DIRNAME);

  return {
    sandboxRoot,
    mainCwd,
    worktreeCwd,
    mainFilePath: join(mainCwd, relativeFilePath),
    worktreeFilePath: join(worktreeCwd, relativeFilePath),
  };
}

export function removePathRecursive(targetPath: string): void {
  rmSync(targetPath, REMOVE_RECURSIVE_OPTIONS);
}
