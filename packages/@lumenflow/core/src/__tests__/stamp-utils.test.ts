/**
 * @file stamp-utils.test.ts
 * Test suite for stamp-utils (WU-1006)
 *
 * Tests date validation using date-fns (Library-First principle)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isValid, parse } from 'date-fns';

// Test that date-fns is the library being used (not manual parseInt)
describe('stamp-utils date validation (WU-1006)', () => {
  describe('isValidDate using date-fns', () => {
    it('should validate correct YYYY-MM-DD dates', async () => {
      const { isValidDateString } = await import('../stamp-utils.js');

      expect(isValidDateString('2026-01-18')).toBe(true);
      expect(isValidDateString('2025-12-31')).toBe(true);
      expect(isValidDateString('2024-02-29')).toBe(true); // Leap year
    });

    it('should reject invalid dates', async () => {
      const { isValidDateString } = await import('../stamp-utils.js');

      expect(isValidDateString('2025-13-01')).toBe(false); // Invalid month
      expect(isValidDateString('2025-02-30')).toBe(false); // Invalid day
      expect(isValidDateString('2023-02-29')).toBe(false); // Not a leap year
      expect(isValidDateString('invalid')).toBe(false);
      expect(isValidDateString('')).toBe(false);
    });

    it('should reject malformed date strings', async () => {
      const { isValidDateString } = await import('../stamp-utils.js');

      expect(isValidDateString('2025/01/18')).toBe(false); // Wrong separator
      expect(isValidDateString('18-01-2025')).toBe(false); // Wrong order
      expect(isValidDateString('2025-1-18')).toBe(false); // Missing leading zero
    });
  });
});

describe('stamp file operations', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseStampContent', () => {
    it('should parse valid stamp content', async () => {
      const { parseStampContent } = await import('../stamp-utils.js');

      const content = `WU WU-1234 — Test title
Completed: 2026-01-18
`;

      const result = parseStampContent(content);

      expect(result.wuId).toBe('WU-1234');
      expect(result.title).toBe('Test title');
      expect(result.completedDate).toBe('2026-01-18');
    });

    it('should handle missing fields gracefully', async () => {
      const { parseStampContent } = await import('../stamp-utils.js');

      const content = 'Some random content';
      const result = parseStampContent(content);

      expect(result.wuId).toBeUndefined();
      expect(result.title).toBeUndefined();
      expect(result.completedDate).toBeUndefined();
    });
  });
});
