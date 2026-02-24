// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file error-contracts.test.ts
 * @description Tests for standardized error contracts
 *
 * WU-2128: Standardize error return contracts
 *
 * Contract:
 * - Ports THROW on failure (boundary contracts)
 * - Adapters RETURN Result<T,E> via toResult() wrappers
 * - CLI command handlers CATCH and format errors
 *
 * TDD: RED phase - Tests written FIRST.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LocationContext } from '../../context/location-resolver.js';
import type { GitState } from '../../context/git-state-reader.js';
import type { WuStateResult } from '../../context/wu-state-reader.js';

import {
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
} from '../../adapters/context-adapters.js';

describe('Adapter error contracts (WU-2128)', () => {
  describe('SimpleGitLocationAdapter', () => {
    it('returns LocationContext on success (existing contract preserved)', async () => {
      const mockLocation: LocationContext = {
        type: 'main',
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      };

      const adapter = new SimpleGitLocationAdapter(vi.fn().mockResolvedValue(mockLocation));
      const result = await adapter.resolveLocation('/repo');

      expect(result).toEqual(mockLocation);
    });

    it('throws on failure (port contract: ports throw)', async () => {
      const adapter = new SimpleGitLocationAdapter(
        vi.fn().mockRejectedValue(new Error('git not found')),
      );

      await expect(adapter.resolveLocation()).rejects.toThrow('git not found');
    });

    it('resolveLocationSafe returns Result<LocationContext> on success', async () => {
      const mockLocation: LocationContext = {
        type: 'main',
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      };

      const adapter = new SimpleGitLocationAdapter(vi.fn().mockResolvedValue(mockLocation));
      const result = await adapter.resolveLocationSafe('/repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockLocation);
      }
    });

    it('resolveLocationSafe returns Result<LocationContext> on failure', async () => {
      const adapter = new SimpleGitLocationAdapter(
        vi.fn().mockRejectedValue(new Error('git not found')),
      );

      const result = await adapter.resolveLocationSafe();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('git not found');
      }
    });
  });

  describe('SimpleGitStateAdapter', () => {
    it('returns GitState on success (existing contract preserved)', async () => {
      const mockGitState: GitState = {
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
      };

      const adapter = new SimpleGitStateAdapter(vi.fn().mockResolvedValue(mockGitState));
      const result = await adapter.readGitState('/repo');

      expect(result).toEqual(mockGitState);
    });

    it('readGitStateSafe returns Result<GitState> on success', async () => {
      const mockGitState: GitState = {
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
      };

      const adapter = new SimpleGitStateAdapter(vi.fn().mockResolvedValue(mockGitState));
      const result = await adapter.readGitStateSafe('/repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockGitState);
      }
    });

    it('readGitStateSafe returns Failure on error', async () => {
      const adapter = new SimpleGitStateAdapter(vi.fn().mockRejectedValue(new Error('git error')));

      const result = await adapter.readGitStateSafe();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('git error');
      }
    });
  });

  describe('FileSystemWuStateAdapter', () => {
    it('returns WuStateResult on success (existing contract preserved)', async () => {
      const mockState: WuStateResult = {
        id: 'WU-2128',
        status: 'in_progress',
        lane: 'Framework: Core Lifecycle',
        title: 'Test WU',
        yamlPath: '/repo/docs/04-operations/tasks/wu/WU-2128.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      };

      const adapter = new FileSystemWuStateAdapter(vi.fn().mockResolvedValue(mockState));
      const result = await adapter.readWuState('WU-2128', '/repo');

      expect(result).toEqual(mockState);
    });

    it('returns null for non-existent WU (existing contract preserved)', async () => {
      const adapter = new FileSystemWuStateAdapter(vi.fn().mockResolvedValue(null));
      const result = await adapter.readWuState('WU-9999', '/repo');

      expect(result).toBeNull();
    });

    it('readWuStateSafe returns Result on success', async () => {
      const mockState: WuStateResult = {
        id: 'WU-2128',
        status: 'in_progress',
        lane: 'Framework: Core Lifecycle',
        title: 'Test WU',
        yamlPath: '/repo/docs/04-operations/tasks/wu/WU-2128.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      };

      const adapter = new FileSystemWuStateAdapter(vi.fn().mockResolvedValue(mockState));
      const result = await adapter.readWuStateSafe('WU-2128', '/repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockState);
      }
    });

    it('readWuStateSafe returns Result with null value for non-existent WU', async () => {
      const adapter = new FileSystemWuStateAdapter(vi.fn().mockResolvedValue(null));
      const result = await adapter.readWuStateSafe('WU-9999', '/repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('readWuStateSafe returns Failure on error', async () => {
      const adapter = new FileSystemWuStateAdapter(
        vi.fn().mockRejectedValue(new Error('YAML parse error')),
      );

      const result = await adapter.readWuStateSafe('WU-2128', '/repo');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('YAML parse error');
      }
    });
  });
});
