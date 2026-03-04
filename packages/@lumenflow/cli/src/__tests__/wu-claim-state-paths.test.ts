// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearConfigCache } from '@lumenflow/core/config';
import { LUMENFLOW_PATHS, DOCS_LAYOUT_PRESETS } from '@lumenflow/core';
import {
  removeFromReadyAndAddToInProgressBacklog,
  toRelativeClaimWorktreePathForStorage,
  normalizeClaimPathForWorktree,
  resolveClaimPathInWorktree,
  getWorktreeCommitFiles,
} from '../wu-claim-state.js';

const ARC42 = DOCS_LAYOUT_PRESETS.arc42;
const WU_DIR = `${ARC42.tasks}/wu`;
const BACKLOG_PATH = `${ARC42.tasks}/backlog.md`;
const STATUS_PATH = `${ARC42.tasks}/status.md`;
function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'lumenflow-wu-claim-state-'));
}

describe('removeFromReadyAndAddToInProgressBacklog', () => {
  let tmpDir: string;
  let previousCwd: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    previousCwd = process.cwd();
    process.chdir(tmpDir);
    clearConfigCache();
  });

  afterEach(() => {
    clearConfigCache();
    process.chdir(previousCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes status projection to provided statusPath instead of backlog-relative sibling path', async () => {
    const backlogPath = path.join(tmpDir, 'planning', 'backlog.md');
    const statusPath = path.join(tmpDir, 'boards', 'status-board.md');
    const legacySiblingStatusPath = path.join(tmpDir, 'planning', 'status.md');

    writeFileSync(
      path.join(tmpDir, 'workspace.yaml'),
      `software_delivery:
  directories:
    backlogPath: planning/backlog.md
`,
      { encoding: 'utf-8' },
    );

    mkdirSync(path.dirname(backlogPath), { recursive: true });
    mkdirSync(path.dirname(statusPath), { recursive: true });

    await removeFromReadyAndAddToInProgressBacklog(
      backlogPath,
      statusPath,
      'WU-9090',
      'Config-driven status path projection',
      'Framework: Core Lifecycle',
    );

    expect(existsSync(backlogPath)).toBe(true);
    expect(existsSync(statusPath)).toBe(true);
    expect(existsSync(legacySiblingStatusPath)).toBe(false);
  });
});

describe('toRelativeClaimWorktreePathForStorage', () => {
  it('converts absolute worktree path to repo-relative path', () => {
    const value = toRelativeClaimWorktreePathForStorage(
      '/home/USER/source/hellmai/lumenflow-dev/worktrees/framework-cli-wu-commands-wu-2250',
      '/home/USER/source/hellmai/lumenflow-dev',
    );

    expect(value).toBe('worktrees/framework-cli-wu-commands-wu-2250');
  });

  it('normalizes relative path separators and strips leading dot segments', () => {
    const value = toRelativeClaimWorktreePathForStorage(
      './worktrees\\framework-cli-wu-commands-wu-2250',
      '/home/USER/source/hellmai/lumenflow-dev',
    );

    expect(value).toBe('worktrees/framework-cli-wu-commands-wu-2250');
  });
});

describe('WU-2259: claim path isolation for micro-worktree writes', () => {
  it('normalizes absolute source-root paths to repo-relative claim metadata paths', () => {
    const normalized = normalizeClaimPathForWorktree(
      `/repo/${WU_DIR}/WU-2259.yaml`,
      '/repo',
    );

    expect(normalized).toBe(`${WU_DIR}/WU-2259.yaml`);
  });

  it('resolves absolute source-root paths under the micro-worktree root', () => {
    const resolved = resolveClaimPathInWorktree(
      `/repo/${STATUS_PATH}`,
      '/tmp/micro-wu-2259',
      '/repo',
    );

    expect(resolved).toBe(`/tmp/micro-wu-2259/${STATUS_PATH}`);
  });

  it('keeps already-relative claim metadata paths stable', () => {
    const normalized = normalizeClaimPathForWorktree(BACKLOG_PATH, '/r');
    const resolved = resolveClaimPathInWorktree(
      LUMENFLOW_PATHS.WU_EVENTS,
      '/tmp/micro',
      '/r',
    );

    expect(normalized).toBe(BACKLOG_PATH);
    expect(resolved).toBe(`/tmp/micro/${LUMENFLOW_PATHS.WU_EVENTS}`);
  });

  it('returns repo-relative worktree commit files even when directories are configured as absolute', () => {
    const tmpDir = createTempDir();
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    clearConfigCache();

    try {
      const absoluteWuDir = path.join(tmpDir, WU_DIR);
      writeFileSync(
        path.join(tmpDir, 'workspace.yaml'),
        `software_delivery:
  directories:
    wuDir: ${absoluteWuDir}
  state:
    stateDir: ${path.join(tmpDir, LUMENFLOW_PATHS.STATE_DIR)}
`,
        { encoding: 'utf-8' },
      );

      const files = getWorktreeCommitFiles('WU-2259');
      expect(files).toContain(`${WU_DIR}/WU-2259.yaml`);
      expect(files).toContain(LUMENFLOW_PATHS.WU_EVENTS);
      expect(files.some((filePath) => path.isAbsolute(filePath))).toBe(false);
    } finally {
      clearConfigCache();
      process.chdir(previousCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
