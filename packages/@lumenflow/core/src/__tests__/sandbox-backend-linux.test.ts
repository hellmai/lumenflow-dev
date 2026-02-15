import { describe, expect, it } from 'vitest';
import { createLinuxSandboxBackend } from '../sandbox-backend-linux.js';
import { buildSandboxProfile } from '../sandbox-profile.js';

const profile = buildSandboxProfile({
  projectRoot: '/repo/root',
  worktreePath: '/repo/root/worktrees/framework-core-validation-wu-1684',
  wuId: 'WU-1684',
});

describe('sandbox-backend-linux', () => {
  it('builds enforced invocation when bwrap is available', () => {
    const backend = createLinuxSandboxBackend({
      commandExists: (binary) => binary === 'bwrap',
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-e', 'console.log("ok")'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.backendId).toBe('linux');
    expect(plan.enforced).toBe(true);
    expect(plan.failClosed).toBe(false);
    expect(plan.invocation?.command).toBe('bwrap');
    const args = plan.invocation?.args || [];
    const roBindIndex = args.indexOf('--ro-bind');
    const firstWritableBindIndex = args.indexOf('--bind');

    expect(roBindIndex).toBeGreaterThanOrEqual(0);
    expect(args.slice(roBindIndex, roBindIndex + 3)).toEqual(['--ro-bind', '/', '/']);
    expect(firstWritableBindIndex).toBeGreaterThan(roBindIndex);
    expect(plan.invocation?.args).toContain('--');
  });

  it('fails closed when bwrap is unavailable and override is disabled', () => {
    const backend = createLinuxSandboxBackend({
      commandExists: () => false,
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-v'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.enforced).toBe(false);
    expect(plan.failClosed).toBe(true);
    expect(plan.reason).toContain('bwrap');
  });

  it('allows explicit unsandboxed fallback when override is enabled', () => {
    const backend = createLinuxSandboxBackend({
      commandExists: () => false,
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-v'],
      allowUnsandboxedFallback: true,
    });

    expect(plan.enforced).toBe(false);
    expect(plan.failClosed).toBe(false);
    expect(plan.warning).toContain('unsandboxed');
  });
});
