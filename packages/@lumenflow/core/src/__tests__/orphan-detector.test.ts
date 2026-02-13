/**
 * @file orphan-detector.test.ts
 * Tests for missing tracked worktree detection (WU-1056)
 */

import { describe, it, expect } from 'vitest';

import { getMissingWorktreesFromTracked } from '../orphan-detector.js';
import { WORKTREE_WARNINGS } from '../wu-constants.js';

// WU-1654: Verify orphan-detector exports are available from @lumenflow/core public API
import {
  detectOrphanWorktrees,
  detectMissingTrackedWorktrees,
} from '../index.js';

describe('orphan-detector missing tracked worktrees (WU-1056)', () => {
  it('returns tracked paths that are missing on disk', () => {
    const tracked = ['/tmp/wt-1', '/tmp/wt-2', '/tmp/wt-3'];
    const existsFn = (path: string) => path !== '/tmp/wt-2';

    const missing = getMissingWorktreesFromTracked(tracked, existsFn);

    expect(missing).toEqual(['/tmp/wt-2']);
  });

  it('exposes warning messages via constants', () => {
    expect(WORKTREE_WARNINGS.MISSING_TRACKED_HEADER.length).toBeGreaterThan(0);
    expect(WORKTREE_WARNINGS.MISSING_TRACKED_LINE('/tmp/wt-1')).toContain('/tmp/wt-1');
  });

  it('returns empty array when all tracked paths exist', () => {
    const tracked = ['/tmp/wt-1', '/tmp/wt-2'];
    const existsFn = () => true;

    const missing = getMissingWorktreesFromTracked(tracked, existsFn);

    expect(missing).toEqual([]);
  });
});

/**
 * WU-1654: Verify orphan-detector functions are exported from @lumenflow/core public API
 * These tests ensure the named exports exist (not wildcard) and are callable.
 */
describe('WU-1654: orphan-detector exports from @lumenflow/core', () => {
  it('exports detectOrphanWorktrees as a function', () => {
    expect(typeof detectOrphanWorktrees).toBe('function');
  });

  it('exports detectMissingTrackedWorktrees as a function', () => {
    expect(typeof detectMissingTrackedWorktrees).toBe('function');
  });
});
