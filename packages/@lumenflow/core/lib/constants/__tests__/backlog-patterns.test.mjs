import { describe, it, expect } from 'vitest';
import { IN_PROGRESS_HEADERS, WU_LINK_PATTERN, isInProgressHeader } from '../backlog-patterns.mjs';

describe('backlog-patterns', () => {
  describe('IN_PROGRESS_HEADERS', () => {
    it('contains expected header variations', () => {
      expect(IN_PROGRESS_HEADERS).toContain('## in progress');
    });

    it('is non-empty array', () => {
      expect(Array.isArray(IN_PROGRESS_HEADERS)).toBe(true);
      expect(IN_PROGRESS_HEADERS.length).toBeGreaterThan(0);
    });
  });

  describe('WU_LINK_PATTERN', () => {
    it('matches standard WU link format', () => {
      const link = '[WU-123 — Some title](wu/WU-123.yaml)';
      WU_LINK_PATTERN.lastIndex = 0; // Reset regex state
      const match = WU_LINK_PATTERN.exec(link);
      expect(match).not.toBeNull();
      expect(match[1]).toBe('WU-123');
    });

    it('matches WU link with em dash', () => {
      const link = '[WU-456 — Another title](path/to/file.yaml)';
      WU_LINK_PATTERN.lastIndex = 0;
      const match = WU_LINK_PATTERN.exec(link);
      expect(match).not.toBeNull();
      expect(match[1]).toBe('WU-456');
    });

    it('captures WU ID correctly', () => {
      const text =
        'Some text [WU-789 — Title here](file.yaml) more text [WU-101 — Other](other.yaml)';
      WU_LINK_PATTERN.lastIndex = 0;
      const matches = [...text.matchAll(WU_LINK_PATTERN)];
      expect(matches.length).toBe(2);
      expect(matches[0][1]).toBe('WU-789');
      expect(matches[1][1]).toBe('WU-101');
    });
  });

  describe('isInProgressHeader', () => {
    it('returns true for exact match', () => {
      expect(isInProgressHeader('## In Progress')).toBe(true);
    });

    it('returns true for emoji variant', () => {
      expect(isInProgressHeader('## 🔧 In Progress')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isInProgressHeader('## IN PROGRESS')).toBe(true);
      expect(isInProgressHeader('## in progress')).toBe(true);
    });

    it('handles leading/trailing whitespace', () => {
      expect(isInProgressHeader('  ## In Progress  ')).toBe(true);
    });

    it('returns false for non-matching headers', () => {
      expect(isInProgressHeader('## Ready')).toBe(false);
      expect(isInProgressHeader('## Done')).toBe(false);
      expect(isInProgressHeader('In Progress')).toBe(false);
    });
  });
});
