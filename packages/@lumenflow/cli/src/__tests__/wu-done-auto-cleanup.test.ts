/**
 * @file wu-done-auto-cleanup.test.ts
 * Test suite for wu:done auto cleanup on success (WU-1366, WU-1533)
 *
 * WU-1366: State cleanup runs automatically after wu:done success (non-fatal)
 * WU-1533: Fix auto-cleanup dirtying main checkout
 *
 * Tests:
 * - shouldRunAutoCleanup respects config.cleanup.trigger setting
 * - shouldRunAutoCleanup re-reads config (reload: true) after merge (WU-1533)
 * - runAutoCleanupAfterDone is non-fatal (logs errors but doesn't throw)
 * - commitCleanupChanges auto-commits dirty state files after cleanup (WU-1533)
 * - commitCleanupChanges stages both .lumenflow/state/ and .lumenflow/archive/ files (WU-1553)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Common mock path for lumenflow config module */
const CONFIG_MODULE_PATH = '@lumenflow/core/dist/lumenflow-config.js';

// Test the exported functions directly with minimal mocking
describe('wu:done auto cleanup (WU-1366)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    vi.resetModules();
  });

  describe('shouldRunAutoCleanup', () => {
    it('should return true when config.cleanup.trigger is on_done', async () => {
      // Mock getConfig to return on_done trigger
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_done' },
        }),
      }));

      const { shouldRunAutoCleanup } = await import('../wu-done-auto-cleanup.js');
      const result = shouldRunAutoCleanup();
      expect(result).toBe(true);
    });

    it('should return false when config.cleanup.trigger is manual', async () => {
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'manual' },
        }),
      }));

      const { shouldRunAutoCleanup } = await import('../wu-done-auto-cleanup.js');
      const result = shouldRunAutoCleanup();
      expect(result).toBe(false);
    });

    it('should return false when config.cleanup.trigger is on_init', async () => {
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_init' },
        }),
      }));

      const { shouldRunAutoCleanup } = await import('../wu-done-auto-cleanup.js');
      const result = shouldRunAutoCleanup();
      expect(result).toBe(false);
    });

    it('should return true when cleanup config is missing (default behavior)', async () => {
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({}),
      }));

      const { shouldRunAutoCleanup } = await import('../wu-done-auto-cleanup.js');
      const result = shouldRunAutoCleanup();
      expect(result).toBe(true);
    });
  });

  describe('runAutoCleanupAfterDone non-fatal behavior', () => {
    it('should not throw when cleanup throws an error', async () => {
      // Mock config to enable cleanup
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_done' },
          directories: { wuDir: 'docs/tasks/wu' },
        }),
      }));

      // Mock cleanupState to throw
      vi.doMock('@lumenflow/core/dist/state-cleanup-core.js', () => ({
        cleanupState: vi.fn().mockRejectedValue(new Error('Cleanup failed')),
      }));

      // Mock the memory functions to avoid actual file operations
      vi.doMock('@lumenflow/memory/dist/signal-cleanup-core.js', () => ({
        cleanupSignals: vi.fn().mockResolvedValue({
          success: true,
          removedIds: [],
          retainedIds: [],
          bytesFreed: 0,
          compactionRatio: 0,
          breakdown: {},
        }),
      }));
      vi.doMock('@lumenflow/memory/dist/mem-cleanup-core.js', () => ({
        cleanupMemory: vi.fn().mockResolvedValue({
          success: true,
          removedIds: [],
          retainedIds: [],
          bytesFreed: 0,
          compactionRatio: 0,
          breakdown: {},
        }),
      }));
      vi.doMock('@lumenflow/core/dist/wu-events-cleanup.js', () => ({
        archiveWuEvents: vi.fn().mockResolvedValue({
          success: true,
          archivedWuIds: [],
          retainedWuIds: [],
          bytesArchived: 0,
          archivedEventCount: 0,
          retainedEventCount: 0,
          breakdown: {},
        }),
      }));

      const { runAutoCleanupAfterDone } = await import('../wu-done-auto-cleanup.js');

      // Should not throw - cleanup errors are non-fatal
      await expect(runAutoCleanupAfterDone('/test/dir')).resolves.not.toThrow();

      // Should log warning about the error
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should skip cleanup when trigger is manual', async () => {
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'manual' },
        }),
      }));

      const mockCleanupState = vi.fn();
      vi.doMock('@lumenflow/core/dist/state-cleanup-core.js', () => ({
        cleanupState: mockCleanupState,
      }));

      const { runAutoCleanupAfterDone } = await import('../wu-done-auto-cleanup.js');
      await runAutoCleanupAfterDone('/test/dir');

      // Cleanup should not be called when trigger is manual
      expect(mockCleanupState).not.toHaveBeenCalled();
    });
  });

  // WU-1533: Config re-read after merge
  describe('shouldRunAutoCleanup config reload (WU-1533)', () => {
    it('should call getConfig with reload: true to re-read config after merge', async () => {
      const mockGetConfig = vi.fn().mockReturnValue({
        cleanup: { trigger: 'on_done' },
      });

      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: mockGetConfig,
      }));

      const { shouldRunAutoCleanup } = await import('../wu-done-auto-cleanup.js');
      shouldRunAutoCleanup();

      // WU-1533: Must use reload: true so merged config changes are respected
      expect(mockGetConfig).toHaveBeenCalledWith({ reload: true });
    });

    it('should respect cleanup.trigger: manual from freshly-merged config', async () => {
      // Simulate: first call returns on_done (cached), but reload returns manual (merged)
      const mockGetConfig = vi.fn().mockReturnValue({
        cleanup: { trigger: 'manual' },
      });

      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: mockGetConfig,
      }));

      const { shouldRunAutoCleanup } = await import('../wu-done-auto-cleanup.js');
      const result = shouldRunAutoCleanup();

      expect(result).toBe(false);
      expect(mockGetConfig).toHaveBeenCalledWith({ reload: true });
    });
  });

  // WU-1533: Auto-commit cleanup changes to prevent dirty main
  describe('commitCleanupChanges (WU-1533)', () => {
    it('should commit and push when cleanup dirtied tracked state files', async () => {
      const mockGetStatus = vi.fn().mockResolvedValue(' M .lumenflow/state/wu-events.jsonl');
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRaw = vi.fn().mockResolvedValue('');
      const mockPush = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          raw: mockRaw,
          push: mockPush,
        }),
      }));

      // WU-1542: Mock config to provide default commit message
      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_done' },
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      expect(mockAdd).toHaveBeenCalledWith(['.lumenflow/state/wu-events.jsonl']);
      // WU-1542: Default commit message no longer uses chore(lumenflow): scope
      expect(mockCommit).toHaveBeenCalledWith(
        expect.stringContaining('chore: lumenflow state cleanup'),
      );
      expect(mockPush).toHaveBeenCalled();
    });

    it('should be a no-op when main is clean after cleanup', async () => {
      const mockGetStatus = vi.fn().mockResolvedValue('');
      const mockAdd = vi.fn();
      const mockCommit = vi.fn();
      const mockPush = vi.fn();

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          push: mockPush,
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      // No dirty files = no commit
      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockCommit).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should not throw when commit or push fails (non-fatal)', async () => {
      const mockGetStatus = vi.fn().mockResolvedValue(' M .lumenflow/state/wu-events.jsonl');
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockRejectedValue(new Error('commit failed'));

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');

      // Should not throw - commit failures are non-fatal
      await expect(commitCleanupChanges()).resolves.not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    // WU-1542: Configurable commit message
    it('should use configurable commit message from config', async () => {
      const mockGetStatus = vi.fn().mockResolvedValue(' M .lumenflow/state/wu-events.jsonl');
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRaw = vi.fn().mockResolvedValue('');
      const mockPush = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          raw: mockRaw,
          push: mockPush,
        }),
      }));

      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: {
            trigger: 'on_done',
            commit_message: 'chore(repair): auto state cleanup [skip ci]',
          },
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      expect(mockCommit).toHaveBeenCalledWith('chore(repair): auto state cleanup [skip ci]');
    });

    it('should use default commit message when config does not specify one', async () => {
      const mockGetStatus = vi.fn().mockResolvedValue(' M .lumenflow/state/wu-events.jsonl');
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRaw = vi.fn().mockResolvedValue('');
      const mockPush = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          raw: mockRaw,
          push: mockPush,
        }),
      }));

      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_done' },
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      // WU-1542: Default must NOT use chore(lumenflow): scope - breaks consumer guards
      expect(mockCommit).toHaveBeenCalledWith('chore: lumenflow state cleanup [skip ci]');
    });

    it('should only commit .lumenflow/ managed files, not unrelated dirty files', async () => {
      // Mixed dirty state: state file + archive file + unrelated file
      const mockGetStatus = vi
        .fn()
        .mockResolvedValue(
          ' M .lumenflow/state/wu-events.jsonl\n' +
            ' M .lumenflow/archive/wu-events-2026-01.jsonl\n' +
            ' M src/unrelated.ts',
        );
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRaw = vi.fn().mockResolvedValue('');
      const mockPush = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          raw: mockRaw,
          push: mockPush,
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      // Should add both state and archive files, but not unrelated files
      expect(mockAdd).toHaveBeenCalledWith([
        '.lumenflow/state/wu-events.jsonl',
        '.lumenflow/archive/wu-events-2026-01.jsonl',
      ]);
    });

    // WU-1553: Archive files must also be staged
    it('should stage archive files created by archiveWuEvents (WU-1553)', async () => {
      // Only archive files dirty (no state files changed)
      const mockGetStatus = vi
        .fn()
        .mockResolvedValue('?? .lumenflow/archive/wu-events-2026-01.jsonl');
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRaw = vi.fn().mockResolvedValue('');
      const mockPush = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          raw: mockRaw,
          push: mockPush,
        }),
      }));

      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_done' },
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      expect(mockAdd).toHaveBeenCalledWith(['.lumenflow/archive/wu-events-2026-01.jsonl']);
      expect(mockCommit).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalled();
    });

    it('should stage both state and archive files together (WU-1553)', async () => {
      // Both state and archive files dirty
      const mockGetStatus = vi
        .fn()
        .mockResolvedValue(
          ' M .lumenflow/state/wu-events.jsonl\n' +
            '?? .lumenflow/archive/wu-events-2025-11.jsonl\n' +
            ' M .lumenflow/archive/wu-events-2026-01.jsonl',
        );
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRaw = vi.fn().mockResolvedValue('');
      const mockPush = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@lumenflow/core/dist/git-adapter.js', () => ({
        getGitForCwd: vi.fn().mockReturnValue({
          getStatus: mockGetStatus,
          add: mockAdd,
          commit: mockCommit,
          raw: mockRaw,
          push: mockPush,
        }),
      }));

      vi.doMock(CONFIG_MODULE_PATH, () => ({
        getConfig: vi.fn().mockReturnValue({
          cleanup: { trigger: 'on_done' },
        }),
      }));

      const { commitCleanupChanges } = await import('../wu-done-auto-cleanup.js');
      await commitCleanupChanges();

      expect(mockAdd).toHaveBeenCalledWith([
        '.lumenflow/state/wu-events.jsonl',
        '.lumenflow/archive/wu-events-2025-11.jsonl',
        '.lumenflow/archive/wu-events-2026-01.jsonl',
      ]);
    });
  });
});
