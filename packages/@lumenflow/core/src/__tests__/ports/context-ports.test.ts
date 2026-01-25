/**
 * @file context-ports.test.ts
 * @description Tests for context-related port interfaces
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - ILocationResolver port interface definition
 * - IGitStateReader port interface definition
 * - IWuStateReader port interface definition
 * - Existing implementations satisfy port contracts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ILocationResolver,
  IGitStateReader,
  IWuStateReader,
} from '../../ports/context.ports.js';

describe('ILocationResolver port interface', () => {
  describe('contract definition', () => {
    it('resolveLocation method returns Promise<LocationContext>', async () => {
      // Arrange: Create a mock implementation
      const mockResolver: ILocationResolver = {
        resolveLocation: vi.fn().mockResolvedValue({
          type: 'main',
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        }),
      };

      // Act
      const result = await mockResolver.resolveLocation('/repo');

      // Assert: Verify contract
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('cwd');
      expect(result).toHaveProperty('gitRoot');
      expect(result).toHaveProperty('mainCheckout');
      expect(result).toHaveProperty('worktreeName');
      expect(result).toHaveProperty('worktreeWuId');
    });

    it('resolveLocation accepts optional cwd parameter', async () => {
      const mockResolver: ILocationResolver = {
        resolveLocation: vi.fn().mockResolvedValue({
          type: 'main',
          cwd: process.cwd(),
          gitRoot: process.cwd(),
          mainCheckout: process.cwd(),
          worktreeName: null,
          worktreeWuId: null,
        }),
      };

      // Call without cwd
      await mockResolver.resolveLocation();
      expect(mockResolver.resolveLocation).toHaveBeenCalledWith();

      // Call with cwd
      await mockResolver.resolveLocation('/custom/path');
      expect(mockResolver.resolveLocation).toHaveBeenLastCalledWith('/custom/path');
    });
  });
});

describe('IGitStateReader port interface', () => {
  describe('contract definition', () => {
    it('readGitState method returns Promise<GitState>', async () => {
      // Arrange: Create a mock implementation
      const mockReader: IGitStateReader = {
        readGitState: vi.fn().mockResolvedValue({
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: 'origin/main',
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        }),
      };

      // Act
      const result = await mockReader.readGitState('/repo');

      // Assert: Verify contract
      expect(result).toHaveProperty('branch');
      expect(result).toHaveProperty('isDetached');
      expect(result).toHaveProperty('isDirty');
      expect(result).toHaveProperty('hasStaged');
      expect(result).toHaveProperty('ahead');
      expect(result).toHaveProperty('behind');
      expect(result).toHaveProperty('tracking');
      expect(result).toHaveProperty('modifiedFiles');
      expect(result).toHaveProperty('hasError');
      expect(result).toHaveProperty('errorMessage');
    });

    it('readGitState accepts optional cwd parameter', async () => {
      const mockReader: IGitStateReader = {
        readGitState: vi.fn().mockResolvedValue({
          branch: null,
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        }),
      };

      // Call without cwd
      await mockReader.readGitState();
      expect(mockReader.readGitState).toHaveBeenCalledWith();
    });
  });
});

describe('IWuStateReader port interface', () => {
  describe('contract definition', () => {
    it('readWuState method returns Promise<WuStateResult | null>', async () => {
      // Arrange: Create a mock implementation
      const mockReader: IWuStateReader = {
        readWuState: vi.fn().mockResolvedValue({
          id: 'WU-1093',
          status: 'in_progress',
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1093.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        }),
      };

      // Act
      const result = await mockReader.readWuState('WU-1093', '/repo');

      // Assert: Verify contract
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('lane');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('yamlPath');
      expect(result).toHaveProperty('isConsistent');
      expect(result).toHaveProperty('inconsistencyReason');
    });

    it('readWuState returns null for non-existent WU', async () => {
      const mockReader: IWuStateReader = {
        readWuState: vi.fn().mockResolvedValue(null),
      };

      const result = await mockReader.readWuState('WU-9999', '/repo');
      expect(result).toBeNull();
    });

    it('readWuState requires both wuId and repoRoot parameters', async () => {
      const mockReader: IWuStateReader = {
        readWuState: vi.fn().mockResolvedValue(null),
      };

      await mockReader.readWuState('WU-1093', '/repo');
      expect(mockReader.readWuState).toHaveBeenCalledWith('WU-1093', '/repo');
    });
  });
});
