/**
 * WU-1929: Beautiful CLI Output - Formatters Tests
 *
 * Tests for the branded header, colored status indicators,
 * structured table creation, and progress spinner utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module under test (does not exist yet -- RED phase)
import {
  printHeader,
  formatHeader,
  statusColor,
  createStatusTable,
  createSpinner,
  STATUS_COLORS,
} from '../src/formatters.js';

describe('WU-1929: Beautiful CLI Output', () => {
  // ── AC1: Branded header with version ──────────────────────────────

  describe('formatHeader', () => {
    it('should include LumenFlow brand name', () => {
      const output = formatHeader({ version: '3.0.0' });
      expect(output).toContain('LumenFlow');
    });

    it('should include the version string', () => {
      const output = formatHeader({ version: '3.0.0' });
      expect(output).toContain('3.0.0');
    });

    it('should include a visual separator line', () => {
      const output = formatHeader({ version: '3.0.0' });
      // Should have some kind of horizontal rule or box drawing
      expect(output).toMatch(/[-─═━]{10,}/);
    });

    it('should be a non-empty multi-line string', () => {
      const output = formatHeader({ version: '3.0.0' });
      const lines = output.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle missing version gracefully', () => {
      const output = formatHeader({});
      expect(output).toContain('LumenFlow');
      // Should not crash and should not show "undefined"
      expect(output).not.toContain('undefined');
    });
  });

  describe('printHeader', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should print the header to console.log', () => {
      printHeader({ version: '3.0.0' });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('LumenFlow');
    });
  });

  // ── AC2: Colored status indicators ────────────────────────────────

  describe('statusColor', () => {
    it('should return a string for "ready" status', () => {
      const result = statusColor('ready');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a string for "in_progress" status', () => {
      const result = statusColor('in_progress');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a string for "done" status', () => {
      const result = statusColor('done');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a string for "blocked" status', () => {
      const result = statusColor('blocked');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle unknown status gracefully', () => {
      const result = statusColor('unknown_status');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include the status text in the output', () => {
      // Strip ANSI codes to check the text content
      const result = statusColor('ready').replace(
        // eslint-disable-next-line no-control-regex
        /\x1B\[[0-9;]*m/g,
        '',
      );
      expect(result).toContain('ready');
    });
  });

  describe('STATUS_COLORS', () => {
    it('should define colors for standard WU statuses', () => {
      expect(STATUS_COLORS).toBeDefined();
      expect(STATUS_COLORS.ready).toBeDefined();
      expect(STATUS_COLORS.in_progress).toBeDefined();
      expect(STATUS_COLORS.done).toBeDefined();
      expect(STATUS_COLORS.blocked).toBeDefined();
    });
  });

  // ── AC3: Structured tables ────────────────────────────────────────

  describe('createStatusTable', () => {
    it('should create a table with header and rows', () => {
      const table = createStatusTable({
        head: ['ID', 'Title', 'Status'],
        rows: [
          ['WU-100', 'Test WU', 'ready'],
          ['WU-101', 'Another WU', 'done'],
        ],
      });
      expect(typeof table).toBe('string');
      // cli-table3 uses box-drawing characters
      expect(table).toContain('WU-100');
      expect(table).toContain('Test WU');
    });

    it('should handle empty rows', () => {
      const table = createStatusTable({
        head: ['ID', 'Title'],
        rows: [],
      });
      expect(typeof table).toBe('string');
      // Should at least have the header
      expect(table).toContain('ID');
    });

    it('should handle custom column widths', () => {
      const table = createStatusTable({
        head: ['ID', 'Title'],
        rows: [['WU-100', 'Test']],
        colWidths: [15, 40],
      });
      expect(typeof table).toBe('string');
      expect(table).toContain('WU-100');
    });
  });

  // ── AC4: Progress spinners ────────────────────────────────────────

  describe('createSpinner', () => {
    let intervalSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Mock setInterval/clearInterval so spinners don't actually run
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return an object with start and stop methods', () => {
      const spinner = createSpinner('Loading...');
      expect(typeof spinner.start).toBe('function');
      expect(typeof spinner.stop).toBe('function');
    });

    it('should accept a message parameter', () => {
      const spinner = createSpinner('Processing gates...');
      expect(spinner).toBeDefined();
    });

    it('should have a succeed method for completion', () => {
      const spinner = createSpinner('Working...');
      expect(typeof spinner.succeed).toBe('function');
    });

    it('should have a fail method for failure', () => {
      const spinner = createSpinner('Working...');
      expect(typeof spinner.fail).toBe('function');
    });

    it('should not throw when start and stop are called', () => {
      const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const spinner = createSpinner('Test');
      expect(() => {
        spinner.start();
        vi.advanceTimersByTime(200);
        spinner.stop();
      }).not.toThrow();
      writeSpy.mockRestore();
    });

    it('should not throw when succeed is called after start', () => {
      const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const spinner = createSpinner('Test');
      expect(() => {
        spinner.start();
        vi.advanceTimersByTime(200);
        spinner.succeed('Done!');
      }).not.toThrow();
      writeSpy.mockRestore();
    });
  });
});
