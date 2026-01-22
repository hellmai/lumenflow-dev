/**
 * Tests for wu:claim spec branch detection and merge (WU-1062)
 *
 * These tests verify the spec branch helpers work correctly for wu:claim integration:
 * - getWUSource detects where WU exists (main, spec branch, both, neither)
 * - mergeSpecBranchToMain correctly merges spec branch
 * - Edge cases: spec branch doesn't exist, WU already on main, conflicts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getSpecBranchName,
  specBranchExists,
  isWUOnMain,
  mergeSpecBranchToMain,
  getWUSource,
  WU_SOURCE,
} from '../spec-branch-helpers.js';

describe('wu:claim spec branch helpers (WU-1062)', () => {
  describe('getWUSource', () => {
    it('should return MAIN when WU exists on main only', async () => {
      const mockGit = {
        raw: vi.fn().mockImplementation((args) => {
          // ls-tree for main check returns data if file exists
          if (args[0] === 'ls-tree' && args[1] === 'origin/main') {
            return '100644 blob abc123\tdocs/04-operations/tasks/wu/WU-1062.yaml';
          }
          // ls-remote for spec branch returns empty if no branch
          if (args[0] === 'ls-remote') {
            return '';
          }
          throw new Error('unexpected args');
        }),
      };

      const result = await getWUSource('WU-1062', mockGit as any);

      expect(result).toBe(WU_SOURCE.MAIN);
    });

    it('should return SPEC_BRANCH when WU exists on spec branch only', async () => {
      const mockGit = {
        raw: vi.fn().mockImplementation((args) => {
          // ls-tree for main check throws if file doesn't exist
          if (args[0] === 'ls-tree' && args[1] === 'origin/main') {
            throw new Error('path not found');
          }
          // ls-remote for spec branch returns data if branch exists
          if (args[0] === 'ls-remote') {
            return 'abc123\trefs/heads/spec/wu-1062';
          }
          throw new Error('unexpected args');
        }),
      };

      const result = await getWUSource('WU-1062', mockGit as any);

      expect(result).toBe(WU_SOURCE.SPEC_BRANCH);
    });

    it('should return BOTH when WU exists on both main and spec branch', async () => {
      const mockGit = {
        raw: vi.fn().mockImplementation((args) => {
          // Both checks return data
          if (args[0] === 'ls-tree') {
            return '100644 blob abc123\tdocs/04-operations/tasks/wu/WU-1062.yaml';
          }
          if (args[0] === 'ls-remote') {
            return 'abc123\trefs/heads/spec/wu-1062';
          }
          throw new Error('unexpected args');
        }),
      };

      const result = await getWUSource('WU-1062', mockGit as any);

      expect(result).toBe(WU_SOURCE.BOTH);
    });

    it('should return NOT_FOUND when WU does not exist anywhere', async () => {
      const mockGit = {
        raw: vi.fn().mockImplementation((args) => {
          // ls-tree for main check throws
          if (args[0] === 'ls-tree') {
            throw new Error('path not found');
          }
          // ls-remote returns empty
          if (args[0] === 'ls-remote') {
            return '';
          }
          throw new Error('unexpected args');
        }),
      };

      const result = await getWUSource('WU-1062', mockGit as any);

      expect(result).toBe(WU_SOURCE.NOT_FOUND);
    });
  });

  describe('mergeSpecBranchToMain edge cases', () => {
    it('should throw descriptive error on ff-only merge failure', async () => {
      const mockGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockRejectedValue(new Error('Not possible to fast-forward')),
      };

      await expect(mergeSpecBranchToMain('WU-1062', mockGit as any)).rejects.toThrow(
        'Not possible to fast-forward',
      );
    });

    it('should fetch and merge with correct branch name', async () => {
      const mockGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
      };

      await mergeSpecBranchToMain('WU-1062', mockGit as any);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'spec/wu-1062');
      expect(mockGit.merge).toHaveBeenCalledWith(['origin/spec/wu-1062', '--ff-only']);
    });
  });

  describe('specBranchExists with various branch patterns', () => {
    it('should match lowercase wu id via ls-remote', async () => {
      const mockGit = {
        raw: vi.fn().mockResolvedValue('abc123\trefs/heads/spec/wu-1062'),
      };

      const result = await specBranchExists('WU-1062', mockGit as any);

      expect(result).toBe(true);
    });

    it('should return false when ls-remote returns empty', async () => {
      const mockGit = {
        raw: vi.fn().mockResolvedValue(''),
      };

      const result = await specBranchExists('WU-1062', mockGit as any);

      expect(result).toBe(false);
    });
  });

  describe('isWUOnMain', () => {
    it('should return true when ls-tree succeeds', async () => {
      const mockGit = {
        raw: vi.fn().mockResolvedValue('100644 blob abc123\tdocs/04-operations/tasks/wu/WU-1062.yaml'),
      };

      const result = await isWUOnMain('WU-1062', mockGit as any);

      expect(result).toBe(true);
    });

    it('should return false when ls-tree throws', async () => {
      const mockGit = {
        raw: vi.fn().mockRejectedValue(new Error('path not found')),
      };

      const result = await isWUOnMain('WU-1062', mockGit as any);

      expect(result).toBe(false);
    });
  });
});
