/**
 * @file wu-done-auto-cleanup.test.ts
 * Test suite for wu:done auto cleanup on success (WU-1366)
 *
 * WU-1366: State cleanup runs automatically after wu:done success (non-fatal)
 *
 * Tests:
 * - shouldRunAutoCleanup respects config.cleanup.trigger setting
 * - runAutoCleanupAfterDone is non-fatal (logs errors but doesn't throw)
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
});
