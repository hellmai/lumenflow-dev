/**
 * Tests for spec branch handling in wu:create and wu:claim
 *
 * WU-1062: External plan storage and no-main-write mode
 *
 * Tests the spec branch workflow:
 * - wu:create defaults to spec branch (spec/wu-XXXX)
 * - wu:create --direct uses legacy main-write mode
 * - wu:claim detects and merges spec branch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import after mocking (placeholders for now - will implement)
import {
  getSpecBranchName,
  specBranchExists,
  mergeSpecBranchToMain,
  isWUOnMain,
} from '../spec-branch-helpers.js';

describe('spec-branch-helpers', () => {
  describe('getSpecBranchName', () => {
    it('should return spec/wu-XXXX for a given WU ID', () => {
      const result = getSpecBranchName('WU-1062');
      expect(result).toBe('spec/wu-1062');
    });

    it('should lowercase the WU ID', () => {
      const result = getSpecBranchName('WU-TEST-100');
      expect(result).toBe('spec/wu-test-100');
    });
  });

  describe('specBranchExists', () => {
    it('should return true if spec branch exists on origin', async () => {
      // Mock git adapter
      const mockGit = {
        branchExists: vi.fn().mockResolvedValue(true),
      };
      const result = await specBranchExists('WU-1062', mockGit as any);
      expect(result).toBe(true);
      expect(mockGit.branchExists).toHaveBeenCalledWith('origin/spec/wu-1062');
    });

    it('should return false if spec branch does not exist', async () => {
      const mockGit = {
        branchExists: vi.fn().mockResolvedValue(false),
      };
      const result = await specBranchExists('WU-1062', mockGit as any);
      expect(result).toBe(false);
    });
  });

  describe('isWUOnMain', () => {
    it('should return true if WU YAML exists on main', async () => {
      const mockGit = {
        raw: vi.fn().mockResolvedValue('WU-1062.yaml'),
      };
      const result = await isWUOnMain('WU-1062', mockGit as any);
      expect(result).toBe(true);
    });

    it('should return false if WU YAML does not exist on main', async () => {
      const mockGit = {
        raw: vi.fn().mockRejectedValue(new Error('file not found')),
      };
      const result = await isWUOnMain('WU-1062', mockGit as any);
      expect(result).toBe(false);
    });
  });

  describe('mergeSpecBranchToMain', () => {
    it('should fetch and merge spec branch with ff-only', async () => {
      const mockGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      };

      await mergeSpecBranchToMain('WU-1062', mockGit as any);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'spec/wu-1062');
      expect(mockGit.merge).toHaveBeenCalledWith(['origin/spec/wu-1062', '--ff-only']);
    });

    it('should throw if merge fails due to conflicts', async () => {
      const mockGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockRejectedValue(new Error('merge conflict')),
      };

      await expect(mergeSpecBranchToMain('WU-1062', mockGit as any))
        .rejects.toThrow('merge conflict');
    });
  });
});
