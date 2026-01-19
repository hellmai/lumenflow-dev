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

function runHook(env = {}) {
  return spawnSync('node', [hookPath], {
    input: STDIN_LINE,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('pre-push hook policy (WU-1030)', () => {
  it('blocks direct pushes to main by default', () => {
    const result = runHook();
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
});
