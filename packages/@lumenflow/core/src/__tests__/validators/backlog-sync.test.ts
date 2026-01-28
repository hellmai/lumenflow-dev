/**
 * @file backlog-sync.test.ts
 * @description Tests for backlog sync validation in core
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateBacklogSync } from '../../validators/backlog-sync.js';

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'lumenflow-backlog-sync-'));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('validateBacklogSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    mkdirSync(path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu'), { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('passes when backlog.md lists all WU YAML files', async () => {
    writeFileSync(
      path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-001.yaml'),
      'id: WU-001\ntitle: First WU\nstatus: ready',
    );
    writeFileSync(
      path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-002.yaml'),
      'id: WU-002\ntitle: Second WU\nstatus: done',
    );

    const backlogContent = `# Backlog

## Ready
- WU-001: First WU

## Done
- WU-002: Second WU
`;
    writeFileSync(
      path.join(tmpDir, 'docs', '04-operations', 'tasks', 'backlog.md'),
      backlogContent,
    );

    const result = await validateBacklogSync({ cwd: tmpDir });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when WU exists but not in backlog.md', async () => {
    writeFileSync(
      path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-001.yaml'),
      'id: WU-001\ntitle: Missing WU\nstatus: ready',
    );

    const backlogContent = `# Backlog

## Ready
(empty)
`;
    writeFileSync(
      path.join(tmpDir, 'docs', '04-operations', 'tasks', 'backlog.md'),
      backlogContent,
    );

    const result = await validateBacklogSync({ cwd: tmpDir });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /WU-001.*not found.*backlog/i.test(e))).toBe(true);
  });
});
