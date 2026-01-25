/**
 * Context Adapters Tests
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Tests for concrete adapter implementations:
 * - SimpleGitLocationAdapter
 * - SimpleGitStateAdapter
 * - FileSystemWuStateAdapter
 *
 * TDD: These tests are written BEFORE implementation.
 *
 * @module __tests__/adapters/context-adapters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import adapters (will be created after tests fail)
import {
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
} from '../../adapters/context-adapters.js';

// Import port interfaces for type checking
import type {
  ILocationResolver,
  IGitStateReader,
  IWuStateReader,
} from '../../ports/context.ports.js';

describe('SimpleGitLocationAdapter', () => {
  describe('implements ILocationResolver interface', () => {
    it('should have resolveLocation method', () => {
      const adapter = new SimpleGitLocationAdapter();

      // Type check: adapter should implement ILocationResolver
      const locationResolver: ILocationResolver = adapter;
      expect(typeof locationResolver.resolveLocation).toBe('function');
    });
  });

  describe('resolveLocation()', () => {
    it('should delegate to underlying resolveLocation function', async () => {
      const adapter = new SimpleGitLocationAdapter();

      // resolveLocation should return LocationContext
      const result = await adapter.resolveLocation();

      // Basic structure validation
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('cwd');
      expect(result).toHaveProperty('gitRoot');
      expect(result).toHaveProperty('mainCheckout');
      expect(result).toHaveProperty('worktreeName');
      expect(result).toHaveProperty('worktreeWuId');
    });

    it('should pass cwd parameter to underlying function', async () => {
      const adapter = new SimpleGitLocationAdapter();
      const testCwd = '/some/test/path';

      // Should not throw when cwd is passed
      const result = await adapter.resolveLocation(testCwd);

      // Result should still have valid structure
      expect(result).toHaveProperty('type');
    });
  });
});

describe('SimpleGitStateAdapter', () => {
  describe('implements IGitStateReader interface', () => {
    it('should have readGitState method', () => {
      const adapter = new SimpleGitStateAdapter();

      // Type check: adapter should implement IGitStateReader
      const gitStateReader: IGitStateReader = adapter;
      expect(typeof gitStateReader.readGitState).toBe('function');
    });
  });

  describe('readGitState()', () => {
    it('should delegate to underlying readGitState function', async () => {
      const adapter = new SimpleGitStateAdapter();

      // readGitState should return GitState
      const result = await adapter.readGitState();

      // Basic structure validation
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

    it('should pass cwd parameter to underlying function', async () => {
      const adapter = new SimpleGitStateAdapter();
      const testCwd = '/some/test/path';

      // Should not throw when cwd is passed
      const result = await adapter.readGitState(testCwd);

      // Result should still have valid structure
      expect(result).toHaveProperty('branch');
    });
  });
});

describe('FileSystemWuStateAdapter', () => {
  describe('implements IWuStateReader interface', () => {
    it('should have readWuState method', () => {
      const adapter = new FileSystemWuStateAdapter();

      // Type check: adapter should implement IWuStateReader
      const wuStateReader: IWuStateReader = adapter;
      expect(typeof wuStateReader.readWuState).toBe('function');
    });
  });

  describe('readWuState()', () => {
    it('should delegate to underlying readWuState function', async () => {
      const adapter = new FileSystemWuStateAdapter();

      // Should return null for non-existent WU
      const result = await adapter.readWuState('WU-NONEXISTENT', '/tmp');

      expect(result).toBeNull();
    });

    it('should pass wuId and repoRoot to underlying function', async () => {
      const adapter = new FileSystemWuStateAdapter();
      const wuId = 'WU-1094';
      const repoRoot = process.cwd();

      // Should not throw
      const result = await adapter.readWuState(wuId, repoRoot);

      // Result is either WuStateResult or null
      if (result !== null) {
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('lane');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('yamlPath');
        expect(result).toHaveProperty('isConsistent');
        expect(result).toHaveProperty('inconsistencyReason');
      }
    });
  });
});

describe('Adapter Type Safety', () => {
  it('SimpleGitLocationAdapter should be assignable to ILocationResolver', () => {
    // This is a compile-time check - if types don't match, TS will error
    const adapter: ILocationResolver = new SimpleGitLocationAdapter();
    expect(adapter).toBeDefined();
  });

  it('SimpleGitStateAdapter should be assignable to IGitStateReader', () => {
    const adapter: IGitStateReader = new SimpleGitStateAdapter();
    expect(adapter).toBeDefined();
  });

  it('FileSystemWuStateAdapter should be assignable to IWuStateReader', () => {
    const adapter: IWuStateReader = new FileSystemWuStateAdapter();
    expect(adapter).toBeDefined();
  });
});
