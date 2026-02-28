// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateClaimSessionOwnership } from '../wu-done-ownership.js';

describe('WU-2275: claimant session ownership enforcement', () => {
  it('passes when active session matches WU claim session', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2275',
      claimedSessionId: 'session-abc',
      activeSessionId: 'session-abc',
      force: false,
    });
    expect(result.valid).toBe(true);
    expect(result.auditRequired).toBe(false);
  });

  it('blocks when active session differs and --force is not set', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2275',
      claimedSessionId: 'session-owner',
      activeSessionId: 'session-other',
      force: false,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('claimed by a different session');
  });

  it('allows mismatch with --force and marks audit required', () => {
    const result = validateClaimSessionOwnership({
      wuId: 'WU-2275',
      claimedSessionId: 'session-owner',
      activeSessionId: 'session-other',
      force: true,
    });
    expect(result.valid).toBe(true);
    expect(result.auditRequired).toBe(true);
  });

  it('is enforced in wu:done main flow', () => {
    const source = readFileSync(new URL('../wu-done.ts', import.meta.url), 'utf-8');
    expect(source).toContain('validateClaimSessionOwnership');
    expect(source).toContain('appendClaimSessionOverrideAuditEvent');
  });
});
