// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_RECOVERY_ATTEMPTS,
  clearRecoveryAttempts,
  detectZombieState,
  getRecoveryAttemptCount,
  getRecoveryMarkerPath,
  incrementRecoveryAttempt,
  shouldEscalateToManualIntervention,
} from '../wu-recovery.js';

describe('wu-recovery helpers', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('builds recovery marker path under .lumenflow/recovery', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'wu-recovery-'));
    tempDirs.push(baseDir);

    const markerPath = getRecoveryMarkerPath('WU-1696', baseDir);
    expect(markerPath).toBe(path.join(baseDir, '.lumenflow', 'recovery', 'WU-1696.recovery'));
  });

  it('increments, reads, and clears recovery attempts', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'wu-recovery-'));
    tempDirs.push(baseDir);

    expect(getRecoveryAttemptCount('WU-1696', baseDir)).toBe(0);
    expect(incrementRecoveryAttempt('WU-1696', baseDir)).toBe(1);
    expect(incrementRecoveryAttempt('WU-1696', baseDir)).toBe(2);
    expect(getRecoveryAttemptCount('WU-1696', baseDir)).toBe(2);

    clearRecoveryAttempts('WU-1696', baseDir);
    expect(getRecoveryAttemptCount('WU-1696', baseDir)).toBe(0);
  });

  it('escalates only at or beyond max recovery attempts', () => {
    expect(shouldEscalateToManualIntervention(MAX_RECOVERY_ATTEMPTS - 1)).toBe(false);
    expect(shouldEscalateToManualIntervention(MAX_RECOVERY_ATTEMPTS)).toBe(true);
  });

  it('detects zombie state when done status has an existing worktree path', () => {
    const worktreePath = mkdtempSync(path.join(tmpdir(), 'wu-worktree-'));
    tempDirs.push(worktreePath);

    expect(detectZombieState({ status: 'done' }, worktreePath)).toBe(true);
    expect(detectZombieState({ status: 'in_progress' }, worktreePath)).toBe(false);

    const missingPath = path.join(worktreePath, 'missing');
    expect(existsSync(missingPath)).toBe(false);
    expect(detectZombieState({ status: 'done' }, missingPath)).toBe(false);
  });

  it('returns false for done status when worktree path is missing', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'wu-recovery-'));
    tempDirs.push(baseDir);
    const missingPath = path.join(baseDir, 'not-there');

    expect(detectZombieState({ status: 'done' }, missingPath)).toBe(false);
    expect(detectZombieState({ status: 'done' }, null)).toBe(false);
  });

  it('creates marker directory when incrementing attempts', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'wu-recovery-'));
    tempDirs.push(baseDir);

    incrementRecoveryAttempt('WU-1696', baseDir);

    const markerDir = path.join(baseDir, '.lumenflow', 'recovery');
    expect(existsSync(markerDir)).toBe(true);
  });

  it('treats corrupted marker content as zero attempts', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'wu-recovery-'));
    tempDirs.push(baseDir);

    const markerDir = path.join(baseDir, '.lumenflow', 'recovery');
    mkdirSync(markerDir, { recursive: true });
    const markerPath = path.join(markerDir, 'WU-1696.recovery');
    // Intentionally write invalid JSON
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, '{not-json');

    expect(getRecoveryAttemptCount('WU-1696', baseDir)).toBe(0);
  });
});
