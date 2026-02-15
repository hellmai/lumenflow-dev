import { describe, expect, it } from 'vitest';
import { createWindowsSandboxBackend } from '../sandbox-backend-windows.js';
import { buildSandboxProfile } from '../sandbox-profile.js';

const profile = buildSandboxProfile({
  projectRoot: 'C:/repo/root',
  worktreePath: 'C:/repo/root/worktrees/framework-core-validation-wu-1684',
  wuId: 'WU-1684',
});

describe('sandbox-backend-windows', () => {
  it('fails closed until Windows write enforcement is implemented', () => {
    const backend = createWindowsSandboxBackend({
      commandExists: (binary) => binary.toLowerCase() === 'powershell.exe',
    });

    const plan = backend.resolveExecution({
      profile,
      command: ['node', '-e', 'console.log("ok")'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.backendId).toBe('windows');
    expect(plan.enforced).toBe(false);
    expect(plan.failClosed).toBe(true);
    expect(plan.reason).toContain('write enforcement is not yet available on Windows');
    expect(plan.invocation).toBeUndefined();
  });

  it('fails closed when fallback is disabled', () => {
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
    expect(plan.reason).toContain('write enforcement is not yet available on Windows');
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
    expect(plan.warning).toContain('write enforcement is not yet available on Windows');
  });
});
