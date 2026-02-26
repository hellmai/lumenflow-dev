// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU ID Generator Tests (WU-1246, WU-2208)
 *
 * Tests for auto-generating sequential WU IDs by scanning existing WU YAML files.
 * WU-2208: Extended to test remote-aware ID generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  getNextWuId,
  getHighestWuId,
  parseWuIdNumber,
  generateWuIdWithRetry,
  WU_ID_PREFIX,
  extractHighestIdFromEntries,
  getHighestWuIdFromEvents,
  getHighestWuIdRemoteAware,
} from '../wu-id-generator.js';
import type { IWuIdGitAdapter } from '../wu-id-generator.js';

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
    STAMPS_DIR: (): string => '.lumenflow/stamps',
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

    it('should handle stamp filenames (WU-XXX.done)', () => {
      expect(parseWuIdNumber('WU-123.done')).toBe(123);
      expect(parseWuIdNumber('WU-2198.done')).toBe(2198);
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

  // === WU-2208: Remote-aware ID generation tests ===

  describe('extractHighestIdFromEntries (WU-2208)', () => {
    it('should extract highest WU ID from a list of filenames', () => {
      const entries = ['WU-100.yaml', 'WU-200.yaml', 'WU-50.yaml', 'README.md'];
      expect(extractHighestIdFromEntries(entries)).toBe(200);
    });

    it('should handle stamp filenames (WU-XXX.done)', () => {
      const entries = ['WU-100.done', 'WU-2198.done', 'WU-50.done'];
      expect(extractHighestIdFromEntries(entries)).toBe(2198);
    });

    it('should return 0 for empty list', () => {
      expect(extractHighestIdFromEntries([])).toBe(0);
    });

    it('should return 0 when no valid WU entries exist', () => {
      const entries = ['README.md', '.gitkeep', 'template.yaml'];
      expect(extractHighestIdFromEntries(entries)).toBe(0);
    });

    it('should handle mixed yaml and done entries', () => {
      const entries = ['WU-100.yaml', 'WU-300.done', 'WU-200.yaml'];
      expect(extractHighestIdFromEntries(entries)).toBe(300);
    });
  });

  describe('getHighestWuIdFromEvents (WU-2208)', () => {
    it('should extract highest WU ID from events JSONL content', () => {
      const eventsContent = [
        '{"type":"claim","wuId":"WU-100","timestamp":"2026-01-01T00:00:00.000Z"}',
        '{"type":"complete","wuId":"WU-200","timestamp":"2026-01-02T00:00:00.000Z"}',
        '{"type":"claim","wuId":"WU-150","timestamp":"2026-01-03T00:00:00.000Z"}',
      ].join('\n');
      expect(getHighestWuIdFromEvents(eventsContent)).toBe(200);
    });

    it('should return 0 for empty events content', () => {
      expect(getHighestWuIdFromEvents('')).toBe(0);
    });

    it('should handle malformed JSON lines gracefully', () => {
      const eventsContent = [
        '{"type":"claim","wuId":"WU-100"}',
        'not valid json',
        '{"type":"complete","wuId":"WU-200"}',
      ].join('\n');
      expect(getHighestWuIdFromEvents(eventsContent)).toBe(200);
    });

    it('should handle events without wuId field', () => {
      const eventsContent = [
        '{"type":"claim","wuId":"WU-50"}',
        '{"type":"system","message":"startup"}',
      ].join('\n');
      expect(getHighestWuIdFromEvents(eventsContent)).toBe(50);
    });
  });

  describe('getHighestWuIdRemoteAware (WU-2208)', () => {
    /** Helper to create a mock IWuIdGitAdapter */
    function createMockGitAdapter(overrides: Partial<IWuIdGitAdapter> = {}): IWuIdGitAdapter {
      return {
        fetch: vi.fn().mockResolvedValue(undefined),
        listTreeAtRef: vi.fn().mockResolvedValue([]),
        showFileAtRef: vi.fn().mockResolvedValue(''),
        ...overrides,
      };
    }

    it('should consider remote YAML files for highest ID (AC1, AC2)', async () => {
      // Local has WU-100, remote has WU-200
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([WU_100_YAML] as unknown as fs.Dirent[]);

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockImplementation((_ref: string, path: string) => {
          if (path.includes('tasks/wu')) {
            return Promise.resolve(['WU-100.yaml', 'WU-200.yaml']);
          }
          if (path.includes('stamps')) {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        }),
        showFileAtRef: vi.fn().mockResolvedValue(''),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      expect(result).toBe(200);
      expect(git.fetch).toHaveBeenCalled();
    });

    it('should consider remote stamps for highest ID (AC2)', async () => {
      // Local has WU-100, remote stamps have WU-300
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([WU_100_YAML] as unknown as fs.Dirent[]);

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockImplementation((_ref: string, path: string) => {
          if (path.includes('tasks/wu')) {
            return Promise.resolve(['WU-100.yaml']);
          }
          if (path.includes('stamps')) {
            return Promise.resolve(['WU-300.done']);
          }
          return Promise.resolve([]);
        }),
        showFileAtRef: vi.fn().mockResolvedValue(''),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      expect(result).toBe(300);
    });

    it('should consider local stamps for highest ID (AC2)', async () => {
      // Local YAML has WU-100, local stamps have WU-400
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('stamps')) {
          return ['WU-400.done'] as unknown as fs.Dirent[];
        }
        return [WU_100_YAML] as unknown as fs.Dirent[];
      });

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockResolvedValue([]),
        showFileAtRef: vi.fn().mockResolvedValue(''),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      expect(result).toBe(400);
    });

    it('should consider wu-events.jsonl from remote for highest ID (AC2)', async () => {
      // Local has WU-100, remote events have WU-500
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([WU_100_YAML] as unknown as fs.Dirent[]);

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockResolvedValue([]),
        showFileAtRef: vi.fn().mockImplementation((_ref: string, path: string) => {
          if (path.includes('wu-events.jsonl')) {
            return Promise.resolve(
              '{"type":"claim","wuId":"WU-500","timestamp":"2026-01-01T00:00:00.000Z"}\n',
            );
          }
          return Promise.resolve('');
        }),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      expect(result).toBe(500);
    });

    it('should take the maximum across all sources (AC2)', async () => {
      // Local YAML: WU-100, Remote YAML: WU-150, Remote stamps: WU-200, Remote events: WU-180
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('stamps')) {
          return ['WU-50.done'] as unknown as fs.Dirent[];
        }
        return [WU_100_YAML] as unknown as fs.Dirent[];
      });

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockImplementation((_ref: string, path: string) => {
          if (path.includes('tasks/wu')) {
            return Promise.resolve(['WU-150.yaml']);
          }
          if (path.includes('stamps')) {
            return Promise.resolve(['WU-200.done']);
          }
          return Promise.resolve([]);
        }),
        showFileAtRef: vi.fn().mockImplementation((_ref: string, path: string) => {
          if (path.includes('wu-events.jsonl')) {
            return Promise.resolve(
              '{"type":"claim","wuId":"WU-180","timestamp":"2026-01-01T00:00:00.000Z"}\n',
            );
          }
          return Promise.resolve('');
        }),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      // Max of 100, 50, 150, 200, 180 = 200
      expect(result).toBe(200);
    });

    it('should skip fetch and print warning with offline flag (AC3)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('stamps')) {
          return ['WU-50.done'] as unknown as fs.Dirent[];
        }
        return [WU_100_YAML] as unknown as fs.Dirent[];
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const git = createMockGitAdapter();

      const result = await getHighestWuIdRemoteAware({ git, offline: true });

      // Should only consider local sources (YAML=100, stamps=50)
      expect(result).toBe(100);
      expect(git.fetch).not.toHaveBeenCalled();
      expect(git.listTreeAtRef).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('offline'),
      );

      consoleSpy.mockRestore();
    });

    it('should return same result as local when remote agrees (AC5)', async () => {
      // Local and remote both have WU-100 as highest
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('stamps')) {
          return [] as unknown as fs.Dirent[];
        }
        return [WU_100_YAML] as unknown as fs.Dirent[];
      });

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockImplementation((_ref: string, path: string) => {
          if (path.includes('tasks/wu')) {
            return Promise.resolve(['WU-100.yaml']);
          }
          return Promise.resolve([]);
        }),
        showFileAtRef: vi.fn().mockResolvedValue(''),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      expect(result).toBe(100);
    });

    it('should handle remote fetch failure gracefully', async () => {
      // If fetch fails, fall back to local only with warning
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('stamps')) {
          return [] as unknown as fs.Dirent[];
        }
        return [WU_100_YAML] as unknown as fs.Dirent[];
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const git = createMockGitAdapter({
        fetch: vi.fn().mockRejectedValue(new Error('network error')),
        listTreeAtRef: vi.fn().mockRejectedValue(new Error('no remote ref')),
        showFileAtRef: vi.fn().mockRejectedValue(new Error('no remote ref')),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      // Falls back to local: YAML=100
      expect(result).toBe(100);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('remote'),
      );

      consoleSpy.mockRestore();
    });

    it('should handle listTreeAtRef returning empty when path does not exist at ref', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('stamps')) {
          return [] as unknown as fs.Dirent[];
        }
        return ['WU-50.yaml'] as unknown as fs.Dirent[];
      });

      const git = createMockGitAdapter({
        listTreeAtRef: vi.fn().mockResolvedValue([]),
        showFileAtRef: vi.fn().mockResolvedValue(''),
      });

      const result = await getHighestWuIdRemoteAware({ git });
      expect(result).toBe(50);
    });
  });
});
