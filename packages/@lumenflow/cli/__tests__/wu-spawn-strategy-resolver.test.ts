// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Spawn Strategy Resolver Tests (WU-2144)
 *
 * TDD tests for the worktree-gated evidence recording fix.
 *
 * Acceptance criteria:
 * - AC1: recordWuBriefEvidence skips writing when not in a worktree context
 * - AC2: Running wu:brief from main checkout does not modify wu-events.jsonl
 * - AC3: Running wu:brief from a worktree still records evidence as before
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordWuBriefEvidence } from '../src/wu-spawn-strategy-resolver.js';

describe('recordWuBriefEvidence', () => {
  let checkpointCalls: Array<{ wuId: string; note: string; options?: unknown }>;
  let mockCreateStore: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    checkpointCalls = [];
    mockCreateStore = vi.fn().mockReturnValue({
      checkpoint: vi
        .fn()
        .mockImplementation(async (wuId: string, note: string, options?: unknown) => {
          checkpointCalls.push({ wuId, note, options });
        }),
    });
  });

  describe('AC1: skips writing when not in a worktree context', () => {
    it('does not call checkpoint when workspaceRoot is a main checkout path', async () => {
      await recordWuBriefEvidence(
        {
          wuId: 'WU-9999',
          workspaceRoot: '/home/user/project',
          clientName: 'claude-code',
        },
        {
          createStore: mockCreateStore,
          isInWorktree: () => false,
        },
      );

      expect(mockCreateStore).not.toHaveBeenCalled();
      expect(checkpointCalls).toHaveLength(0);
    });
  });

  describe('AC2: main checkout does not modify wu-events.jsonl', () => {
    it('returns without side effects when not in worktree', async () => {
      const result = await recordWuBriefEvidence(
        {
          wuId: 'WU-1234',
          workspaceRoot: '/home/user/project',
          clientName: 'codex-cli',
        },
        {
          createStore: mockCreateStore,
          isInWorktree: () => false,
        },
      );

      // Should return undefined (void) without any writes
      expect(result).toBeUndefined();
      expect(mockCreateStore).not.toHaveBeenCalled();
    });
  });

  describe('AC3: worktree still records evidence as before', () => {
    it('calls checkpoint when in a worktree context', async () => {
      await recordWuBriefEvidence(
        {
          wuId: 'WU-5678',
          workspaceRoot: '/home/user/project/worktrees/framework-cli-wu-5678',
          clientName: 'claude-code',
        },
        {
          createStore: mockCreateStore,
          isInWorktree: () => true,
        },
      );

      expect(mockCreateStore).toHaveBeenCalledTimes(1);
      expect(checkpointCalls).toHaveLength(1);
      expect(checkpointCalls[0].wuId).toBe('WU-5678');
      expect(checkpointCalls[0].note).toContain('[wu:brief]');
      expect(checkpointCalls[0].note).toContain('claude-code');
      const opts = checkpointCalls[0].options as { nextSteps?: string };
      expect(opts.nextSteps).toContain('mode=evidence-only');
    });

    it('passes progress and nextSteps to checkpoint', async () => {
      await recordWuBriefEvidence(
        {
          wuId: 'WU-7777',
          workspaceRoot: '/home/user/project/worktrees/ops-wu-7777',
          clientName: 'codex-cli',
        },
        {
          createStore: mockCreateStore,
          isInWorktree: () => true,
        },
      );

      expect(checkpointCalls).toHaveLength(1);
      const opts = checkpointCalls[0].options as { progress?: string; nextSteps?: string };
      expect(opts.progress).toBe('wu:brief executed');
      expect(opts.nextSteps).toContain('codex-cli');
      expect(opts.nextSteps).toContain('mode=evidence-only');
    });

    it('records prompt mode explicitly when caller generated a handoff prompt', async () => {
      await recordWuBriefEvidence(
        {
          wuId: 'WU-8888',
          workspaceRoot: '/home/user/project/worktrees/ops-wu-8888',
          clientName: 'codex-cli',
          evidenceMode: 'prompt',
        },
        {
          createStore: mockCreateStore,
          isInWorktree: () => true,
        },
      );

      const opts = checkpointCalls[0].options as { nextSteps?: string };
      expect(opts.nextSteps).toContain('mode=prompt');
    });
  });

  describe('default worktree detection', () => {
    it('uses isInWorktree from worktree-guard by default when no override provided', async () => {
      // When no isInWorktree override is provided, the function should use the real
      // isInWorktree from @lumenflow/core/core/worktree-guard.
      // Since test runner is likely not in a worktree path, this should skip writing.
      await recordWuBriefEvidence(
        {
          wuId: 'WU-0001',
          workspaceRoot: '/tmp/not-a-worktree',
          clientName: 'claude-code',
        },
        {
          createStore: mockCreateStore,
          // NOTE: no isInWorktree override -- uses real detection
        },
      );

      // /tmp/not-a-worktree does not match worktree path pattern, so no write
      expect(mockCreateStore).not.toHaveBeenCalled();
    });
  });
});
