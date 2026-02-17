// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import os from 'node:os';
import path from 'node:path';
import type { ToolScope } from '../kernel.schemas.js';

export type SandboxNetworkPosture = 'off' | 'full';

export interface SandboxBindMount {
  source: string;
  target: string;
}

export interface SandboxDenyOverlay {
  path: string;
  kind: 'directory' | 'file';
}

export interface SandboxProfile {
  readonly_bind_mounts: SandboxBindMount[];
  writable_bind_mounts: SandboxBindMount[];
  network_posture: SandboxNetworkPosture;
  deny_overlays: SandboxDenyOverlay[];
  env: Record<string, string>;
}

export interface CreateDefaultDenyOverlaysInput {
  workspaceRoot: string;
  homeDir?: string;
}

export interface BuildSandboxProfileFromScopesOptions {
  workspaceRoot?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  denyOverlays?: SandboxDenyOverlay[];
}

export const READ_CONFINEMENT_NOTE = 'read confinement best-effort (v1)';

function isGlobSegment(segment: string): boolean {
  return /[*?[{(]/.test(segment);
}

function resolveScopePatternToPath(pattern: string, workspaceRoot: string): string {
  const normalized = pattern.replaceAll('\\', '/');
  const rawSegments = normalized.split('/').filter((segment) => segment.length > 0);
  const staticSegments: string[] = [];

  for (const segment of rawSegments) {
    if (isGlobSegment(segment)) {
      break;
    }
    staticSegments.push(segment);
  }

  if (normalized.startsWith('/')) {
    const absolutePrefix = staticSegments.length === 0 ? '/' : `/${staticSegments.join('/')}`;
    return path.resolve(absolutePrefix);
  }

  if (staticSegments.length === 0) {
    return path.resolve(workspaceRoot);
  }

  return path.resolve(workspaceRoot, staticSegments.join('/'));
}

function dedupeMounts(mounts: SandboxBindMount[]): SandboxBindMount[] {
  const seen = new Set<string>();
  return mounts.filter((mount) => {
    const key = `${mount.source}=>${mount.target}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeEnvironment(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  if (!env) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function createDefaultDenyOverlays(
  input: CreateDefaultDenyOverlaysInput,
): SandboxDenyOverlay[] {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const homeDir = path.resolve(input.homeDir || os.homedir());
  return [
    { path: path.join(homeDir, '.ssh'), kind: 'directory' },
    { path: path.join(homeDir, '.aws'), kind: 'directory' },
    { path: path.join(homeDir, '.gnupg'), kind: 'directory' },
    { path: path.join(workspaceRoot, '.env'), kind: 'file' },
  ];
}

export function resolveScopeEnforcementNote(scopes: ToolScope[]): string | undefined {
  const hasReadPathScope = scopes.some((scope) => scope.type === 'path' && scope.access === 'read');
  return hasReadPathScope ? READ_CONFINEMENT_NOTE : undefined;
}

export function buildSandboxProfileFromScopes(
  scopeEnforced: ToolScope[],
  options: BuildSandboxProfileFromScopesOptions = {},
): SandboxProfile {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const writable_bind_mounts: SandboxBindMount[] = [];
  const readonly_bind_mounts: SandboxBindMount[] = [];
  let network_posture: SandboxNetworkPosture = 'off';

  for (const scope of scopeEnforced) {
    if (scope.type === 'network') {
      if (scope.posture === 'full') {
        network_posture = 'full';
      }
      continue;
    }

    const resolvedPath = resolveScopePatternToPath(scope.pattern, workspaceRoot);
    const mount: SandboxBindMount = {
      source: resolvedPath,
      target: resolvedPath,
    };
    if (scope.access === 'write') {
      writable_bind_mounts.push(mount);
    } else {
      readonly_bind_mounts.push(mount);
    }
  }

  return {
    readonly_bind_mounts: dedupeMounts(readonly_bind_mounts),
    writable_bind_mounts: dedupeMounts(writable_bind_mounts),
    network_posture,
    deny_overlays:
      options.denyOverlays ||
      createDefaultDenyOverlays({
        workspaceRoot,
        homeDir: options.homeDir,
      }),
    env: normalizeEnvironment(options.env),
  };
}
