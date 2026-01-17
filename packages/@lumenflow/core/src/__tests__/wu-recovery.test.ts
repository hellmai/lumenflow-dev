/**
 * WU-1335: Recovery module tests (TDD)
 * Test recovery attempt tracking and escalation behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  MAX_RECOVERY_ATTEMPTS,
  getRecoveryAttemptCount,
  incrementRecoveryAttempt,
  clearRecoveryAttempts,
  shouldEscalateToManualIntervention,
  getRecoveryMarkerPath,
} from '../wu-recovery.js';

describe('wu-recovery attempt tracking (WU-1335)', () => {
  let testDir;

  beforeEach(() => {
    // Create temp test directory
    testDir = join(tmpdir(), `wu-recovery-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.beacon', 'recovery'), { recursive: true });
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('MAX_RECOVERY_ATTEMPTS constant', () => {
    it('should export MAX_RECOVERY_ATTEMPTS constant', () => {
      expect(typeof MAX_RECOVERY_ATTEMPTS === 'number').toBeTruthy();
    });

    it('should have a reasonable value (WU-1747: now configurable via RETRY_PRESETS)', () => {
      // WU-1747: MAX_RECOVERY_ATTEMPTS is now derived from RETRY_PRESETS.recovery.maxAttempts
      // which allows for configurable retry behaviour
      assert.ok(MAX_RECOVERY_ATTEMPTS >= 2, 'should allow at least 2 attempts');
      assert.ok(MAX_RECOVERY_ATTEMPTS <= 10, 'should not allow excessive attempts');
    });
  });

  describe('getRecoveryMarkerPath', () => {
    it('should return path based on WU ID', () => {
      const path = getRecoveryMarkerPath('WU-1335', testDir);
      expect(path).toContain('WU-1335');
      expect(path).toContain('.recovery');
    });
  });

  describe('getRecoveryAttemptCount', () => {
    it('should return 0 when no marker file exists', () => {
      const count = getRecoveryAttemptCount('WU-1335', testDir);
      expect(count).toBe(0);
    });

    it('should return count from marker file', () => {
      const markerPath = getRecoveryMarkerPath('WU-1335', testDir);
      writeFileSync(
        markerPath,
        JSON.stringify({ attempts: 1, lastAttempt: new Date().toISOString() })
      );
      const count = getRecoveryAttemptCount('WU-1335', testDir);
      expect(count).toBe(1);
    });

    it('should return 0 if marker file is corrupted', () => {
      const markerPath = getRecoveryMarkerPath('WU-1335', testDir);
      writeFileSync(markerPath, 'invalid json');
      const count = getRecoveryAttemptCount('WU-1335', testDir);
      expect(count).toBe(0);
    });
  });

  describe('incrementRecoveryAttempt', () => {
    it('should create marker file with count 1 on first call', () => {
      const newCount = incrementRecoveryAttempt('WU-1335', testDir);
      expect(newCount).toBe(1);

      const markerPath = getRecoveryMarkerPath('WU-1335', testDir);
      expect(existsSync(markerPath)).toBeTruthy();
    });

    it('should increment existing count', () => {
      incrementRecoveryAttempt('WU-1335', testDir); // count = 1
      const newCount = incrementRecoveryAttempt('WU-1335', testDir); // count = 2
      expect(newCount).toBe(2);
    });

    it('should record timestamp', () => {
      incrementRecoveryAttempt('WU-1335', testDir);
      const markerPath = getRecoveryMarkerPath('WU-1335', testDir);
      const data = JSON.parse(readFileSync(markerPath, 'utf8'));
      expect(data.lastAttempt).toBeTruthy();
      expect(new Date(data.lastAttempt).getTime() > 0).toBeTruthy();
    });
  });

  describe('clearRecoveryAttempts', () => {
    it('should remove marker file', () => {
      incrementRecoveryAttempt('WU-1335', testDir);
      const markerPath = getRecoveryMarkerPath('WU-1335', testDir);
      expect(existsSync(markerPath)).toBeTruthy();

      clearRecoveryAttempts('WU-1335', testDir);
      expect(!existsSync(markerPath)).toBeTruthy();
    });

    it('should not throw if marker file does not exist', () => {
      assert.doesNotThrow(() => {
        clearRecoveryAttempts('WU-1335', testDir);
      });
    });
  });

  describe('shouldEscalateToManualIntervention', () => {
    it('should return false when attempts < MAX_RECOVERY_ATTEMPTS', () => {
      expect(shouldEscalateToManualIntervention(0)).toBe(false);
      expect(shouldEscalateToManualIntervention(1)).toBe(false);
      // WU-1747: Test with dynamic MAX_RECOVERY_ATTEMPTS value
      expect(shouldEscalateToManualIntervention(MAX_RECOVERY_ATTEMPTS - 1)).toBe(false);
    });

    it('should return true when attempts >= MAX_RECOVERY_ATTEMPTS', () => {
      // WU-1747: Use constant instead of hardcoded values
      expect(shouldEscalateToManualIntervention(MAX_RECOVERY_ATTEMPTS)).toBe(true);
      expect(shouldEscalateToManualIntervention(MAX_RECOVERY_ATTEMPTS + 1)).toBe(true);
    });
  });
});
