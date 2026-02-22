// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function loadWuSandboxModule(options: { unsupportedBackend?: boolean } = {}) {
  vi.resetModules();
  vi.doUnmock('@lumenflow/core');

  if (options.unsupportedBackend) {
    vi.doMock('@lumenflow/core', async () => {
      const actual = await vi.importActual<typeof import('@lumenflow/core')>('@lumenflow/core');
      return {
        ...actual,
        resolveSandboxBackendForPlatform: () => ({
          id: actual.SANDBOX_BACKEND_IDS.UNSUPPORTED,
          platform: 'test',
          supported: false,
        }),
      };
    });
  }

  return import('../wu-sandbox.js');
}

describe('wu-sandbox policy and parsing (WU-1687)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@lumenflow/core');
  });

  it('reads default sandbox policy when config file is missing', async () => {
    const { readSandboxPolicy } = await loadWuSandboxModule();
    const root = mkdtempSync(path.join(os.tmpdir(), 'wu-sandbox-policy-default-'));

    try {
      const policy = readSandboxPolicy(root);
      expect(policy.allowUnsandboxedEnvVar).toBe('LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED');
      expect(policy.extraWritableRoots).toEqual([]);
      expect(policy.denyWritableRoots).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads sandbox policy fields from workspace.yaml software_delivery', async () => {
    const { readSandboxPolicy } = await loadWuSandboxModule();
    const root = mkdtempSync(path.join(os.tmpdir(), 'wu-sandbox-policy-custom-'));

    try {
      writeFileSync(
        path.join(root, 'workspace.yaml'),
        [
          'software_delivery:',
          '  sandbox:',
          '    allow_unsandboxed_fallback_env: CUSTOM_SANDBOX_OVERRIDE',
          '    extra_writable_roots:',
          '      - memory-bank',
          '      - .lumenflow/state',
          '    deny_writable_roots:',
          '      - .git',
        ].join('\n'),
      );

      const policy = readSandboxPolicy(root);
      expect(policy.allowUnsandboxedEnvVar).toBe('CUSTOM_SANDBOX_OVERRIDE');
      expect(policy.extraWritableRoots).toEqual(['memory-bank', '.lumenflow/state']);
      expect(policy.denyWritableRoots).toEqual(['.git']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('extracts command after -- separator', async () => {
    const { extractSandboxCommandFromArgv } = await loadWuSandboxModule();

    const command = extractSandboxCommandFromArgv([
      'node',
      'wu-sandbox',
      '--id',
      'WU-1687',
      '--',
      'node',
      '-e',
      'process.exit(0)',
    ]);

    expect(command).toEqual(['node', '-e', 'process.exit(0)']);
  });

  it('returns true only when explicit unsandboxed override env var is 1', async () => {
    const { resolveAllowUnsandboxedFallback } = await loadWuSandboxModule();

    expect(resolveAllowUnsandboxedFallback({ CUSTOM_ALLOW: '1' }, 'CUSTOM_ALLOW')).toBe(true);
    expect(resolveAllowUnsandboxedFallback({ CUSTOM_ALLOW: 'true' }, 'CUSTOM_ALLOW')).toBe(false);
    expect(resolveAllowUnsandboxedFallback({}, 'CUSTOM_ALLOW')).toBe(false);
  });
});

describe('wu-sandbox execution behavior (WU-1687)', () => {
  const originalOverride = process.env.LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED;
    } else {
      process.env.LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED = originalOverride;
    }

    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@lumenflow/core');
  });

  it('fails closed when no backend is available and override is disabled', async () => {
    const { runWuSandbox } = await loadWuSandboxModule({ unsupportedBackend: true });
    delete process.env.LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED;

    await expect(
      runWuSandbox({
        id: 'WU-1687',
        worktree: process.cwd(),
        command: [process.execPath, '-e', 'process.exit(0)'],
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('No hardened sandbox backend is available for this platform.');
  });

  it('allows explicit unsandboxed fallback when override is enabled', async () => {
    const { runWuSandbox } = await loadWuSandboxModule({ unsupportedBackend: true });
    process.env.LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED = '1';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exitCode = await runWuSandbox({
      id: 'WU-1687',
      worktree: process.cwd(),
      command: [process.execPath, '-e', 'process.exit(0)'],
      cwd: process.cwd(),
    });

    expect(exitCode).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('unsandboxed'));
  });
});
