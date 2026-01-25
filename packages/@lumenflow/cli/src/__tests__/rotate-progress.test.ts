#!/usr/bin/env node
/**
 * Tests for rotate-progress CLI command
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Rotate progress moves completed WUs from status.md In Progress
 * section to Completed section, keeping the file tidy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import functions under test
import {
  parseRotateArgs,
  RotateArgs,
  findCompletedWUs,
  buildRotatedContent,
} from '../rotate-progress.js';

describe('rotate-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseRotateArgs', () => {
    it('should parse --dry-run flag', () => {
      const args = parseRotateArgs(['node', 'rotate-progress.js', '--dry-run']);
      expect(args.dryRun).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = parseRotateArgs(['node', 'rotate-progress.js', '--help']);
      expect(args.help).toBe(true);
    });

    it('should parse --limit flag', () => {
      const args = parseRotateArgs(['node', 'rotate-progress.js', '--limit', '10']);
      expect(args.limit).toBe(10);
    });

    it('should default dryRun to false', () => {
      const args = parseRotateArgs(['node', 'rotate-progress.js']);
      expect(args.dryRun).toBeFalsy();
    });

    it('should default limit to undefined', () => {
      const args = parseRotateArgs(['node', 'rotate-progress.js']);
      expect(args.limit).toBeUndefined();
    });
  });

  describe('findCompletedWUs', () => {
    it('should find WUs with done status in In Progress section', () => {
      const statusContent = `## In Progress
- WU-1001 - Feature A
- WU-1002 - Feature B (done)

## Completed
- WU-1000 - Old feature (2024-01-01)
`;
      const wuStatuses = new Map([
        ['WU-1001', 'in_progress'],
        ['WU-1002', 'done'],
      ]);

      const completed = findCompletedWUs(statusContent, wuStatuses);
      expect(completed).toContain('WU-1002');
      expect(completed).not.toContain('WU-1001');
    });

    it('should return empty array when no completed WUs found', () => {
      const statusContent = `## In Progress
- WU-1001 - Feature A

## Completed
`;
      const wuStatuses = new Map([['WU-1001', 'in_progress']]);

      const completed = findCompletedWUs(statusContent, wuStatuses);
      expect(completed).toEqual([]);
    });

    it('should handle multiple completed WUs', () => {
      const statusContent = `## In Progress
- WU-1001 - Feature A
- WU-1002 - Feature B
- WU-1003 - Feature C

## Completed
`;
      const wuStatuses = new Map([
        ['WU-1001', 'done'],
        ['WU-1002', 'done'],
        ['WU-1003', 'in_progress'],
      ]);

      const completed = findCompletedWUs(statusContent, wuStatuses);
      expect(completed).toContain('WU-1001');
      expect(completed).toContain('WU-1002');
      expect(completed).not.toContain('WU-1003');
    });
  });

  describe('buildRotatedContent', () => {
    it('should move completed WUs to Completed section', () => {
      const statusContent = `## In Progress
- WU-1001 - Feature A
- WU-1002 - Feature B

## Completed
- WU-1000 - Old feature (2024-01-01)
`;
      const completedWUs = ['WU-1002'];

      const result = buildRotatedContent(statusContent, completedWUs);

      // WU-1002 should be removed from In Progress
      expect(result).not.toContain('## In Progress\n- WU-1001 - Feature A\n- WU-1002 - Feature B');
      // WU-1001 should still be in In Progress
      expect(result).toContain('WU-1001 - Feature A');
      // WU-1002 should be in Completed
      expect(result).toContain('WU-1002');
    });

    it('should preserve existing completed entries', () => {
      const statusContent = `## In Progress
- WU-1001 - Feature A

## Completed
- WU-1000 - Old feature (2024-01-01)
`;
      const completedWUs = ['WU-1001'];

      const result = buildRotatedContent(statusContent, completedWUs);

      // Existing completed entry should remain
      expect(result).toContain('WU-1000 - Old feature');
    });

    it('should add date stamp to newly completed WUs', () => {
      const statusContent = `## In Progress
- WU-1001 - Feature A

## Completed
`;
      const completedWUs = ['WU-1001'];

      const result = buildRotatedContent(statusContent, completedWUs);

      // Should have a date stamp (YYYY-MM-DD format)
      expect(result).toMatch(/WU-1001.*\(\d{4}-\d{2}-\d{2}\)/);
    });
  });
});
