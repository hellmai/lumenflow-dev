import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STAMP_FORMAT_ERRORS,
  isValidDateString,
  parseStampContent,
  validateStampFormat,
} from '../stamp-utils.js';

describe('stamp-utils', () => {
  describe('isValidDateString', () => {
    it('accepts valid ISO dates and rejects invalid dates', () => {
      expect(isValidDateString('2026-02-15')).toBe(true);
      expect(isValidDateString('2026-02-31')).toBe(false);
      expect(isValidDateString('15-02-2026')).toBe(false);
    });
  });

  describe('parseStampContent', () => {
    it('extracts wu id, title, and completed date', () => {
      const metadata = parseStampContent('WU WU-1710 - Type stamp utils\nCompleted: 2026-02-15\n');

      expect(metadata).toEqual({
        wuId: 'WU-1710',
        title: 'Type stamp utils',
        completedDate: '2026-02-15',
      });
    });
  });

  describe('validateStampFormat', () => {
    let projectRoot = '';

    beforeEach(async () => {
      projectRoot = await mkdtemp(path.join(os.tmpdir(), 'stamp-utils-'));
      await mkdir(path.join(projectRoot, '.lumenflow', 'stamps'), { recursive: true });
    });

    afterEach(async () => {
      await rm(projectRoot, { recursive: true, force: true });
    });

    it('returns missing when the stamp file does not exist', async () => {
      const result = await validateStampFormat('WU-1710', projectRoot);

      expect(result).toEqual({ valid: false, errors: [], missing: true });
    });

    it('reports mismatch and invalid date errors for malformed stamp content', async () => {
      const stampPath = path.join(projectRoot, '.lumenflow', 'stamps', 'WU-1710.done');
      await writeFile(stampPath, 'WU WU-0001 - Wrong WU\nCompleted: 2026-13-99\n', 'utf-8');

      const result = await validateStampFormat('WU-1710', projectRoot);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        STAMP_FORMAT_ERRORS.WU_ID_MISMATCH,
        STAMP_FORMAT_ERRORS.INVALID_DATE_FORMAT,
      ]);
    });

    it('accepts a correctly formatted stamp file', async () => {
      const stampPath = path.join(projectRoot, '.lumenflow', 'stamps', 'WU-1710.done');
      await writeFile(stampPath, 'WU WU-1710 - Correct WU\nCompleted: 2026-02-15\n', 'utf-8');

      const result = await validateStampFormat('WU-1710', projectRoot);

      expect(result).toEqual({ valid: true, errors: [] });
    });
  });
});
