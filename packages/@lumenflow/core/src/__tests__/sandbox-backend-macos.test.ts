// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { createMacosSandboxBackend } from '../sandbox-backend-macos.js';
import { buildSandboxProfile } from '../sandbox-profile.js';

function extractPolicy(plan: { invocation?: { args: string[] } }): string {
  const policyFlagIndex = plan.invocation?.args.indexOf('-p') ?? -1;
  return policyFlagIndex >= 0 ? plan.invocation?.args[policyFlagIndex + 1] || '' : '';
}

const baseProfileInput = {
  projectRoot: '/repo/root',
  worktreePath: '/repo/root/worktrees/framework-core-validation-wu-1684',
  wuId: 'WU-1684',
};

const profile = buildSandboxProfile(baseProfileInput);

const profileWithNetworkOff = buildSandboxProfile({
  ...baseProfileInput,
  networkPosture: 'off',
});

const profileWithNetworkFull = buildSandboxProfile({
  ...baseProfileInput,
  networkPosture: 'full',
});

const profileWithNetworkAllowlist = buildSandboxProfile({
  ...baseProfileInput,
  networkPosture: 'allowlist',
  networkAllowlist: ['registry.npmjs.org:443', '127.0.0.1:3000'],
});

const profileWithEmptyAllowlist = buildSandboxProfile({
  ...baseProfileInput,
  networkPosture: 'allowlist',
  networkAllowlist: [],
});

const backendAvailable = createMacosSandboxBackend({
  commandExists: (binary) => binary === 'sandbox-exec',
});

describe('sandbox-backend-macos', () => {
  it('builds enforced invocation when sandbox-exec is available', () => {
    const plan = backendAvailable.resolveExecution({
      profile: profileWithNetworkFull,
      command: ['node', '-e', 'console.log("ok")'],
      allowUnsandboxedFallback: false,
    });

    expect(plan.backendId).toBe('macos');
    expect(plan.enforced).toBe(true);
    expect(plan.failClosed).toBe(false);
    expect(plan.invocation?.command).toBe('sandbox-exec');
    expect(plan.invocation?.args).toContain('-p');
    const policy = extractPolicy(plan);

    expect(policy).toContain('(allow sysctl-read)');
    expect(policy).toContain('(allow mach-lookup)');
    expect(policy).toContain('(allow network*)');
    expect(policy).toContain('(allow signal)');
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

  describe('network posture: off', () => {
    it('denies all network when posture is off', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkOff,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain('(deny network*)');
      expect(policy).not.toContain('(allow network');
    });
  });

  describe('network posture: allowlist', () => {
    it('denies network by default and allows only listed hosts', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkAllowlist,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain('(deny network*)');
      expect(policy).toContain(
        '(allow network-outbound (remote ip "registry.npmjs.org:443"))',
      );
      expect(policy).toContain('(allow network-outbound (remote ip "127.0.0.1:3000"))');
    });

    it('denies all network when allowlist is empty', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithEmptyAllowlist,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain('(deny network*)');
      expect(policy).not.toContain('(allow network');
    });
  });

  describe('network posture: full', () => {
    it('allows all network when posture is full', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain('(allow network*)');
      expect(policy).not.toContain('(deny network');
    });
  });

  describe('default posture (backwards compatibility)', () => {
    it('defaults to full network access when no posture specified', () => {
      const plan = backendAvailable.resolveExecution({
        profile,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      // Legacy profiles without networkPosture get full access for backwards compat
      expect(policy).toContain('(allow network*)');
    });
  });
});
