// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for date-utils module
 *
 * WU-1104: Port tests from ExampleApp to Vitest
 *
 * Tests date formatting utilities using date-fns library.
 * @see {@link ../date-utils.ts}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  todayISO,
  formatDate,
  normalizeToDateString,
  normalizeISODateTime,
} from '../date-utils.js';

describe('date-utils', () => {
  describe('todayISO', () => {
    beforeEach(() => {
      // Mock Date to ensure consistent test results
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return current date in YYYY-MM-DD format', () => {
      // Set a specific date: January 15, 2026
      vi.setSystemTime(new Date('2026-01-15T12:30:45.000Z'));

      const result = todayISO();

      expect(result).toBe('2026-01-15');
    });

    it('should handle date near midnight correctly', () => {
      // Near midnight UTC
      vi.setSystemTime(new Date('2026-06-30T23:59:59.999Z'));

      const result = todayISO();

      expect(result).toBe('2026-06-30');
    });

    it('should return a string matching YYYY-MM-DD pattern', () => {
      vi.setSystemTime(new Date('2025-12-25T00:00:00.000Z'));

      const result = todayISO();

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('formatDate', () => {
    it('should format Date object with custom format string', () => {
      const date = new Date('2025-11-12T14:30:00.000Z');

      const result = formatDate(date, 'yyyy-MM-dd HH:mm:ss');

      expect(result).toBe('2025-11-12 14:30:00');
    });

    it('should format ISO string date', () => {
      const result = formatDate('2025-11-12', 'MMMM d, yyyy');

      expect(result).toBe('November 12, 2025');
    });

    it('should format timestamp number', () => {
      // 2025-03-15T00:00:00.000Z
      const timestamp = new Date('2025-03-15T00:00:00.000Z').getTime();

      const result = formatDate(timestamp, 'yyyy-MM-dd');

      expect(result).toBe('2025-03-15');
    });

    it('should handle various format strings', () => {
      const date = new Date('2025-07-04T10:30:00.000Z');

      expect(formatDate(date, 'dd/MM/yyyy')).toBe('04/07/2025');
      expect(formatDate(date, 'MM-dd-yy')).toBe('07-04-25');
      expect(formatDate(date, 'EEEE')).toMatch(/Friday|Thursday/); // depends on timezone
    });
  });

  describe('normalizeToDateString', () => {
    it('should return undefined for null', () => {
      const result = normalizeToDateString(null);

      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      const result = normalizeToDateString(undefined);

      expect(result).toBeUndefined();
    });

    it('should preserve YYYY-MM-DD string as-is', () => {
      const result = normalizeToDateString('2025-12-04');

      expect(result).toBe('2025-12-04');
    });

    it('should convert Date object to YYYY-MM-DD string', () => {
      const date = new Date('2025-12-04T00:00:00.000Z');

      const result = normalizeToDateString(date);

      expect(result).toBe('2025-12-04');
    });

    it('should convert ISO timestamp string to YYYY-MM-DD', () => {
      const result = normalizeToDateString('2025-12-04T14:30:00.000Z');

      expect(result).toBe('2025-12-04');
    });

    it('should convert ISO timestamp with microseconds to YYYY-MM-DD', () => {
      const result = normalizeToDateString('2025-12-04T00:00:00.123456Z');

      expect(result).toBe('2025-12-04');
    });

    it('should handle parseable date strings', () => {
      const result = normalizeToDateString('December 4, 2025');

      expect(result).toBe('2025-12-04');
    });

    it('should return undefined for invalid date strings', () => {
      const result = normalizeToDateString('not-a-date');

      expect(result).toBeUndefined();
    });
  });

  describe('normalizeISODateTime', () => {
    it('should return undefined for null', () => {
      const result = normalizeISODateTime(null);

      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      const result = normalizeISODateTime(undefined);

      expect(result).toBeUndefined();
    });

    it('should preserve valid ISO datetime format', () => {
      const isoDateTime = '2025-11-29T14:30:00.000Z';

      const result = normalizeISODateTime(isoDateTime);

      expect(result).toBe(isoDateTime);
    });

    it('should convert YYYY-MM-DD to ISO datetime (midnight UTC)', () => {
      const result = normalizeISODateTime('2025-11-29');

      expect(result).toBe('2025-11-29T00:00:00.000Z');
    });

    it('should convert Unix timestamp (milliseconds) to ISO datetime', () => {
      const timestamp = 1732896000000; // Some timestamp

      const result = normalizeISODateTime(timestamp);

      // Verify it's a valid ISO datetime format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should convert numeric string timestamp to ISO datetime', () => {
      const timestampString = '1732896000000';

      const result = normalizeISODateTime(timestampString);

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return undefined for unparseable date', () => {
      const result = normalizeISODateTime('invalid-date-string');

      expect(result).toBeUndefined();
    });

    it('should handle Date objects passed as dates', () => {
      // When a Date object is passed (though typed as string|number|undefined)
      // The function should still work via new Date() constructor
      const date = new Date('2025-12-15T10:30:00.000Z');

      // Type cast to simulate js-yaml behavior
      const result = normalizeISODateTime(date as unknown as string);

      expect(result).toBe('2025-12-15T10:30:00.000Z');
    });
  });
});
