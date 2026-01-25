/**
 * @file location-resolver.test.ts
 * @description Tests for WU location resolution (main vs worktree detection)
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - These tests are written FIRST, before implementation.
 *
 * Tests cover:
 * - Detecting main checkout vs worktree
 * - Extracting WU ID from worktree path
 * - Finding main checkout path from worktree
 * - Handling edge cases (detached HEAD, unknown state)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SimpleGit } from 'simple-git';

// Mock simple-git before importing the module
vi.mock('simple-git', () => {
  const mockGit = {
    revparse: vi.fn(),
    raw: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

// Mock fs.statSync for .git file detection
vi.mock('node:fs', () => ({
  statSync: vi.fn(),
}));

import { resolveLocation, type LocationContext } from '../../context/location-resolver.js';
import { simpleGit } from 'simple-git';
import { statSync } from 'node:fs';
import { CONTEXT_VALIDATION } from '../../wu-constants.js';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;

describe('resolveLocation', () => {
  let mockGit: {
    revparse: ReturnType<typeof vi.fn>;
    raw: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = (simpleGit as unknown as ReturnType<typeof vi.fn>)() as typeof mockGit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('main checkout detection', () => {
    it('detects main checkout when .git is a directory', async () => {
      // Arrange
      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo\n') // --show-toplevel
        .mockResolvedValueOnce('.git\n'); // --git-dir

      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      // Act
      const result = await resolveLocation('/home/user/repo');

      // Assert
      expect(result.type).toBe(LOCATION_TYPES.MAIN);
      expect(result.worktreeName).toBeNull();
      expect(result.worktreeWuId).toBeNull();
      expect(result.mainCheckout).toBe('/home/user/repo');
    });

    it('sets cwd to the provided directory', async () => {
      // Arrange
      mockGit.revparse.mockResolvedValueOnce('/home/user/repo\n').mockResolvedValueOnce('.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      // Act
      const result = await resolveLocation('/home/user/repo');

      // Assert
      expect(result.cwd).toBe('/home/user/repo');
    });
  });

  describe('worktree detection', () => {
    it('detects worktree when .git is a file (not directory)', async () => {
      // Arrange
      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo/worktrees/framework-core-wu-1090\n') // --show-toplevel
        .mockResolvedValueOnce('/home/user/repo/worktrees/framework-core-wu-1090/.git\n'); // --git-dir

      // In worktrees, .git is a file pointing to the main .git directory
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      // Mock worktree list to find main checkout
      mockGit.raw.mockResolvedValueOnce(
        'worktree /home/user/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /home/user/repo/worktrees/framework-core-wu-1090\nHEAD def456\nbranch refs/heads/lane/framework-core/wu-1090\n',
      );

      // Act
      const result = await resolveLocation('/home/user/repo/worktrees/framework-core-wu-1090');

      // Assert
      expect(result.type).toBe(LOCATION_TYPES.WORKTREE);
      expect(result.mainCheckout).toBe('/home/user/repo');
    });

    it('extracts worktree name from path', async () => {
      // Arrange
      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo/worktrees/operations-wu-42\n')
        .mockResolvedValueOnce('/home/user/repo/worktrees/operations-wu-42/.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      mockGit.raw.mockResolvedValueOnce('worktree /home/user/repo\n');

      // Act
      const result = await resolveLocation('/home/user/repo/worktrees/operations-wu-42');

      // Assert
      expect(result.worktreeName).toBe('operations-wu-42');
    });

    it('extracts WU ID from worktree name using PATTERNS constant', async () => {
      // Arrange
      vi.clearAllMocks();
      mockGit = (simpleGit as unknown as ReturnType<typeof vi.fn>)() as typeof mockGit;

      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo/worktrees/framework-core-wu-1090\n')
        .mockResolvedValueOnce('/home/user/repo/worktrees/framework-core-wu-1090/.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      mockGit.raw.mockResolvedValueOnce('worktree /home/user/repo\n');

      // Act
      const result = await resolveLocation('/home/user/repo/worktrees/framework-core-wu-1090');

      // Assert - WU ID should be uppercase
      expect(result.worktreeWuId).toBe('WU-1090');
    });

    it('extracts WU ID (format wu-42)', async () => {
      // Arrange
      vi.clearAllMocks();
      mockGit = (simpleGit as unknown as ReturnType<typeof vi.fn>)() as typeof mockGit;

      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo/worktrees/operations-tooling-wu-42\n')
        .mockResolvedValueOnce('/home/user/repo/worktrees/operations-tooling-wu-42/.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      mockGit.raw.mockResolvedValueOnce('worktree /home/user/repo\n');

      // Act
      const result = await resolveLocation('/home/user/repo/worktrees/operations-tooling-wu-42');

      // Assert
      expect(result.worktreeWuId).toBe('WU-42');
    });

    it('extracts WU ID (format wu-1234)', async () => {
      // Arrange
      vi.clearAllMocks();
      mockGit = (simpleGit as unknown as ReturnType<typeof vi.fn>)() as typeof mockGit;

      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo/worktrees/framework-core-wu-1234\n')
        .mockResolvedValueOnce('/home/user/repo/worktrees/framework-core-wu-1234/.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      mockGit.raw.mockResolvedValueOnce('worktree /home/user/repo\n');

      // Act
      const result = await resolveLocation('/home/user/repo/worktrees/framework-core-wu-1234');

      // Assert
      expect(result.worktreeWuId).toBe('WU-1234');
    });
  });

  describe('detached HEAD detection (WU-1096)', () => {
    it('detects detached HEAD state and returns DETACHED location type', async () => {
      // Arrange - HEAD is detached (rev-parse --abbrev-ref HEAD returns 'HEAD')
      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo\n') // --show-toplevel
        .mockResolvedValueOnce('.git\n'); // --git-dir

      // In main checkout, .git is a directory
      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      // Mock git symbolic-ref to throw (indicates detached HEAD)
      mockGit.raw.mockRejectedValueOnce(new Error('fatal: ref HEAD is not a symbolic ref'));

      // Act
      const result = await resolveLocation('/home/user/repo');

      // Assert
      expect(result.type).toBe(LOCATION_TYPES.DETACHED);
      expect(result.mainCheckout).toBe('/home/user/repo');
      expect(result.worktreeName).toBeNull();
    });

    it('does not falsely detect detached HEAD when on a normal branch', async () => {
      // Arrange - HEAD is attached to a branch
      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo\n') // --show-toplevel
        .mockResolvedValueOnce('.git\n'); // --git-dir

      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      // Mock git symbolic-ref to succeed (indicates attached HEAD)
      mockGit.raw.mockResolvedValueOnce('refs/heads/main\n');

      // Act
      const result = await resolveLocation('/home/user/repo');

      // Assert
      expect(result.type).toBe(LOCATION_TYPES.MAIN);
    });
  });

  describe('edge cases', () => {
    it('returns unknown type when git root cannot be determined', async () => {
      // Arrange - git revparse throws error
      mockGit.revparse.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      // Act
      const result = await resolveLocation('/tmp/not-a-repo');

      // Assert
      expect(result.type).toBe(LOCATION_TYPES.UNKNOWN);
    });

    it('handles paths without WU ID gracefully', async () => {
      // Arrange - worktree without WU ID pattern
      mockGit.revparse
        .mockResolvedValueOnce('/home/user/repo/worktrees/some-feature\n')
        .mockResolvedValueOnce('/home/user/repo/worktrees/some-feature/.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      mockGit.raw.mockResolvedValueOnce('worktree /home/user/repo\n');

      // Act
      const result = await resolveLocation('/home/user/repo/worktrees/some-feature');

      // Assert
      expect(result.worktreeName).toBe('some-feature');
      expect(result.worktreeWuId).toBeNull();
    });

    it('defaults cwd to process.cwd() when not provided', async () => {
      // Arrange
      const originalCwd = process.cwd();
      mockGit.revparse.mockResolvedValueOnce(`${originalCwd}\n`).mockResolvedValueOnce('.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      // Act
      const result = await resolveLocation();

      // Assert
      expect(result.cwd).toBe(originalCwd);
    });
  });

  describe('gitRoot resolution', () => {
    it('returns trimmed gitRoot path', async () => {
      // Arrange - path with trailing newline
      mockGit.revparse.mockResolvedValueOnce('/home/user/repo\n').mockResolvedValueOnce('.git\n');

      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      // Act
      const result = await resolveLocation('/home/user/repo');

      // Assert
      expect(result.gitRoot).toBe('/home/user/repo');
      expect(result.gitRoot).not.toContain('\n');
    });
  });
});
