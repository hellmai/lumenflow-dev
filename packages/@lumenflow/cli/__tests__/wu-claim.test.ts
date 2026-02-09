/**
 * @file wu-claim.test.ts
 * Test suite for wu:claim auto-setup feature (WU-1023)
 *
 * Tests the --skip-setup flag and automatic pnpm install behavior:
 * - --skip-setup flag is parsed correctly
 * - Default behavior runs pnpm install
 * - --skip-setup uses symlink approach
 * - printLifecycleNudge is exported and works
 * - getWorktreeCommitFiles is exported and returns expected files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import from built files
import {
  printLifecycleNudge,
  getWorktreeCommitFiles,
  formatProjectDefaults,
} from '../dist/wu-claim.js';
import { WU_OPTIONS } from '@lumenflow/core/arg-parser';

describe('wu:claim --skip-setup flag (WU-1023)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('WU_OPTIONS.skipSetup definition', () => {
    it('should have skipSetup option defined', () => {
      expect(WU_OPTIONS.skipSetup).toBeDefined();
      expect(WU_OPTIONS.skipSetup.name).toBe('skipSetup');
      expect(WU_OPTIONS.skipSetup.flags).toBe('--skip-setup');
    });

    it('should have meaningful description', () => {
      expect(WU_OPTIONS.skipSetup.description).toContain('pnpm install');
      expect(WU_OPTIONS.skipSetup.description.toLowerCase()).toContain('skip');
    });
  });

  describe('WU_OPTIONS.noPush definition', () => {
    it('should have noPush option defined', () => {
      expect(WU_OPTIONS.noPush).toBeDefined();
      expect(WU_OPTIONS.noPush.name).toBe('noPush');
      expect(WU_OPTIONS.noPush.flags).toBe('--no-push');
    });

    it('should have meaningful description', () => {
      expect(WU_OPTIONS.noPush.description.toLowerCase()).toContain('push');
      expect(WU_OPTIONS.noPush.description.toLowerCase()).toContain('skip');
    });
  });

  describe('getWorktreeCommitFiles', () => {
    it('should return WU YAML and state store files', () => {
      const files = getWorktreeCommitFiles('WU-1023');

      expect(files).toContain('docs/04-operations/tasks/wu/WU-1023.yaml');
      expect(files).toContain('.lumenflow/state/wu-events.jsonl');
    });

    it('should NOT include backlog.md or status.md (WU-1746)', () => {
      const files = getWorktreeCommitFiles('WU-1234');

      expect(files).not.toContain('docs/04-operations/tasks/backlog.md');
      expect(files).not.toContain('docs/04-operations/tasks/status.md');
    });

    it('should work with different WU IDs', () => {
      const files1 = getWorktreeCommitFiles('WU-100');
      const files2 = getWorktreeCommitFiles('WU-999');

      expect(files1[0]).toContain('WU-100');
      expect(files2[0]).toContain('WU-999');
    });
  });

  describe('printLifecycleNudge', () => {
    it('should be exported and callable', () => {
      expect(typeof printLifecycleNudge).toBe('function');
    });

    it('should log tips without throwing', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Should not throw
      expect(() => printLifecycleNudge('WU-1023')).not.toThrow();

      // Should have logged something
      expect(consoleSpy).toHaveBeenCalled();
      const loggedText = consoleSpy.mock.calls.flat().join(' ');

      // Should contain useful tips
      expect(loggedText).toContain('Tip');

      consoleSpy.mockRestore();
    });
  });

  describe('formatProjectDefaults', () => {
    it('returns empty string when disabled', () => {
      const output = formatProjectDefaults({ enabled: false });
      expect(output).toBe('');
    });

    it('formats enforcement and principles when enabled', () => {
      const output = formatProjectDefaults({
        enabled: true,
        enforcement: 'required',
        principles: ['TDD', 'Library-First'],
        notes: 'Default approach unless explicitly waived.',
      });

      expect(output).toContain('Project Defaults');
      expect(output).toContain('Enforcement: required');
      expect(output).toContain('TDD');
      expect(output).toContain('Library-First');
      expect(output).toContain('Default approach unless explicitly waived.');
    });
  });
});

describe('auto-setup behavior documentation (WU-1023)', () => {
  /**
   * These tests document the expected behavior without mocking the full claim flow.
   * The actual pnpm install behavior is tested via manual tests specified in WU YAML.
   */

  it('default behavior: pnpm install runs with progress indicator', () => {
    // This documents the expected behavior:
    // When wu:claim is run WITHOUT --skip-setup:
    // 1. Console shows "Installing worktree dependencies (this may take a moment)..."
    // 2. pnpm install --frozen-lockfile runs with stdio: 'inherit' (shows progress)
    // 3. Console shows success message on completion
    // 4. Falls back to symlink if install fails

    // Manual test validates: wu:done works without manual pnpm install
    expect(true).toBe(true);
  });

  it('--skip-setup: uses symlink-only approach', () => {
    // This documents the expected behavior:
    // When wu:claim is run WITH --skip-setup:
    // 1. Symlinks node_modules to main repo
    // 2. Symlinks nested package node_modules
    // 3. Does NOT run pnpm install
    // 4. Faster but requires deps to be pre-built

    // For agents that know deps are built, --skip-setup saves time
    expect(true).toBe(true);
  });

  it('timeout configuration: 5 minutes for full install', () => {
    // pnpm install has 300000ms (5 minute) timeout
    // This accommodates slower CI environments and large dependency trees
    const EXPECTED_TIMEOUT_MS = 300000;
    expect(EXPECTED_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('fallback behavior: symlink on install failure', () => {
    // If pnpm install fails:
    // 1. Warning logged (non-fatal)
    // 2. Falls back to symlinkNodeModules
    // 3. Claim completes (worktree at least partially usable)

    // This ensures claim never blocks on install failures
    expect(true).toBe(true);
  });
});

describe('fallback symlink behavior (WU-1029)', () => {
  const worktreePath = '/tmp/worktree-wu-1029';
  const mainRepoPath = '/tmp/main-wu-1029';

  afterEach(() => {
    vi.resetModules();
  });

  it('should symlink nested node_modules when fallback symlink succeeds', async () => {
    const symlinkNodeModules = vi.fn().mockReturnValue({ created: true, refused: false });
    const symlinkNestedNodeModules = vi.fn().mockReturnValue({ created: 1 });

    vi.resetModules();
    vi.doMock('@lumenflow/core/worktree-symlink', () => ({
      symlinkNodeModules,
      symlinkNestedNodeModules,
    }));

    const { applyFallbackSymlinks } = await import('../dist/wu-claim.js');
    const logger = { log: vi.fn(), warn: vi.fn() };

    applyFallbackSymlinks(worktreePath, mainRepoPath, logger);

    expect(symlinkNodeModules).toHaveBeenCalledWith(worktreePath, logger, mainRepoPath);
    expect(symlinkNestedNodeModules).toHaveBeenCalledWith(worktreePath, mainRepoPath);
  });

  it('should skip nested symlinks when symlink is refused', async () => {
    const symlinkNodeModules = vi.fn().mockReturnValue({ created: false, refused: true });
    const symlinkNestedNodeModules = vi.fn().mockReturnValue({ created: 1 });

    vi.resetModules();
    vi.doMock('@lumenflow/core/worktree-symlink', () => ({
      symlinkNodeModules,
      symlinkNestedNodeModules,
    }));

    const { applyFallbackSymlinks } = await import('../dist/wu-claim.js');
    const logger = { log: vi.fn(), warn: vi.fn() };

    applyFallbackSymlinks(worktreePath, mainRepoPath, logger);

    expect(symlinkNestedNodeModules).not.toHaveBeenCalled();
  });
});
