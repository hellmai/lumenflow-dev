/**
 * Memory Checkpoint CLI Tests (WU-1909)
 *
 * Tests for the state-store propagation guard in the CLI wrapper.
 * Verifies that wu-events.jsonl writes only occur in worktree context.
 *
 * @see {@link packages/@lumenflow/cli/src/mem-checkpoint.ts} - Implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock checkpoint calls
const mockCheckpointFn = vi.fn().mockResolvedValue(undefined);

// Mock resolveLocation from @lumenflow/core
vi.mock('@lumenflow/core/context/location-resolver', () => ({
  resolveLocation: vi.fn(),
}));

// Mock WUStateStore from @lumenflow/core using function constructor
vi.mock('@lumenflow/core/wu-state-store', () => ({
  WUStateStore: vi.fn().mockImplementation(function (this: {
    checkpoint: typeof mockCheckpointFn;
  }) {
    this.checkpoint = mockCheckpointFn;
  }),
  WU_EVENTS_FILE_NAME: 'wu-events.jsonl',
}));

import { propagateCheckpointToStateStore } from '../mem-checkpoint.js';
import { resolveLocation } from '@lumenflow/core/context/location-resolver';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import { CONTEXT_VALIDATION } from '@lumenflow/core/wu-constants';

const mockResolveLocation = vi.mocked(resolveLocation);

describe('mem-checkpoint CLI state-store guard (WU-1909)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckpointFn.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should propagate checkpoint to state store when in worktree', async () => {
    mockResolveLocation.mockResolvedValue({
      type: CONTEXT_VALIDATION.LOCATION_TYPES.WORKTREE,
      cwd: '/repo/worktrees/framework-memory-wu-1909',
      gitRoot: '/repo/worktrees/framework-memory-wu-1909',
      mainCheckout: '/repo',
      worktreeName: 'framework-memory-wu-1909',
      worktreeWuId: 'WU-1909',
    });

    const result = await propagateCheckpointToStateStore(
      '/repo/worktrees/framework-memory-wu-1909',
      {
        wuId: 'WU-1909',
        note: 'Test checkpoint',
      },
    );

    expect(result.propagated).toBe(true);
    expect(WUStateStore).toHaveBeenCalledWith(expect.stringContaining('.lumenflow/state'));
    expect(mockCheckpointFn).toHaveBeenCalledWith(
      'WU-1909',
      'Test checkpoint',
      expect.objectContaining({}),
    );
  });

  it('should NOT propagate checkpoint to state store when on main checkout', async () => {
    mockResolveLocation.mockResolvedValue({
      type: CONTEXT_VALIDATION.LOCATION_TYPES.MAIN,
      cwd: '/repo',
      gitRoot: '/repo',
      mainCheckout: '/repo',
      worktreeName: null,
      worktreeWuId: null,
    });

    const result = await propagateCheckpointToStateStore('/repo', {
      wuId: 'WU-1909',
      note: 'Test checkpoint',
    });

    expect(result.propagated).toBe(false);
    expect(result.reason).toBe('not_in_worktree');
    expect(WUStateStore).not.toHaveBeenCalled();
  });

  it('should NOT propagate checkpoint when no wuId provided', async () => {
    const result = await propagateCheckpointToStateStore('/repo', {
      note: 'Test checkpoint',
    });

    expect(result.propagated).toBe(false);
    expect(result.reason).toBe('no_wu_id');
    expect(mockResolveLocation).not.toHaveBeenCalled();
  });

  it('should NOT propagate when location is unknown', async () => {
    mockResolveLocation.mockResolvedValue({
      type: CONTEXT_VALIDATION.LOCATION_TYPES.UNKNOWN,
      cwd: '/somewhere',
      gitRoot: '/somewhere',
      mainCheckout: '/somewhere',
      worktreeName: null,
      worktreeWuId: null,
    });

    const result = await propagateCheckpointToStateStore('/somewhere', {
      wuId: 'WU-1909',
      note: 'Test checkpoint',
    });

    expect(result.propagated).toBe(false);
    expect(result.reason).toBe('not_in_worktree');
  });

  it('should use CONTEXT_VALIDATION.LOCATION_TYPES constant, not magic strings', async () => {
    // Verify the function matches against the constant value 'worktree'
    mockResolveLocation.mockResolvedValue({
      type: 'worktree' as typeof CONTEXT_VALIDATION.LOCATION_TYPES.WORKTREE,
      cwd: '/repo/worktrees/test',
      gitRoot: '/repo/worktrees/test',
      mainCheckout: '/repo',
      worktreeName: 'test',
      worktreeWuId: 'WU-1909',
    });

    const result = await propagateCheckpointToStateStore('/repo/worktrees/test', {
      wuId: 'WU-1909',
      note: 'Test',
    });

    expect(result.propagated).toBe(true);
  });

  it('should warn but not throw when state store write fails', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockResolveLocation.mockResolvedValue({
      type: CONTEXT_VALIDATION.LOCATION_TYPES.WORKTREE,
      cwd: '/repo/worktrees/test',
      gitRoot: '/repo/worktrees/test',
      mainCheckout: '/repo',
      worktreeName: 'test',
      worktreeWuId: 'WU-1909',
    });

    // Make checkpoint throw
    mockCheckpointFn.mockRejectedValueOnce(new Error('Write failed'));

    const result = await propagateCheckpointToStateStore('/repo/worktrees/test', {
      wuId: 'WU-1909',
      note: 'Test',
    });

    expect(result.propagated).toBe(false);
    expect(result.reason).toBe('write_failed');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[mem:checkpoint] Warning: State store write failed: Write failed'),
    );

    consoleWarnSpy.mockRestore();
  });

  it('should warn but not throw when resolveLocation fails', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockResolveLocation.mockRejectedValue(new Error('Git not found'));

    const result = await propagateCheckpointToStateStore('/somewhere', {
      wuId: 'WU-1909',
      note: 'Test',
    });

    expect(result.propagated).toBe(false);
    expect(result.reason).toBe('location_resolve_failed');

    consoleWarnSpy.mockRestore();
  });
});
