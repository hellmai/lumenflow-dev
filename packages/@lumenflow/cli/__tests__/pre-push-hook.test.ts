/**
 * @file pre-push-hook.test.ts
 * Tests for .husky/hooks/pre-push.mjs policy exceptions (WU-1030)
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const hookPath = join(repoRoot, '.husky/hooks/pre-push.mjs');

const STDIN_LINE =
  'refs/heads/main 0123456789abcdef0123456789abcdef01234567 refs/heads/main 0123456789abcdef0123456789abcdef01234567\n';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- return type inferred from spawnSync
function runHook(env: Record<string, string> = {}) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test intentionally uses PATH to run node
  return spawnSync('node', [hookPath], {
    input: STDIN_LINE,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('pre-push hook policy (WU-1030)', () => {
  it('blocks direct pushes to main by default', () => {
    // Explicitly unset LUMENFLOW_WU_TOOL to ensure blocking behavior
    // (parent process may have it set during wu:done)
    const result = runHook({ LUMENFLOW_WU_TOOL: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('BLOCKED: Direct push to main');
  });

  it('allows wu:create pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-create' });
    expect(result.status).toBe(0);
  });

  it('allows wu:edit pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-edit' });
    expect(result.status).toBe(0);
  });

  it('allows wu:done pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-done' });
    expect(result.status).toBe(0);
  });

  // WU-1245: wu:delete uses micro-worktree isolation and must be allowed
  it('allows wu:delete pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-delete' });
    expect(result.status).toBe(0);
  });

  // WU-1245: wu:claim uses micro-worktree isolation and must be allowed
  it('allows wu:claim pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-claim' });
    expect(result.status).toBe(0);
  });

  // WU-1245: wu:block uses micro-worktree isolation and must be allowed
  it('allows wu:block pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-block' });
    expect(result.status).toBe(0);
  });

  // WU-1245: wu:unblock uses micro-worktree isolation and must be allowed
  it('allows wu:unblock pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-unblock' });
    expect(result.status).toBe(0);
  });

  // WU-1255: initiative:create uses micro-worktree isolation and must be allowed
  it('allows initiative:create pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'initiative-create' });
    expect(result.status).toBe(0);
  });

  // WU-1255: initiative:edit uses micro-worktree isolation and must be allowed
  it('allows initiative:edit pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'initiative-edit' });
    expect(result.status).toBe(0);
  });

  // WU-1296: release uses micro-worktree isolation and must be allowed
  it('allows release pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'release' });
    expect(result.status).toBe(0);
  });

  // WU-1418: wu:repair uses micro-worktree isolation for consistency repairs
  it('allows wu:repair pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-repair' });
    expect(result.status).toBe(0);
  });

  // WU-1418: wu:admin-repair uses micro-worktree isolation for admin repairs
  it('allows wu:admin-repair pushes to main when LUMENFLOW_WU_TOOL is set', () => {
    const result = runHook({ LUMENFLOW_WU_TOOL: 'wu-admin-repair' });
    expect(result.status).toBe(0);
  });
});
