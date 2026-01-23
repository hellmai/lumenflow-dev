/**
 * @file beacon-migration.test.ts
 * @description Tests for .beacon → .lumenflow migration (WU-1075)
 */

import * as fs from 'fs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrateBeaconToLumenflow, needsMigration } from '../beacon-migration.js';

// Mock fs module
vi.mock('fs');
const mockFs = vi.mocked(fs);

describe('beacon-migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('migrateBeaconToLumenflow', () => {
    it('migrates .beacon to .lumenflow when only .beacon exists', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        return pathStr.endsWith('.beacon');
      });
      mockFs.renameSync.mockImplementation(() => {});

      const result = migrateBeaconToLumenflow('/project');

      expect(result.migrated).toBe(true);
      expect(result.reason).toBe('migrated');
      expect(result.fromPath).toBe('/project/.beacon');
      expect(result.toPath).toBe('/project/.lumenflow');
      expect(mockFs.renameSync).toHaveBeenCalledWith('/project/.beacon', '/project/.lumenflow');
    });

    it('returns already_migrated when only .lumenflow exists', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        return pathStr.endsWith('.lumenflow');
      });

      const result = migrateBeaconToLumenflow('/project');

      expect(result.migrated).toBe(false);
      expect(result.reason).toBe('already_migrated');
      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });

    it('returns no_legacy_dir when neither directory exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = migrateBeaconToLumenflow('/project');

      expect(result.migrated).toBe(false);
      expect(result.reason).toBe('no_legacy_dir');
      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });

    it('returns both_exist conflict when both directories exist', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = migrateBeaconToLumenflow('/project');

      expect(result.migrated).toBe(false);
      expect(result.reason).toBe('both_exist');
      expect(result.error).toContain('manually resolve');
      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });

    it('handles rename errors gracefully', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        return pathStr.endsWith('.beacon');
      });
      mockFs.renameSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = migrateBeaconToLumenflow('/project');

      expect(result.migrated).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('uses current working directory by default', () => {
      const originalCwd = process.cwd();
      mockFs.existsSync.mockReturnValue(false);

      migrateBeaconToLumenflow();

      expect(mockFs.existsSync).toHaveBeenCalledWith(`${originalCwd}/.beacon`);
    });
  });

  describe('needsMigration', () => {
    it('returns true when .beacon exists and .lumenflow does not', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        return pathStr.endsWith('.beacon');
      });

      expect(needsMigration('/project')).toBe(true);
    });

    it('returns false when .lumenflow already exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      expect(needsMigration('/project')).toBe(false);
    });

    it('returns false when neither directory exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(needsMigration('/project')).toBe(false);
    });
  });
});
