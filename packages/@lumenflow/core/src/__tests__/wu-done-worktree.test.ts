import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { computeWUEventsContentWithMainMerge } from '../wu-done-concurrent-merge.js';
import { resolveWorktreeMetadataPaths } from '../wu-done-worktree.js';

const TEST_WU_ID = 'WU-999991';

describe('wu:done worktree metadata path isolation', () => {
  let worktreeRoot = '';

  beforeEach(() => {
    worktreeRoot = mkdtempSync(join(tmpdir(), 'wu-done-worktree-'));

    mkdirSync(join(worktreeRoot, 'docs', '04-operations', 'tasks'), { recursive: true });
    mkdirSync(join(worktreeRoot, '.lumenflow', 'state'), { recursive: true });

    writeFileSync(
      join(worktreeRoot, 'docs', '04-operations', 'tasks', 'backlog.md'),
      '# Backlog\n',
    );
    writeFileSync(
      join(worktreeRoot, '.lumenflow', 'state', 'wu-events.jsonl'),
      `${JSON.stringify({
        type: 'claim',
        wuId: TEST_WU_ID,
        lane: 'Framework: Core Lifecycle',
        title: 'Test claim',
        timestamp: '2026-02-10T00:00:00.000Z',
      })}\n`,
      'utf-8',
    );
  });

  afterEach(() => {
    if (worktreeRoot) {
      rmSync(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('resolves metadata and state paths as absolute worktree-local paths', () => {
    const paths = resolveWorktreeMetadataPaths(worktreeRoot, TEST_WU_ID);

    expect(paths.wuPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.statusPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.backlogPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.stampsDir.startsWith(worktreeRoot)).toBe(true);
    expect(paths.stampPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.eventsPath.startsWith(worktreeRoot)).toBe(true);
  });

  it('returns wu-events content that appends a complete event for the completed WU', async () => {
    const paths = resolveWorktreeMetadataPaths(worktreeRoot, TEST_WU_ID);

    const eventsUpdate = await computeWUEventsContentWithMainMerge(paths.backlogPath, TEST_WU_ID);

    expect(eventsUpdate).not.toBeNull();
    expect(eventsUpdate?.eventsPath).toBe(paths.eventsPath);

    const lines = eventsUpdate!.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const lastEvent = JSON.parse(lines[lines.length - 1]) as { type?: string; wuId?: string };

    expect(lastEvent.type).toBe('complete');
    expect(lastEvent.wuId).toBe(TEST_WU_ID);
  });
});
