// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateClaimSessionOwnership } from '../wu-done-ownership.js';

describe('WU-2341: wu:prep checkpoint authorizes session handoff', () => {
  it('accepts session mismatch when valid prep checkpoint exists', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2341',
      claimedSessionId: 'session-worktree',
      activeSessionId: 'session-main',
      force: false,
      hasValidPrepCheckpoint: true,
    });
    expect(result.valid).toBe(true);
    expect(result.auditRequired).toBe(false);
    expect(result.error).toBeNull();
  });

  it('still blocks session mismatch when no prep checkpoint exists', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2341',
      claimedSessionId: 'session-worktree',
      activeSessionId: 'session-main',
      force: false,
      hasValidPrepCheckpoint: false,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('claimed by a different session');
  });

  it('still blocks when hasValidPrepCheckpoint is undefined (backward compat)', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2341',
      claimedSessionId: 'session-worktree',
      activeSessionId: 'session-main',
      force: false,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('claimed by a different session');
  });

  it('prep checkpoint does not override when sessions already match', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2341',
      claimedSessionId: 'session-same',
      activeSessionId: 'session-same',
      force: false,
      hasValidPrepCheckpoint: true,
    });
    expect(result.valid).toBe(true);
    expect(result.auditRequired).toBe(false);
  });

  it('--force still works alongside prep checkpoint', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2341',
      claimedSessionId: 'session-worktree',
      activeSessionId: 'session-main',
      force: true,
      hasValidPrepCheckpoint: false,
    });
    expect(result.valid).toBe(true);
    expect(result.auditRequired).toBe(true);
  });

  it('wires ownership handoff through HEAD-aware checkpoint validation', async () => {
    const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');

    expect(source).toContain('resolveCheckpointSkipResult');
    expect(source).toContain(
      'const prepCheckpointResult = await resolveCheckpointSkipResult(id, derivedWorktree || null);',
    );
    expect(source).toContain(
      'const earlySkipResult = await resolveCheckpointSkipResult(id, derivedWorktree || null);',
    );
    expect(source).not.toContain('currentHeadSha: undefined');
  });
});
