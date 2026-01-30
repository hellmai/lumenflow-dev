/**
 * WU ID Generator Tests (WU-1246)
 *
 * Tests for auto-generating sequential WU IDs by scanning existing WU YAML files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  getNextWuId,
  getHighestWuId,
  parseWuIdNumber,
  generateWuIdWithRetry,
  WU_ID_PREFIX,
} from '../wu-id-generator.js';

/** Test constant for WU-100.yaml filename (DRY - sonarjs/no-duplicate-string) */
const WU_100_YAML = 'WU-100.yaml';
/** Test constant for WU-101.yaml filename */
const WU_101_YAML = 'WU-101.yaml';
/** Test constant for WU-102.yaml filename */
const WU_102_YAML = 'WU-102.yaml';

// Mock fs module
vi.mock('node:fs');

// Mock wu-paths to return predictable paths
vi.mock('../wu-paths.js', () => ({
  WU_PATHS: {
    WU_DIR: (): string => 'docs/04-operations/tasks/wu',
    WU: (id: string): string => `docs/04-operations/tasks/wu/${id}.yaml`,
  },
}));

describe('wu-id-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseWuIdNumber', () => {
    it('should parse numeric part from WU-XXXX format', () => {
      expect(parseWuIdNumber('WU-123')).toBe(123);
      expect(parseWuIdNumber('WU-1')).toBe(1);
      expect(parseWuIdNumber('WU-9999')).toBe(9999);
      expect(parseWuIdNumber('WU-0001')).toBe(1);
    });

    it('should return null for invalid WU IDs', () => {
      expect(parseWuIdNumber('invalid')).toBeNull();
      expect(parseWuIdNumber('WU-')).toBeNull();
      expect(parseWuIdNumber('WU-abc')).toBeNull();
      expect(parseWuIdNumber('123')).toBeNull();
      expect(parseWuIdNumber('')).toBeNull();
    });

    it('should handle WU IDs from filenames (WU-XXX.yaml)', () => {
      expect(parseWuIdNumber('WU-123.yaml')).toBe(123);
      expect(parseWuIdNumber('WU-1001.yaml')).toBe(1001);
    });
  });

  describe('getHighestWuId', () => {
    it('should return 0 when WU directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getHighestWuId();

      expect(result).toBe(0);
    });

    it('should return 0 when WU directory is empty', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const result = getHighestWuId();

      expect(result).toBe(0);
    });

    it('should return highest WU ID number from directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        WU_100_YAML,
        'WU-200.yaml',
        'WU-150.yaml',
        'README.md', // Should be ignored
      ] as unknown as fs.Dirent[]);

      const result = getHighestWuId();

      expect(result).toBe(200);
    });

    it('should handle WU IDs with different number lengths', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'WU-1.yaml',
        'WU-10.yaml',
        WU_100_YAML,
        'WU-1000.yaml',
        'WU-1246.yaml',
      ] as unknown as fs.Dirent[]);

      const result = getHighestWuId();

      expect(result).toBe(1246);
    });

    it('should ignore non-WU files in directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'WU-50.yaml',
        'README.md',
        '.gitkeep',
        'template.yaml',
        'WU-abc.yaml', // Invalid - should be ignored
      ] as unknown as fs.Dirent[]);

      const result = getHighestWuId();

      expect(result).toBe(50);
    });
  });

  describe('getNextWuId', () => {
    it('should return WU-1 when no WUs exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getNextWuId();

      expect(result).toBe('WU-1');
    });

    it('should return next sequential ID after highest existing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        WU_100_YAML,
        'WU-200.yaml',
        'WU-150.yaml',
      ] as unknown as fs.Dirent[]);

      const result = getNextWuId();

      expect(result).toBe('WU-201');
    });

    it('should handle gaps in ID sequence (always use highest + 1)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'WU-1.yaml',
        'WU-5.yaml',
        'WU-10.yaml',
        // Gap: 2,3,4,6,7,8,9 are missing - that's OK
      ] as unknown as fs.Dirent[]);

      const result = getNextWuId();

      // Should be 11, not fill gaps
      expect(result).toBe('WU-11');
    });
  });

  describe('generateWuIdWithRetry', () => {
    it('should return generated ID when file does not exist', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        // WU dir exists but no WU files exist yet
        return pathStr.includes('tasks/wu') && !pathStr.endsWith('.yaml');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const result = await generateWuIdWithRetry();

      expect(result).toBe('WU-1');
    });

    it('should retry when conflict detected (file exists after generation)', async () => {
      let callCount = 0;
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        // WU dir exists
        if (pathStr.includes('tasks/wu') && !pathStr.endsWith('.yaml')) {
          return true;
        }
        // First check: WU-101 exists (conflict)
        // Second check: WU-102 does not exist
        if (pathStr.includes(WU_101_YAML)) {
          callCount++;
          return callCount === 1;
        }
        if (pathStr.includes(WU_102_YAML)) {
          return false;
        }
        return false;
      });
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        // First scan returns up to WU-100, second scan returns up to WU-101
        if (callCount === 0) {
          return [WU_100_YAML] as unknown as fs.Dirent[];
        }
        return [WU_100_YAML, WU_101_YAML] as unknown as fs.Dirent[];
      });

      const result = await generateWuIdWithRetry();

      expect(result).toBe('WU-102');
    });

    it('should throw after max retries exceeded', async () => {
      // All paths exist - WU dir and all generated WU files (persistent conflict)
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'WU-1.yaml',
        'WU-2.yaml',
        'WU-3.yaml',
        'WU-4.yaml',
        'WU-5.yaml',
      ] as unknown as fs.Dirent[]);

      await expect(generateWuIdWithRetry({ maxRetries: 3 })).rejects.toThrow(
        /Failed to generate unique WU ID after \d+ attempts/,
      );
    });
  });

  describe('WU_ID_PREFIX', () => {
    it('should be "WU-"', () => {
      expect(WU_ID_PREFIX).toBe('WU-');
    });
  });
});
