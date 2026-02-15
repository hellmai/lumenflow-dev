import { describe, expect, it } from 'vitest';
import { createMacosSandboxBackend } from '../sandbox-backend-macos.js';
import { buildSandboxProfile } from '../sandbox-profile.js';

const profile = buildSandboxProfile({
  projectRoot: '/repo/root',
  worktreePath: '/repo/root/worktrees/framework-core-validation-wu-1684',
  wuId: 'WU-1684',
});

describe('sandbox-backend-macos', () => {
  it('builds enforced invocation when sandbox-exec is available', () => {
    const backend = createMacosSandboxBackend({
      commandExists: (binary) => binary === 'sandbox-exec',
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-e', 'console.log("ok")'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.backendId).toBe('macos');
    expect(plan.enforced).toBe(true);
    expect(plan.failClosed).toBe(false);
    expect(plan.invocation?.command).toBe('sandbox-exec');
    expect(plan.invocation?.args).toContain('-p');
  });

  it('fails closed when sandbox-exec is unavailable and override is disabled', () => {
    const backend = createMacosSandboxBackend({
      commandExists: () => false,
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-v'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.enforced).toBe(false);
    expect(plan.failClosed).toBe(true);
    expect(plan.reason).toContain('sandbox-exec');
  });

  it('allows explicit unsandboxed fallback when override is enabled', () => {
    const backend = createMacosSandboxBackend({
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
