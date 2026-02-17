// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import type { SandboxBindMount, SandboxProfile } from './profile.js';

export interface SandboxInvocation {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface BuildBwrapInvocationInput {
  profile: SandboxProfile;
  command: string[];
  sandboxBinary?: string;
}

const SYSTEM_READONLY_ALLOWLIST = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc'] as const;

function assertCommand(command: string[]): void {
  if (command.length === 0) {
    throw new Error('Sandbox command is required');
  }
}

function dedupeMounts(mounts: SandboxBindMount[]): SandboxBindMount[] {
  const unique = new Map<string, SandboxBindMount>();
  for (const mount of mounts) {
    const key = `${mount.source}=>${mount.target}`;
    if (!unique.has(key)) {
      unique.set(key, mount);
    }
  }
  return [...unique.values()];
}

function normalizePrefix(prefix: string): string {
  const resolved = path.resolve(prefix);
  if (resolved === path.sep) {
    return resolved;
  }
  return resolved.replace(/[/\\]+$/, '');
}

function isWithinPrefix(candidate: string, prefix: string): boolean {
  const normalizedCandidate = normalizePrefix(candidate);
  const normalizedPrefix = normalizePrefix(prefix);
  if (normalizedPrefix === path.sep) {
    return true;
  }
  return (
    normalizedCandidate === normalizedPrefix ||
    normalizedCandidate.startsWith(`${normalizedPrefix}${path.sep}`)
  );
}

function collectCommandMountPrefixes(profile: SandboxProfile): string[] {
  const prefixes = [
    ...profile.readonly_bind_mounts.map((mount) => mount.target),
    ...profile.writable_bind_mounts.map((mount) => mount.target),
  ];
  return [...new Set(prefixes.map(normalizePrefix))];
}

function collectCommandReadonlyMounts(
  profile: SandboxProfile,
  command: string[],
): SandboxBindMount[] {
  const mountPrefixes = collectCommandMountPrefixes(profile);
  const mounts: SandboxBindMount[] = [];

  for (const segment of command) {
    if (!path.isAbsolute(segment)) {
      continue;
    }

    const absolute = path.resolve(segment);
    const parent = path.dirname(absolute);
    const grandparent = path.dirname(parent);

    if (parent !== '/' && mountPrefixes.some((prefix) => isWithinPrefix(parent, prefix))) {
      mounts.push({ source: parent, target: parent });
    }
    if (
      grandparent !== '/' &&
      mountPrefixes.some((prefix) => isWithinPrefix(grandparent, prefix))
    ) {
      mounts.push({ source: grandparent, target: grandparent });
    }
  }

  return dedupeMounts(mounts);
}

function collectReadonlyAllowlistMounts(
  profile: SandboxProfile,
  command: string[],
): SandboxBindMount[] {
  const writableTargets = new Set(profile.writable_bind_mounts.map((mount) => mount.target));
  const readonlyMounts = [
    ...SYSTEM_READONLY_ALLOWLIST.map((mountPath) => ({
      source: mountPath,
      target: mountPath,
    })),
    ...collectCommandReadonlyMounts(profile, command),
    ...profile.readonly_bind_mounts,
  ];

  return dedupeMounts(readonlyMounts).filter((mount) => !writableTargets.has(mount.target));
}

export function buildBwrapInvocation(input: BuildBwrapInvocationInput): SandboxInvocation {
  assertCommand(input.command);

  const args: string[] = ['--die-with-parent', '--new-session', '--tmpfs', '/'];

  for (const mount of collectReadonlyAllowlistMounts(input.profile, input.command)) {
    args.push('--ro-bind', mount.source, mount.target);
  }

  for (const mount of input.profile.writable_bind_mounts) {
    args.push('--bind', mount.source, mount.target);
  }

  for (const overlay of input.profile.deny_overlays) {
    if (overlay.kind === 'file') {
      args.push('--bind', '/dev/null', overlay.path);
    } else {
      args.push('--tmpfs', overlay.path);
    }
  }

  if (input.profile.network_posture === 'off') {
    args.push('--unshare-net');
  }

  for (const [key, value] of Object.entries(input.profile.env)) {
    args.push('--setenv', key, value);
  }

  args.push('--proc', '/proc', '--dev', '/dev', '--', ...input.command);

  return {
    command: input.sandboxBinary || 'bwrap',
    args,
    env: input.profile.env,
  };
}
