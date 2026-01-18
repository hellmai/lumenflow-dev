/**
 * WU-2278: Hardening Tests
 *
 * Tests for:
 * - (H1) Worktree ownership validation
 * - (H2) Piped pnpm command blocking
 * - (H3) Cleanup install timeout and CI=true
 * - (L1) cleanup.lock in .gitignore (not tested here - manual verification)
 * - (L2) Commit message casing for proper nouns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// H1: Worktree ownership validation
describe('WU-2278 H1: Worktree ownership validation', () => {
  describe('validateWorktreeOwnership', () => {
    it('blocks deletion when worktree belongs to different WU', async () => {
      const { validateWorktreeOwnership } = await import('../worktree-ownership.js');

      // Worktree path contains WU-100, but we're trying to clean up WU-200
      const result = validateWorktreeOwnership({
        worktreePath: 'worktrees/operations-wu-100',
        wuId: 'WU-200',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('ownership mismatch');
    });

    it('allows deletion when worktree belongs to same WU', async () => {
      const { validateWorktreeOwnership } = await import('../worktree-ownership.js');

      const result = validateWorktreeOwnership({
        worktreePath: 'worktrees/operations-wu-100',
        wuId: 'WU-100',
      });

      expect(result.valid).toBe(true);
    });

    it('allows deletion when worktree path uses lowercase', async () => {
      const { validateWorktreeOwnership } = await import('../worktree-ownership.js');

      const result = validateWorktreeOwnership({
        worktreePath: 'worktrees/operations-tooling-wu-2278',
        wuId: 'WU-2278',
      });

      expect(result.valid).toBe(true);
    });

    it('handles worktree path with lane prefix correctly', async () => {
      const { validateWorktreeOwnership } = await import('../worktree-ownership.js');

      const result = validateWorktreeOwnership({
        worktreePath: 'worktrees/experience-chat-wu-500',
        wuId: 'WU-500',
      });

      expect(result.valid).toBe(true);
    });

    it('blocks when WU ID is not found in worktree path', async () => {
      const { validateWorktreeOwnership } = await import('../worktree-ownership.js');

      const result = validateWorktreeOwnership({
        worktreePath: 'worktrees/some-random-branch',
        wuId: 'WU-100',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('ownership');
    });

    it('handles null/undefined worktree path gracefully', async () => {
      const { validateWorktreeOwnership } = await import('../worktree-ownership.js');

      expect(validateWorktreeOwnership({ worktreePath: null, wuId: 'WU-100' }).valid).toBe(true);
      expect(validateWorktreeOwnership({ worktreePath: undefined, wuId: 'WU-100' }).valid).toBe(
        true,
      );
    });
  });
});

// H2: Piped pnpm command blocking
describe('WU-2278 H2: Piped pnpm command detection', () => {
  describe('isPipedPnpmCommand', () => {
    it('detects piped pnpm add command', async () => {
      const { isPipedPnpmCommand } = await import('../piped-command-detector.js');

      expect(isPipedPnpmCommand('echo "y" | pnpm add foo')).toBe(true);
      expect(isPipedPnpmCommand('yes | pnpm install')).toBe(true);
    });

    it('detects pnpm command with redirection', async () => {
      const { isPipedPnpmCommand } = await import('../piped-command-detector.js');

      expect(isPipedPnpmCommand('pnpm add foo < /dev/null')).toBe(true);
      expect(isPipedPnpmCommand('pnpm install < input.txt')).toBe(true);
    });

    it('does not flag non-piped pnpm commands', async () => {
      const { isPipedPnpmCommand } = await import('../piped-command-detector.js');

      expect(isPipedPnpmCommand('pnpm add foo')).toBe(false);
      expect(isPipedPnpmCommand('pnpm install')).toBe(false);
      expect(isPipedPnpmCommand('pnpm test:unit')).toBe(false);
    });

    it('detects heredoc with pnpm', async () => {
      const { isPipedPnpmCommand } = await import('../piped-command-detector.js');

      expect(isPipedPnpmCommand('pnpm add foo <<< "y"')).toBe(true);
    });

    it('handles complex pipe chains', async () => {
      const { isPipedPnpmCommand } = await import('../piped-command-detector.js');

      // Only care if pnpm is receiving piped input
      expect(isPipedPnpmCommand('pnpm test | grep foo')).toBe(false); // pnpm is NOT receiving input
      expect(isPipedPnpmCommand('cat package.json | pnpm install')).toBe(true); // pnpm IS receiving input
    });
  });
});

// H3: Cleanup install timeout and CI=true
describe('WU-2278 H3: Cleanup install configuration', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getCleanupInstallConfig', () => {
    it('returns command with CI=true for non-interactive mode', async () => {
      const { getCleanupInstallConfig } = await import('../cleanup-install-config.js');

      const config = getCleanupInstallConfig();

      expect(config.env.CI).toBe('true');
    });

    it('returns 60 second timeout', async () => {
      const { getCleanupInstallConfig, CLEANUP_INSTALL_TIMEOUT_MS } =
        await import('../cleanup-install-config.js');

      const config = getCleanupInstallConfig();

      expect(config.timeout).toBe(CLEANUP_INSTALL_TIMEOUT_MS);
      expect(CLEANUP_INSTALL_TIMEOUT_MS).toBe(60000); // 60 seconds
    });

    it('includes frozen-lockfile flag', async () => {
      const { getCleanupInstallConfig } = await import('../cleanup-install-config.js');

      const config = getCleanupInstallConfig();

      expect(config.command).toContain('--frozen-lockfile');
    });
  });
});

// L2: Commit message casing
describe('WU-2278 L2: Commit message lowercasing', () => {
  describe('lowercaseCommitSubject', () => {
    it('lowercases entire subject, not just first character', async () => {
      const { lowercaseCommitSubject } = await import('../commit-message-utils.js');

      // "Supabase" should become "supabase"
      const result = lowercaseCommitSubject('feat(wu-100): Add Supabase integration');

      expect(result).toBe('feat(wu-100): add supabase integration');
    });

    it('preserves type and scope', async () => {
      const { lowercaseCommitSubject } = await import('../commit-message-utils.js');

      const result = lowercaseCommitSubject('fix(WU-200): Fix OpenAI API call');

      // Note: scope (WU-200) is NOT lowercased by this function - that's handled separately
      expect(result).toMatch(/^fix\([^)]+\): fix openai api call$/);
    });

    it('handles message without conventional prefix', async () => {
      const { lowercaseCommitSubject } = await import('../commit-message-utils.js');

      const result = lowercaseCommitSubject('Update README for Vercel deployment');

      expect(result).toBe('update readme for vercel deployment');
    });

    it('handles message that is already lowercase', async () => {
      const { lowercaseCommitSubject } = await import('../commit-message-utils.js');

      const result = lowercaseCommitSubject('feat(wu-100): add feature');

      expect(result).toBe('feat(wu-100): add feature');
    });

    it('lowercases proper nouns like Supabase, Vercel, OpenAI', async () => {
      const { lowercaseCommitSubject } = await import('../commit-message-utils.js');

      expect(lowercaseCommitSubject('docs: Update Supabase config')).toBe(
        'docs: update supabase config',
      );
      expect(lowercaseCommitSubject('feat: Add Vercel deployment')).toBe(
        'feat: add vercel deployment',
      );
      expect(lowercaseCommitSubject('fix: Fix OpenAI timeout')).toBe('fix: fix openai timeout');
    });
  });
});
