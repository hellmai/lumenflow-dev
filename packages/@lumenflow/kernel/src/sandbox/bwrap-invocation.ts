import type { SandboxProfile } from './profile.js';

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

function assertCommand(command: string[]): void {
  if (command.length === 0) {
    throw new Error('Sandbox command is required');
  }
}

export function buildBwrapInvocation(input: BuildBwrapInvocationInput): SandboxInvocation {
  assertCommand(input.command);

  const args: string[] = ['--die-with-parent', '--new-session', '--ro-bind', '/', '/'];

  for (const mount of input.profile.readonly_bind_mounts) {
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
