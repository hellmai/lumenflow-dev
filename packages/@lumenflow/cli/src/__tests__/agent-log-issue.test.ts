/**
 * Tests for agent-log-issue CLI
 *
 * WU-1182: Validates that agent-log-issue.ts uses Commander.js repeatable
 * options pattern instead of comma-separated splits for --tags and --files.
 *
 * Per Commander.js best practices:
 * - Repeatable: --tag a --tag b → ['a', 'b'] (explicit, no ambiguity)
 * - Comma-split: --tags "a,b" → splits on comma (ambiguous if values contain commas)
 *
 * The repeatable pattern is preferred for multi-value options.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('WU-1182: agent-log-issue CLI patterns', () => {
  const srcDir = path.resolve(__dirname, '..');
  const filePath = path.join(srcDir, 'agent-log-issue.ts');
  const content = readFileSync(filePath, 'utf-8');

  describe('--tags option', () => {
    it('should use repeatable pattern instead of comma-separated', () => {
      // Should NOT have comma-split pattern for tags
      const hasCommaSplit = /opts\.tags\s*\?\s*opts\.tags\.split\s*\(\s*['"],['"]/.test(content);
      expect(hasCommaSplit, 'should not use comma-split for --tags').toBe(false);
    });

    it('should define --tag as repeatable option (not --tags with comma)', () => {
      // Should have repeatable option pattern with collect function
      // Either using Commander's variadic syntax (...) or custom collect function
      const hasRepeatableTag =
        /\.option\s*\(\s*['"]--tag\s+</.test(content) ||
        /\.option\s*\(\s*['"]--tags?\s+<[^>]+>\.\.\./.test(content) ||
        /collect(?:Repeatable)?/.test(content);

      expect(hasRepeatableTag, 'should use repeatable --tag option or collect function').toBe(true);
    });
  });

  describe('--files option', () => {
    it('should use repeatable pattern instead of comma-separated', () => {
      // Should NOT have comma-split pattern for files
      const hasCommaSplit = /opts\.files\s*\?\s*opts\.files\.split\s*\(\s*['"],['"]/.test(content);
      expect(hasCommaSplit, 'should not use comma-split for --files').toBe(false);
    });

    it('should define --file as repeatable option (not --files with comma)', () => {
      // Should have repeatable option pattern
      const hasRepeatableFile =
        /\.option\s*\(\s*['"]--file\s+</.test(content) ||
        /\.option\s*\(\s*['"]--files?\s+<[^>]+>\.\.\./.test(content) ||
        /collect(?:Repeatable)?/.test(content);

      expect(hasRepeatableFile, 'should use repeatable --file option or collect function').toBe(
        true,
      );
    });
  });

  describe('Commander.js best practices', () => {
    it('should not import comma-split utility functions', () => {
      // Should not have custom comma-split helper
      const hasCommaSplitHelper = /commaSeparatedList|splitComma/.test(content);
      expect(hasCommaSplitHelper, 'should not use comma-split helpers').toBe(false);
    });
  });
});
