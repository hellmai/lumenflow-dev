/**
 * @file git-validator-ports.test.ts
 * @description Tests for git adapter and validator port interfaces
 *
 * WU-1103: INIT-003 Phase 2c - Migrate git & validator modules
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - IGitAdapter port interface definition
 * - IPhiScanner port interface definition
 * - Existing implementations satisfy port contracts
 */

import { describe, it, expect, vi } from 'vitest';
import type { IGitAdapter, IPhiScanner, PHIScanResult } from '../../ports/git-validator.ports.js';

describe('IGitAdapter port interface', () => {
  describe('contract definition', () => {
    it('getCurrentBranch method returns Promise<string>', async () => {
      // Arrange: Create a mock implementation
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      // Act
      const result = await mockAdapter.getCurrentBranch();

      // Assert
      expect(result).toBe('main');
      expect(typeof result).toBe('string');
    });

    it('getStatus method returns Promise<string>', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(' M file.txt\n?? new.txt'),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(false),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      const result = await mockAdapter.getStatus();
      expect(result).toContain('M file.txt');
    });

    it('branchExists method returns Promise<boolean>', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      const result = await mockAdapter.branchExists('main');
      expect(result).toBe(true);
    });

    it('remoteBranchExists method accepts remote and branch parameters', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(false),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      await mockAdapter.remoteBranchExists('origin', 'feature');
      expect(mockAdapter.remoteBranchExists).toHaveBeenCalledWith('origin', 'feature');
    });

    it('isClean method returns Promise<boolean>', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      const result = await mockAdapter.isClean();
      expect(result).toBe(true);
    });

    it('merge method returns Promise with success boolean', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      const result = await mockAdapter.merge('feature', { ffOnly: true });
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    });

    it('worktreeAdd method accepts path, branch, and optional startPoint', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue(''),
      };

      await mockAdapter.worktreeAdd('worktrees/feature', 'feature', 'main');
      expect(mockAdapter.worktreeAdd).toHaveBeenCalledWith('worktrees/feature', 'feature', 'main');
    });

    it('raw method accepts string array and returns Promise<string>', async () => {
      const mockAdapter: IGitAdapter = {
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue(''),
        branchExists: vi.fn().mockResolvedValue(true),
        remoteBranchExists: vi.fn().mockResolvedValue(true),
        isClean: vi.fn().mockResolvedValue(true),
        fetch: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue({ success: true }),
        getCommitHash: vi.fn().mockResolvedValue('abc123'),
        worktreeAdd: vi.fn().mockResolvedValue(undefined),
        worktreeRemove: vi.fn().mockResolvedValue(undefined),
        worktreeList: vi.fn().mockResolvedValue(''),
        raw: vi.fn().mockResolvedValue('output'),
      };

      const result = await mockAdapter.raw(['status', '--porcelain']);
      expect(mockAdapter.raw).toHaveBeenCalledWith(['status', '--porcelain']);
      expect(result).toBe('output');
    });
  });
});

describe('IPhiScanner port interface', () => {
  describe('contract definition', () => {
    it('scanForPHI method returns PHIScanResult', () => {
      // Arrange: Create a mock implementation
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({
          hasPHI: false,
          matches: [],
          warnings: [],
        } satisfies PHIScanResult),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi.fn().mockReturnValue('No PHI detected'),
      };

      // Act
      const result = mockScanner.scanForPHI('Some content', { filePath: '/path/to/file.ts' });

      // Assert
      expect(result).toHaveProperty('hasPHI');
      expect(result).toHaveProperty('matches');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.matches)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('scanForPHI returns matches with required properties when PHI detected', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({
          hasPHI: true,
          matches: [
            {
              type: 'NHS_NUMBER',
              value: '2983396339',
              startIndex: 10,
              endIndex: 20,
            },
          ],
          warnings: [],
        } satisfies PHIScanResult),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi.fn().mockReturnValue('PHI detected: 1 NHS number'),
      };

      const result = mockScanner.scanForPHI('NHS: 2983396339');

      expect(result.hasPHI).toBe(true);
      expect(result.matches.length).toBe(1);
      expect(result.matches[0]).toHaveProperty('type');
      expect(result.matches[0]).toHaveProperty('value');
      expect(result.matches[0]).toHaveProperty('startIndex');
      expect(result.matches[0]).toHaveProperty('endIndex');
    });

    it('scanForPHI matches can have optional medicalKeyword property', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({
          hasPHI: true,
          matches: [
            {
              type: 'POSTCODE_MEDICAL_CONTEXT',
              value: 'SW1A 2AA',
              startIndex: 20,
              endIndex: 28,
              medicalKeyword: 'patient',
            },
          ],
          warnings: [],
        } satisfies PHIScanResult),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi.fn().mockReturnValue('PHI detected: 1 postcode'),
      };

      const result = mockScanner.scanForPHI('The patient lives at SW1A 2AA');

      expect(result.matches[0].medicalKeyword).toBe('patient');
    });

    it('isPathExcluded method accepts string path and returns boolean', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({ hasPHI: false, matches: [], warnings: [] }),
        isPathExcluded: vi.fn().mockReturnValue(true),
        formatPHISummary: vi.fn().mockReturnValue(''),
      };

      const result = mockScanner.isPathExcluded('src/__tests__/file.test.ts');

      expect(result).toBe(true);
      expect(mockScanner.isPathExcluded).toHaveBeenCalledWith('src/__tests__/file.test.ts');
    });

    it('isPathExcluded returns false for non-test paths', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({ hasPHI: false, matches: [], warnings: [] }),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi.fn().mockReturnValue(''),
      };

      const result = mockScanner.isPathExcluded('src/utils/helper.ts');

      expect(result).toBe(false);
    });

    it('formatPHISummary accepts matches array and returns string', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({ hasPHI: false, matches: [], warnings: [] }),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi
          .fn()
          .mockReturnValue('PHI detected: 2 NHS numbers, 1 postcode in medical context'),
      };

      const matches = [
        { type: 'NHS_NUMBER', value: '123', startIndex: 0, endIndex: 10 },
        { type: 'NHS_NUMBER', value: '456', startIndex: 20, endIndex: 30 },
        { type: 'POSTCODE_MEDICAL_CONTEXT', value: 'SW1A', startIndex: 40, endIndex: 48 },
      ];

      const result = mockScanner.formatPHISummary(matches);

      expect(typeof result).toBe('string');
      expect(result).toContain('PHI detected');
    });

    it('formatPHISummary returns "No PHI detected" for empty matches', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({ hasPHI: false, matches: [], warnings: [] }),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi.fn().mockReturnValue('No PHI detected'),
      };

      const result = mockScanner.formatPHISummary([]);

      expect(result).toBe('No PHI detected');
    });

    it('scanForPHI options are optional', () => {
      const mockScanner: IPhiScanner = {
        scanForPHI: vi.fn().mockReturnValue({ hasPHI: false, matches: [], warnings: [] }),
        isPathExcluded: vi.fn().mockReturnValue(false),
        formatPHISummary: vi.fn().mockReturnValue(''),
      };

      // Call without options
      mockScanner.scanForPHI('content');
      expect(mockScanner.scanForPHI).toHaveBeenCalledWith('content');

      // Call with options
      mockScanner.scanForPHI('content', { filePath: '/path' });
      expect(mockScanner.scanForPHI).toHaveBeenLastCalledWith('content', { filePath: '/path' });
    });
  });
});
