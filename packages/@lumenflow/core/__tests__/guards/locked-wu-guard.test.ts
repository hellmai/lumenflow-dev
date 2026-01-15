/**
 * Locked WU Guard Tests (WU-2539)
 *
 * Tests for preventing edits to locked WUs.
 * WUs in terminal states (done, cancelled) cannot be modified.
 */

import { describe, it, expect } from 'vitest';
import {
  isWULocked,
  checkWUEditAllowed,
  WUStatus,
  type WUState,
} from '../../src/guards/locked-wu-guard.js';

describe('Locked WU Guard', () => {
  describe('isWULocked', () => {
    it('returns true for done status', () => {
      expect(isWULocked(WUStatus.DONE)).toBe(true);
    });

    it('returns true for cancelled status', () => {
      expect(isWULocked(WUStatus.CANCELLED)).toBe(true);
    });

    it('returns true when locked flag is true', () => {
      expect(isWULocked(WUStatus.IN_PROGRESS, true)).toBe(true);
    });

    it('returns false for ready status', () => {
      expect(isWULocked(WUStatus.READY)).toBe(false);
    });

    it('returns false for in_progress status', () => {
      expect(isWULocked(WUStatus.IN_PROGRESS)).toBe(false);
    });

    it('returns false for blocked status', () => {
      expect(isWULocked(WUStatus.BLOCKED)).toBe(false);
    });
  });

  describe('checkWUEditAllowed', () => {
    const makeWU = (status: WUStatus, locked = false): WUState => ({
      id: 'WU-123',
      status,
      locked,
      lane: 'Operations: Tooling',
      title: 'Test WU',
    });

    it('allows editing ready WUs', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.READY));
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('allows editing in_progress WUs', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.IN_PROGRESS));
      expect(result.allowed).toBe(true);
    });

    it('allows editing blocked WUs', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.BLOCKED));
      expect(result.allowed).toBe(true);
    });

    it('blocks editing done WUs', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.DONE));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('locked');
      expect(result.reason).toContain('done');
    });

    it('blocks editing cancelled WUs', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.CANCELLED));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cancelled');
    });

    it('blocks editing WUs with locked flag', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.IN_PROGRESS, true));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('locked');
    });

    it('includes WU ID in error message', () => {
      const result = checkWUEditAllowed(makeWU(WUStatus.DONE));
      expect(result.reason).toContain('WU-123');
    });
  });
});
