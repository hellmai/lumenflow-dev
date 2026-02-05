import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

describe('wu-prep default exec helpers (WU-1441)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('uses node + dist wu-validate for JSON comparison when available', async () => {
    const { spawnSync } = await import('node:child_process');
    const { existsSync } = await import('node:fs');

    // Pretend dist sibling exists so defaultExec picks node+dist path (not pnpm on main).
    vi.mocked(existsSync).mockReturnValue(true);

    // Both worktree and main should report WU-1 invalid.
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: JSON.stringify({ invalid: [{ wuId: 'WU-1' }] }),
      stderr: '',
    } as never);

    const { checkPreExistingFailures } = await import('../wu-prep.js');
    const result = await checkPreExistingFailures({ mainCheckout: '/repo' });

    expect(result.error).toBeUndefined();
    expect(result.hasPreExisting).toBe(true);
    expect(result.hasNewFailures).toBe(false);

    // Default exec should run node directly, not "pnpm wu:validate" from the main checkout.
    expect(vi.mocked(spawnSync).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(spawnSync).mock.calls[0]?.[0]).toBe('node');
  });
});
