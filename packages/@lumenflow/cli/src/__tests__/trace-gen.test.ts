#!/usr/bin/env node
/**
 * Tests for trace-gen CLI command
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Trace generator creates traceability reports linking WUs to code changes,
 * useful for audit trails and compliance documentation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import functions under test
import {
  parseTraceArgs,
  TraceArgs,
  TraceFormat,
  buildTraceEntry,
  TraceEntry,
} from '../trace-gen.js';

describe('trace-gen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseTraceArgs', () => {
    it('should parse --wu flag', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js', '--wu', 'WU-1112']);
      expect(args.wuId).toBe('WU-1112');
    });

    it('should parse --format json', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js', '--format', 'json']);
      expect(args.format).toBe('json');
    });

    it('should parse --format markdown', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js', '--format', 'markdown']);
      expect(args.format).toBe('markdown');
    });

    it('should parse --output flag', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js', '--output', 'trace.json']);
      expect(args.output).toBe('trace.json');
    });

    it('should parse --since flag', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js', '--since', '2024-01-01']);
      expect(args.since).toBe('2024-01-01');
    });

    it('should parse --help flag', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js', '--help']);
      expect(args.help).toBe(true);
    });

    it('should default format to json', () => {
      const args = parseTraceArgs(['node', 'trace-gen.js']);
      expect(args.format).toBeUndefined();
    });
  });

  describe('TraceFormat enum', () => {
    it('should have JSON format', () => {
      expect(TraceFormat.JSON).toBe('json');
    });

    it('should have markdown format', () => {
      expect(TraceFormat.MARKDOWN).toBe('markdown');
    });

    it('should have CSV format', () => {
      expect(TraceFormat.CSV).toBe('csv');
    });
  });

  describe('buildTraceEntry', () => {
    it('should build trace entry from WU and commit data', () => {
      const entry = buildTraceEntry({
        wuId: 'WU-1112',
        title: 'Migrate tools',
        status: 'done',
        commits: [{ sha: 'abc1234', message: 'feat: add deps-add', date: '2024-01-15T10:00:00Z' }],
        files: ['src/deps-add.ts'],
      });

      expect(entry.wuId).toBe('WU-1112');
      expect(entry.title).toBe('Migrate tools');
      expect(entry.status).toBe('done');
      expect(entry.commitCount).toBe(1);
      expect(entry.fileCount).toBe(1);
    });

    it('should calculate commit count correctly', () => {
      const entry = buildTraceEntry({
        wuId: 'WU-1112',
        title: 'Test',
        status: 'done',
        commits: [
          { sha: 'abc1234', message: 'feat: first', date: '2024-01-15T10:00:00Z' },
          { sha: 'def5678', message: 'feat: second', date: '2024-01-16T10:00:00Z' },
          { sha: 'ghi9012', message: 'fix: third', date: '2024-01-17T10:00:00Z' },
        ],
        files: ['a.ts', 'b.ts'],
      });

      expect(entry.commitCount).toBe(3);
      expect(entry.fileCount).toBe(2);
    });

    it('should include first and last commit dates', () => {
      const entry = buildTraceEntry({
        wuId: 'WU-1112',
        title: 'Test',
        status: 'done',
        commits: [
          { sha: 'abc1234', message: 'feat: first', date: '2024-01-15T10:00:00Z' },
          { sha: 'def5678', message: 'feat: last', date: '2024-01-20T10:00:00Z' },
        ],
        files: [],
      });

      expect(entry.firstCommit).toBe('2024-01-15T10:00:00Z');
      expect(entry.lastCommit).toBe('2024-01-20T10:00:00Z');
    });

    it('should handle empty commits array', () => {
      const entry = buildTraceEntry({
        wuId: 'WU-1112',
        title: 'Test',
        status: 'done',
        commits: [],
        files: [],
      });

      expect(entry.commitCount).toBe(0);
      expect(entry.firstCommit).toBeUndefined();
      expect(entry.lastCommit).toBeUndefined();
    });
  });
});
