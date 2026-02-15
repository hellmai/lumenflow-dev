import { describe, expect, it } from 'vitest';
import { createWindowsSandboxBackend } from '../sandbox-backend-windows.js';
import { buildSandboxProfile } from '../sandbox-profile.js';

const profile = buildSandboxProfile({
  projectRoot: 'C:/repo/root',
  worktreePath: 'C:/repo/root/worktrees/framework-core-validation-wu-1684',
  wuId: 'WU-1684',
});

describe('sandbox-backend-windows', () => {
  it('builds enforced invocation when powershell is available', () => {
    const backend = createWindowsSandboxBackend({
      commandExists: (binary) => binary.toLowerCase() === 'powershell.exe',
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-e', 'console.log("ok")'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.backendId).toBe('windows');
    expect(plan.enforced).toBe(true);
    expect(plan.failClosed).toBe(false);
    expect(plan.invocation?.command).toBe('powershell.exe');
    expect(plan.invocation?.args).toContain('-NoProfile');
  });

  it('fails closed when powershell is unavailable and override is disabled', () => {
    const backend = createWindowsSandboxBackend({
      commandExists: () => false,
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-v'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.enforced).toBe(false);
    expect(plan.failClosed).toBe(true);
    expect(plan.reason).toContain('powershell');
  });

  it('allows explicit unsandboxed fallback when override is enabled', () => {
    const backend = createWindowsSandboxBackend({
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
