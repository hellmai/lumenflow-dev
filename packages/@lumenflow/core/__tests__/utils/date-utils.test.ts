/**
 * DateUtils tests (WU-2537)
 */

import { describe, it, expect } from 'vitest';
import { DateUtils } from '../../src/utils/date-utils.js';

describe('DateUtils', () => {
  describe('formatISO', () => {
    it('formats date to ISO string', () => {
      const date = new Date('2026-01-15T12:00:00.000Z');
      expect(DateUtils.formatISO(date)).toBe('2026-01-15T12:00:00.000Z');
    });
  });

  describe('parseISO', () => {
    it('parses ISO string to Date', () => {
      const date = DateUtils.parseISO('2026-01-15T12:00:00.000Z');
      expect(date.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    });
  });

  describe('formatRelative', () => {
    it('formats as "less than 1 hour ago" for recent dates', () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      const recent = new Date('2026-01-15T11:30:00.000Z');
      expect(DateUtils.formatRelative(recent, now)).toBe('less than 1 hour ago');
    });

    it('formats as "1 hour ago" for exactly 1 hour', () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      const oneHourAgo = new Date('2026-01-15T11:00:00.000Z');
      expect(DateUtils.formatRelative(oneHourAgo, now)).toBe('1 hour ago');
    });

    it('formats as "N hours ago" for multiple hours', () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      const threeHoursAgo = new Date('2026-01-15T09:00:00.000Z');
      expect(DateUtils.formatRelative(threeHoursAgo, now)).toBe('3 hours ago');
    });
  });

  describe('isOlderThan', () => {
    it('returns true when date is older than duration', () => {
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      expect(DateUtils.isOlderThan(oldDate, '1h')).toBe(true);
    });

    it('returns false when date is newer than duration', () => {
      const recentDate = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      expect(DateUtils.isOlderThan(recentDate, '1h')).toBe(false);
    });

    it('supports day durations', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(DateUtils.isOlderThan(threeDaysAgo, '2d')).toBe(true);
      expect(DateUtils.isOlderThan(threeDaysAgo, '5d')).toBe(false);
    });

    it('supports minute durations', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      expect(DateUtils.isOlderThan(tenMinutesAgo, '5m')).toBe(true);
      expect(DateUtils.isOlderThan(tenMinutesAgo, '15m')).toBe(false);
    });

    it('supports second durations', () => {
      const tenSecondsAgo = new Date(Date.now() - 10 * 1000);
      expect(DateUtils.isOlderThan(tenSecondsAgo, '5s')).toBe(true);
      expect(DateUtils.isOlderThan(tenSecondsAgo, '15s')).toBe(false);
    });
  });

  describe('addDuration', () => {
    it('adds hours to date', () => {
      const date = new Date('2026-01-15T12:00:00.000Z');
      const result = DateUtils.addDuration(date, '2h');
      expect(result.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    });

    it('adds days to date', () => {
      const date = new Date('2026-01-15T12:00:00.000Z');
      const result = DateUtils.addDuration(date, '3d');
      expect(result.toISOString()).toBe('2026-01-18T12:00:00.000Z');
    });

    it('adds minutes to date', () => {
      const date = new Date('2026-01-15T12:00:00.000Z');
      const result = DateUtils.addDuration(date, '30m');
      expect(result.toISOString()).toBe('2026-01-15T12:30:00.000Z');
    });

    it('adds seconds to date', () => {
      const date = new Date('2026-01-15T12:00:00.000Z');
      const result = DateUtils.addDuration(date, '45s');
      expect(result.toISOString()).toBe('2026-01-15T12:00:45.000Z');
    });

    it('throws on invalid duration format', () => {
      const date = new Date();
      expect(() => DateUtils.addDuration(date, 'invalid')).toThrow('Invalid duration');
      expect(() => DateUtils.addDuration(date, '1x')).toThrow('Invalid duration');
      expect(() => DateUtils.addDuration(date, 'h1')).toThrow('Invalid duration');
    });
  });
});
