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
      expect(policy).toContain('(allow network-outbound (remote ip "registry.npmjs.org:443"))');
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

  describe('file-read confinement', () => {
    it('does not use broad (allow file-read*) rule', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      // Must NOT contain the broad read-all rule
      expect(policy).not.toMatch(/\(allow file-read\*\)(?!\s*\(subpath)/);
      // But must contain scoped file-read rules
      expect(policy).toContain('(allow file-read*');
    });

    it('allows file-read for workspace path', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain(`(allow file-read* (subpath "${baseProfileInput.projectRoot}"))`);
    });

    it('allows file-read for system paths', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain('(allow file-read* (subpath "/usr"))');
      expect(policy).toContain('(allow file-read* (subpath "/System"))');
      expect(policy).toContain('(allow file-read* (subpath "/Library"))');
      expect(policy).toContain('(allow file-read* (subpath "/bin"))');
      expect(policy).toContain('(allow file-read* (subpath "/sbin"))');
      expect(policy).toContain('(allow file-read* (subpath "/private"))');
      expect(policy).toContain('(allow file-read* (subpath "/dev"))');
      expect(policy).toContain('(allow file-read* (subpath "/tmp"))');
    });

    it('allows file-read for temp path from profile', () => {
      const profileWithCustomTemp = buildSandboxProfile({
        ...baseProfileInput,
        networkPosture: 'full',
        tempPath: '/custom/tmp',
      });

      const plan = backendAvailable.resolveExecution({
        profile: profileWithCustomTemp,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toContain('(allow file-read* (subpath "/custom/tmp"))');
    });
  });

  describe('deny overlays for sensitive paths', () => {
    it('denies file-read for ~/.ssh', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toMatch(/\(deny file-read\* \(subpath ".*\/\.ssh"\)\)/);
    });

    it('denies file-read for ~/.aws', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toMatch(/\(deny file-read\* \(subpath ".*\/\.aws"\)\)/);
    });

    it('denies file-read for ~/.gnupg', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      expect(policy).toMatch(/\(deny file-read\* \(subpath ".*\/\.gnupg"\)\)/);
    });

    it('places deny overlays after allow rules for deny-wins behavior', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      const lastAllowReadIndex = policy.lastIndexOf('(allow file-read*');
      const firstDenyReadIndex = policy.indexOf('(deny file-read*');
      expect(firstDenyReadIndex).toBeGreaterThan(lastAllowReadIndex);
    });
  });

  describe('parity with Linux bwrap confinement', () => {
    it('confines reads to workspace and system paths like bwrap --ro-bind', () => {
      const plan = backendAvailable.resolveExecution({
        profile: profileWithNetworkFull,
        command: ['node', '-v'],
        allowUnsandboxedFallback: false,
      });

      const policy = extractPolicy(plan);
      // Should not have unrestricted file-read
      expect(policy).not.toContain('(allow file-read*)');
      // Should have scoped reads
      expect(policy).toContain('(allow file-read* (subpath');
      // Should deny sensitive paths (matching bwrap secret deny overlays)
      expect(policy).toMatch(/\(deny file-read\* \(subpath ".*\/\.ssh"\)\)/);
      expect(policy).toMatch(/\(deny file-read\* \(subpath ".*\/\.aws"\)\)/);
      expect(policy).toMatch(/\(deny file-read\* \(subpath ".*\/\.gnupg"\)\)/);
    });
  });
});
