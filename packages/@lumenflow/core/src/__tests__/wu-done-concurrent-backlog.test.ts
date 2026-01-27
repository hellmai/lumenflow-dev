/**
 * @file wu-done-concurrent-backlog.test.ts
 * @description Tests for WU-1145: Concurrent backlog modification handling
 *
 * This module tests that wu:done correctly merges backlog changes instead
 * of overwriting them when concurrent modifications occur on main.
 *
 * The bug: When wu:done updates metadata (backlog.md, status.md), it uses
 * a stale snapshot from worktree claim time. Any changes made to backlog.md
 * on main after the worktree diverged are lost.
 *
 * The fix: Before regenerating backlog.md, merge events from both the
 * worktree's state store and main's state store to preserve concurrent changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WUStateStore } from '../wu-state-store.js';
import { generateBacklog } from '../backlog-generator.js';
import { mergeStateStores, computeBacklogContentWithMerge } from '../wu-done-concurrent-merge.js';

describe('WU-1145: Concurrent backlog modification', () => {
  let tempDir: string;
  let worktreeStateDir: string;
  let mainStateDir: string;

  beforeEach(() => {
    // Create temp directory structure
    tempDir = mkdtempSync(join(tmpdir(), 'wu-1145-test-'));
    worktreeStateDir = join(tempDir, 'worktree', '.lumenflow', 'state');
    mainStateDir = join(tempDir, 'main', '.lumenflow', 'state');

    mkdirSync(worktreeStateDir, { recursive: true });
    mkdirSync(mainStateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('mergeStateStores', () => {
    it('should merge events from worktree and main stores', async () => {
      // Setup: Create worktree state with WU-100 claimed
      const worktreeEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(worktreeStateDir, 'wu-events.jsonl'), worktreeEvents);

      // Setup: Create main state with WU-100 created and WU-200 completed concurrently
      const mainEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
          // This is a concurrent completion that happened after worktree diverged
          JSON.stringify({
            type: 'create',
            wuId: 'WU-200',
            timestamp: '2026-01-27T11:00:00.000Z',
            lane: 'Framework: CLI',
            title: 'Concurrent WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-200',
            timestamp: '2026-01-27T11:01:00.000Z',
            lane: 'Framework: CLI',
            assignee: 'other',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-200',
            timestamp: '2026-01-27T12:00:00.000Z',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(mainStateDir, 'wu-events.jsonl'), mainEvents);

      // Act: Merge the state stores
      const mergedStore = await mergeStateStores(worktreeStateDir, mainStateDir);

      // Assert: Merged store should contain both WUs
      expect(mergedStore.getWUState('WU-100')).toBeDefined();
      expect(mergedStore.getWUState('WU-100')?.status).toBe('in_progress');

      expect(mergedStore.getWUState('WU-200')).toBeDefined();
      expect(mergedStore.getWUState('WU-200')?.status).toBe('done');
    });

    it('should preserve concurrent additions to Done section', async () => {
      // Setup: Worktree has WU-100 in_progress
      const worktreeEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(worktreeStateDir, 'wu-events.jsonl'), worktreeEvents);

      // Setup: Main has WU-100 plus multiple concurrent completions
      const mainEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
          // Multiple concurrent completions
          JSON.stringify({
            type: 'create',
            wuId: 'WU-201',
            timestamp: '2026-01-27T11:00:00.000Z',
            lane: 'Framework: CLI',
            title: 'Concurrent WU 1',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-201',
            timestamp: '2026-01-27T12:00:00.000Z',
          }),
          JSON.stringify({
            type: 'create',
            wuId: 'WU-202',
            timestamp: '2026-01-27T13:00:00.000Z',
            lane: 'Framework: Memory',
            title: 'Concurrent WU 2',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-202',
            timestamp: '2026-01-27T14:00:00.000Z',
          }),
          JSON.stringify({
            type: 'create',
            wuId: 'WU-203',
            timestamp: '2026-01-27T15:00:00.000Z',
            lane: 'Framework: Agent',
            title: 'Concurrent WU 3',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-203',
            timestamp: '2026-01-27T16:00:00.000Z',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(mainStateDir, 'wu-events.jsonl'), mainEvents);

      // Act: Merge and generate backlog
      const mergedStore = await mergeStateStores(worktreeStateDir, mainStateDir);
      const backlog = await generateBacklog(mergedStore);

      // Assert: All concurrent completions should be in Done section
      expect(backlog).toContain('WU-201');
      expect(backlog).toContain('WU-202');
      expect(backlog).toContain('WU-203');

      // And WU-100 should still be in_progress
      expect(mergedStore.getWUState('WU-100')?.status).toBe('in_progress');
    });

    it('should preserve concurrent additions (new WUs created on main)', async () => {
      // Setup: Worktree has WU-100 in_progress
      const worktreeEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(worktreeStateDir, 'wu-events.jsonl'), worktreeEvents);

      // Setup: Main has WU-100 plus new WUs created while worktree was active
      // Note: In the state store, 'create' sets status to 'in_progress' (ready to work)
      const mainEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
          // New WUs added to backlog while worktree was active
          JSON.stringify({
            type: 'create',
            wuId: 'WU-301',
            timestamp: '2026-01-27T11:00:00.000Z',
            lane: 'Framework: CLI',
            title: 'New WU 1',
          }),
          JSON.stringify({
            type: 'create',
            wuId: 'WU-302',
            timestamp: '2026-01-27T12:00:00.000Z',
            lane: 'Framework: Memory',
            title: 'New WU 2',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(mainStateDir, 'wu-events.jsonl'), mainEvents);

      // Act: Merge and generate backlog
      const mergedStore = await mergeStateStores(worktreeStateDir, mainStateDir);
      const backlog = await generateBacklog(mergedStore);

      // Assert: New WUs should be preserved in the merged state
      // Note: State store treats 'create' as 'in_progress' status
      expect(backlog).toContain('WU-301');
      expect(backlog).toContain('WU-302');
      expect(mergedStore.getWUState('WU-301')).toBeDefined();
      expect(mergedStore.getWUState('WU-302')).toBeDefined();
    });

    it('should handle worktree completion event correctly', async () => {
      // Setup: Worktree has WU-100 in_progress
      const worktreeEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(worktreeStateDir, 'wu-events.jsonl'), worktreeEvents);

      // Setup: Main has concurrent completion of WU-200
      const mainEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'My WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
          JSON.stringify({
            type: 'create',
            wuId: 'WU-200',
            timestamp: '2026-01-27T11:00:00.000Z',
            lane: 'Framework: CLI',
            title: 'Concurrent WU',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-200',
            timestamp: '2026-01-27T12:00:00.000Z',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(mainStateDir, 'wu-events.jsonl'), mainEvents);

      // Act: Merge, then complete WU-100
      const mergedStore = await mergeStateStores(worktreeStateDir, mainStateDir);

      // Create completion event for WU-100
      const completeEvent = mergedStore.createCompleteEvent('WU-100');
      mergedStore.applyEvent(completeEvent);

      // Generate backlog
      const backlog = await generateBacklog(mergedStore);

      // Assert: Both WU-100 and WU-200 should be in Done
      expect(mergedStore.getWUState('WU-100')?.status).toBe('done');
      expect(mergedStore.getWUState('WU-200')?.status).toBe('done');
      expect(backlog).toContain('WU-100');
      expect(backlog).toContain('WU-200');
    });
  });

  describe('computeBacklogContentWithMerge', () => {
    it('should use merged state when computing backlog content', async () => {
      // Setup backlog paths
      const worktreeBacklogDir = join(tempDir, 'worktree', 'docs', '04-operations', 'tasks');
      const mainBacklogDir = join(tempDir, 'main', 'docs', '04-operations', 'tasks');
      mkdirSync(worktreeBacklogDir, { recursive: true });
      mkdirSync(mainBacklogDir, { recursive: true });

      // Setup: Worktree has WU-100 in_progress
      const worktreeEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'Test WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(worktreeStateDir, 'wu-events.jsonl'), worktreeEvents);
      writeFileSync(join(worktreeBacklogDir, 'backlog.md'), '# Backlog\n');

      // Setup: Main has concurrent completion
      const mainEvents =
        [
          JSON.stringify({
            type: 'create',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:00:00.000Z',
            lane: 'Framework: Core',
            title: 'Test WU',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-100',
            timestamp: '2026-01-27T10:01:00.000Z',
            lane: 'Framework: Core',
            assignee: 'test',
          }),
          JSON.stringify({
            type: 'create',
            wuId: 'WU-200',
            timestamp: '2026-01-27T11:00:00.000Z',
            lane: 'Framework: CLI',
            title: 'Concurrent WU',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-200',
            timestamp: '2026-01-27T12:00:00.000Z',
          }),
        ].join('\n') + '\n';

      writeFileSync(join(mainStateDir, 'wu-events.jsonl'), mainEvents);

      // Act: Compute backlog content with merge
      const backlogContent = await computeBacklogContentWithMerge(
        join(worktreeBacklogDir, 'backlog.md'),
        'WU-100',
        'Test WU',
        mainStateDir,
      );

      // Assert: Should contain both WUs
      expect(backlogContent).toContain('WU-100');
      expect(backlogContent).toContain('WU-200');
    });
  });
});
