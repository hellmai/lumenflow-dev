// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_BACKEND_IDS,
  buildSandboxProfile,
  resolveSandboxBackendForPlatform,
} from '../sandbox-profile.js';
import {
  SANDBOX_BACKEND_IDS as BARREL_SANDBOX_BACKEND_IDS,
  buildSandboxProfile as buildSandboxProfileFromCore,
  resolveSandboxBackendForPlatform as resolveSandboxBackendFromCore,
} from '../index.js';
import { DIRECTORIES } from '../wu-constants.js';

describe('sandbox-profile', () => {
  it('builds deterministic writable roots for worktree sandbox profile', () => {
    const repoRoot = '/repo/root';
    const profile = buildSandboxProfile({
      projectRoot: repoRoot,
      worktreePath: 'worktrees/framework-core-validation-wu-1684',
      wuId: 'WU-1684',
    });

    expect(profile.projectRoot).toBe(path.resolve(repoRoot));
    expect(profile.worktreePath).toBe(
      path.resolve(repoRoot, 'worktrees/framework-core-validation-wu-1684'),
    );
    expect(profile.wuYamlPath).toBe(
      path.resolve(repoRoot, `${DIRECTORIES.WU_DIR}/WU-1684.yaml`),
    );
    expect(profile.statePath).toBe(path.resolve(repoRoot, '.lumenflow/state'));
    expect(profile.tempPath).toBe(path.resolve(os.tmpdir()));

    const writableRoots = profile.allowlist.writableRoots.map((entry) => entry.normalizedPath);
    expect(writableRoots).toContain(profile.worktreePath);
    expect(writableRoots).toContain(profile.statePath);
    expect(writableRoots).toContain(profile.wuYamlPath);
    expect(writableRoots).toContain(profile.tempPath);
  });

  it('selects supported backends by platform through shared resolver', () => {
    expect(resolveSandboxBackendForPlatform('linux').id).toBe(SANDBOX_BACKEND_IDS.LINUX);
    expect(resolveSandboxBackendForPlatform('darwin').id).toBe(SANDBOX_BACKEND_IDS.MACOS);
    expect(resolveSandboxBackendForPlatform('win32').id).toBe(SANDBOX_BACKEND_IDS.WINDOWS);
    expect(resolveSandboxBackendForPlatform('freebsd').id).toBe(SANDBOX_BACKEND_IDS.UNSUPPORTED);
  });

  it('adds extra writable roots to the sandbox allowlist', () => {
    const repoRoot = '/repo/root';
    const relativeExtraRoot = 'scratch/agent-cache';
    const absoluteExtraRoot = '/var/tmp/lumenflow-cache';
    const profile = buildSandboxProfile({
      projectRoot: repoRoot,
      worktreePath: 'worktrees/framework-core-validation-wu-1684',
      wuId: 'WU-1684',
      extraWritableRoots: [relativeExtraRoot, absoluteExtraRoot],
    });

    const writableRoots = profile.allowlist.writableRoots.map((entry) => entry.normalizedPath);
    expect(writableRoots).toContain(path.resolve(repoRoot, relativeExtraRoot));
    expect(writableRoots).toContain(path.resolve(absoluteExtraRoot));
  });

  it('exports sandbox profile contract from core barrel', () => {
    expect(buildSandboxProfileFromCore).toBeTypeOf('function');
    expect(resolveSandboxBackendFromCore('darwin').id).toBe(SANDBOX_BACKEND_IDS.MACOS);
    expect(BARREL_SANDBOX_BACKEND_IDS.WINDOWS).toBe(SANDBOX_BACKEND_IDS.WINDOWS);
  });
});
