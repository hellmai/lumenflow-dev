/**
 * @file git-state-reader.test.ts
 * @description Tests for git state reading (branch, dirty, staged, ahead/behind)
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - These tests are written FIRST, before implementation.
 *
 * Tests cover:
 * - Current branch detection
 * - Dirty working tree detection
 * - Staged changes detection
 * - Ahead/behind tracking branch
 * - Detached HEAD handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SimpleGit, StatusResult } from 'simple-git';

// Mock simple-git before importing the module
vi.mock('simple-git', () => {
  const mockGit = {
    status: vi.fn(),
    revparse: vi.fn(),
    raw: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

import { readGitState, type GitState } from '../../context/git-state-reader.js';
import { simpleGit } from 'simple-git';

describe('readGitState', () => {
  let mockGit: {
    status: ReturnType<typeof vi.fn>;
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

  describe('branch detection', () => {
    it('returns current branch name', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.branch).toBe('main');
    });

    it('detects lane branch format', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'lane/framework-core/wu-1090',
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: 'origin/main',
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.branch).toBe('lane/framework-core/wu-1090');
    });

    it('detects detached HEAD state', async () => {
      // Arrange - detached HEAD returns null for current
      mockGit.status.mockResolvedValueOnce({
        current: null,
        detached: true,
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.branch).toBeNull();
      expect(result.isDetached).toBe(true);
    });
  });

  describe('dirty state detection', () => {
    it('detects clean working tree', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.isDirty).toBe(false);
    });

    it('detects dirty working tree with modified files', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => false,
        files: [{ path: 'file.ts', working_dir: 'M' }],
        staged: [],
        modified: ['file.ts'],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.isDirty).toBe(true);
    });

    it('detects dirty working tree with untracked files', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => false,
        files: [{ path: 'newfile.ts', working_dir: '?' }],
        not_added: ['newfile.ts'],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.isDirty).toBe(true);
    });
  });

  describe('staged changes detection', () => {
    it('detects no staged changes', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => false,
        files: [{ path: 'file.ts', working_dir: 'M', index: ' ' }],
        staged: [],
        modified: ['file.ts'],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.hasStaged).toBe(false);
    });

    it('detects staged changes', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => false,
        files: [{ path: 'file.ts', index: 'M' }],
        staged: ['file.ts'],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.hasStaged).toBe(true);
    });
  });

  describe('ahead/behind tracking', () => {
    it('detects commits ahead of tracking branch', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 3,
        behind: 0,
        tracking: 'origin/main',
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.ahead).toBe(3);
      expect(result.behind).toBe(0);
      expect(result.tracking).toBe('origin/main');
    });

    it('detects commits behind tracking branch', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 5,
        tracking: 'origin/main',
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(5);
    });

    it('handles branch with no tracking', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'feature-branch',
        isClean: () => true,
        files: [],
        staged: [],
        modified: [],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.tracking).toBeNull();
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });
  });

  describe('error handling', () => {
    it('returns unknown state on git error', async () => {
      // Arrange
      mockGit.status.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      // Act
      const result = await readGitState('/not-a-repo');

      // Assert
      expect(result.branch).toBeNull();
      expect(result.isDetached).toBe(false);
      expect(result.isDirty).toBe(false);
      expect(result.hasError).toBe(true);
      expect(result.errorMessage).toContain('not a git repository');
    });
  });

  describe('modified files list', () => {
    it('returns list of modified file paths', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        current: 'main',
        isClean: () => false,
        files: [
          { path: 'src/index.ts', working_dir: 'M' },
          { path: 'src/utils.ts', working_dir: 'M' },
        ],
        staged: [],
        modified: ['src/index.ts', 'src/utils.ts'],
        ahead: 0,
        behind: 0,
        tracking: null,
      } as unknown as StatusResult);

      // Act
      const result = await readGitState('/repo');

      // Assert
      expect(result.modifiedFiles).toEqual(['src/index.ts', 'src/utils.ts']);
    });
  });
});
