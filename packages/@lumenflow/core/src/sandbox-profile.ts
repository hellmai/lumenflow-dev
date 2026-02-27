// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import os from 'node:os';
import path from 'node:path';
import {
  buildSandboxAllowlist,
  type SandboxAllowlist,
  type BuildSandboxAllowlistInput,
} from './sandbox-allowlist.js';
import { DIRECTORIES, LUMENFLOW_PATHS } from './wu-constants.js';

export const SANDBOX_BACKEND_IDS = {
  LINUX: 'linux',
  MACOS: 'macos',
  WINDOWS: 'windows',
  UNSUPPORTED: 'unsupported',
} as const;

export type SandboxBackendId = (typeof SANDBOX_BACKEND_IDS)[keyof typeof SANDBOX_BACKEND_IDS];

export type SandboxNetworkPosture = 'off' | 'allowlist' | 'full';

export interface SandboxProfile {
  projectRoot: string;
  worktreePath: string;
  wuId: string;
  wuYamlPath: string;
  statePath: string;
  tempPath: string;
  allowlist: SandboxAllowlist;
  networkPosture: SandboxNetworkPosture;
  networkAllowlist: string[];
}

export interface BuildSandboxProfileInput {
  projectRoot: string;
  worktreePath: string;
  wuId: string;
  tempPath?: string;
  extraWritableRoots?: string[];
  networkPosture?: SandboxNetworkPosture;
  networkAllowlist?: string[];
}

export interface SandboxBackendResolution {
  id: SandboxBackendId;
  platform: NodeJS.Platform | string;
  supported: boolean;
}

export interface SandboxInvocation {
  command: string;
  args: string[];
}

export interface SandboxExecutionRequest {
  profile: SandboxProfile;
  command: string[];
  allowUnsandboxedFallback: boolean;
}

export interface SandboxExecutionPlan {
  backendId: SandboxBackendId;
  enforced: boolean;
  failClosed: boolean;
  invocation?: SandboxInvocation;
  reason?: string;
  warning?: string;
}

export interface SandboxBackend {
  id: SandboxBackendId;
  resolveExecution: (request: SandboxExecutionRequest) => SandboxExecutionPlan;
}

function resolveWorktreePath(projectRoot: string, worktreePath: string): string {
  if (path.isAbsolute(worktreePath)) {
    return path.resolve(worktreePath);
  }

  return path.resolve(projectRoot, worktreePath);
}

function buildDefaultWritableRoots(profile: {
  worktreePath: string;
  statePath: string;
  wuYamlPath: string;
  tempPath: string;
}): string[] {
  return [profile.worktreePath, profile.statePath, profile.wuYamlPath, profile.tempPath];
}

export function buildSandboxProfile(input: BuildSandboxProfileInput): SandboxProfile {
  const projectRoot = path.resolve(input.projectRoot);
  const worktreePath = resolveWorktreePath(projectRoot, input.worktreePath);
  const wuYamlPath = path.resolve(projectRoot, DIRECTORIES.WU_DIR, `${input.wuId}.yaml`);
  const statePath = path.resolve(projectRoot, LUMENFLOW_PATHS.STATE_DIR);
  const tempPath = path.resolve(input.tempPath || os.tmpdir());

  const writableRoots = buildDefaultWritableRoots({
    worktreePath,
    statePath,
    wuYamlPath,
    tempPath,
  });

  if (input.extraWritableRoots && input.extraWritableRoots.length > 0) {
    writableRoots.push(...input.extraWritableRoots);
  }

  const allowlistInput: BuildSandboxAllowlistInput = {
    projectRoot,
    writableRoots,
  };

  const allowlist = buildSandboxAllowlist(allowlistInput);

  const networkPosture: SandboxNetworkPosture = input.networkPosture ?? 'full';
  const networkAllowlist: string[] =
    networkPosture === 'allowlist' && input.networkAllowlist ? [...input.networkAllowlist] : [];

  return {
    projectRoot,
    worktreePath,
    wuId: input.wuId,
    wuYamlPath,
    statePath,
    tempPath,
    allowlist,
    networkPosture,
    networkAllowlist,
  };
}

export function resolveSandboxBackendForPlatform(
  platform: NodeJS.Platform | string = process.platform,
): SandboxBackendResolution {
  if (platform === 'linux') {
    return { id: SANDBOX_BACKEND_IDS.LINUX, platform, supported: true };
  }

  if (platform === 'darwin') {
    return { id: SANDBOX_BACKEND_IDS.MACOS, platform, supported: true };
  }

  if (platform === 'win32') {
    return { id: SANDBOX_BACKEND_IDS.WINDOWS, platform, supported: true };
  }

  return { id: SANDBOX_BACKEND_IDS.UNSUPPORTED, platform, supported: false };
}
