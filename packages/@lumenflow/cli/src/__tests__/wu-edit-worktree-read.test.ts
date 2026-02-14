/**
 * @file wu-edit-worktree-read.test.ts
 * @description WU-1677: Regression test for validateWUEditable reading from worktree
 *
 * Bug: validateWUEditable reads WU YAML from main (cwd) instead of the active
 * worktree for in_progress WUs. This causes sequential wu:edit calls to silently
 * overwrite each other's changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringifyYAML, parseYAML } from '@lumenflow/core/wu-yaml';

// Test utilities
function createTempDir(): string {
  const tmpDir = path.join(os.tmpdir(), `wu-edit-worktree-read-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function cleanupTempDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function writeWUYaml(dir: string, id: string, data: Record<string, unknown>) {
  const wuDir = path.join(dir, 'docs/04-operations/tasks/wu');
  mkdirSync(wuDir, { recursive: true });
  writeFileSync(path.join(wuDir, `${id}.yaml`), stringifyYAML(data));
}

describe('validateWUEditable worktree read (WU-1677)', () => {
  let mainDir: string;
  let worktreeDir: string;
  const WU_ID = 'WU-TEST-1677';

  beforeEach(() => {
    mainDir = createTempDir();
    worktreeDir = path.join(mainDir, 'worktrees', 'framework-cli-wu-commands-wu-test-1677');
    mkdirSync(worktreeDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(mainDir);
  });

  it('should read YAML from worktree when WU is in_progress with worktree mode', async () => {
    // Main checkout has STALE data (old code_paths)
    writeWUYaml(mainDir, WU_ID, {
      id: WU_ID,
      title: 'Test WU',
      lane: 'Framework: CLI WU Commands',
      type: 'bug',
      status: 'in_progress',
      claimed_mode: 'worktree',
      worktree_path: worktreeDir,
      code_paths: ['old/path/a.ts', 'old/path/b.ts'],
      acceptance: ['Original acceptance'],
    });

    // Worktree has FRESH data (updated code_paths from a prior wu:edit)
    writeWUYaml(worktreeDir, WU_ID, {
      id: WU_ID,
      title: 'Test WU',
      lane: 'Framework: CLI WU Commands',
      type: 'bug',
      status: 'in_progress',
      claimed_mode: 'worktree',
      worktree_path: worktreeDir,
      code_paths: ['new/path/a.ts', 'new/path/b.ts', 'new/path/c.ts'],
      acceptance: ['Updated acceptance'],
    });

    // Import dynamically so we can control cwd
    const origCwd = process.cwd();
    try {
      process.chdir(mainDir);

      const { validateWUEditable } = await import('../wu-edit-validators.js');
      const result = validateWUEditable(WU_ID);

      // Should return the WORKTREE version, not the main version
      expect(result.editMode).toBe('worktree');
      expect(result.wu.code_paths).toEqual([
        'new/path/a.ts',
        'new/path/b.ts',
        'new/path/c.ts',
      ]);
      expect(result.wu.acceptance).toEqual(['Updated acceptance']);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('should still read from main for ready WUs', async () => {
    // Main has the ready WU
    writeWUYaml(mainDir, WU_ID, {
      id: WU_ID,
      title: 'Test WU',
      lane: 'Framework: CLI WU Commands',
      type: 'bug',
      status: 'ready',
      code_paths: ['main/path.ts'],
    });

    const origCwd = process.cwd();
    try {
      process.chdir(mainDir);

      const { validateWUEditable } = await import('../wu-edit-validators.js');
      const result = validateWUEditable(WU_ID);

      expect(result.editMode).toBe('micro_worktree');
      expect(result.wu.code_paths).toEqual(['main/path.ts']);
    } finally {
      process.chdir(origCwd);
    }
  });
});
