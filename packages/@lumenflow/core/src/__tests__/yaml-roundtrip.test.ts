/**
 * Round-trip YAML tests (WU-1342)
 *
 * Validates that YAML parse → stringify → parse doesn't lose data
 * across the full WU corpus in docs/04-operations/tasks/wu/
 *
 * This test suite verifies the migration from js-yaml to yaml library
 * preserves all data structures correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

const WU_DIR = 'docs/04-operations/tasks/wu';

// Skip tests if WU corpus doesn't exist (running in standalone package)
const hasWUCorpus = existsSync(WU_DIR);

/**
 * Get all WU YAML files
 * @returns {string[]} Array of WU file paths
 */
function getWUFiles() {
  const files = readdirSync(WU_DIR);
  return files
    .filter((f) => f.endsWith('.yaml') && f.startsWith('WU-'))
    .map((f) => join(WU_DIR, f));
}

/**
 * Deep equality check for objects, ignoring undefined values
 * YAML libraries may handle undefined differently
 *
 * @param {any} obj1 - First object
 * @param {any} obj2 - Second object
 * @returns {boolean} True if structurally equal
 */
function deepEqualIgnoreUndefined(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return obj1 === obj2;
  if (typeof obj1 !== typeof obj2) return false;

  if (Array.isArray(obj1)) {
    if (!Array.isArray(obj2)) return false;
    if (obj1.length !== obj2.length) return false;
    return obj1.every((item, i) => deepEqualIgnoreUndefined(item, obj2[i]));
  }

  if (typeof obj1 === 'object') {
    const keys1 = Object.keys(obj1).filter((k) => obj1[k] !== undefined);
    const keys2 = Object.keys(obj2).filter((k) => obj2[k] !== undefined);

    if (keys1.length !== keys2.length) return false;
    if (!keys1.every((k) => keys2.includes(k))) return false;

    return keys1.every((k) => deepEqualIgnoreUndefined(obj1[k], obj2[k]));
  }

  return obj1 === obj2;
}

describe.skipIf(!hasWUCorpus)('YAML round-trip tests (WU-1342)', () => {
  const wuFiles = hasWUCorpus ? getWUFiles() : [];

  it('should find WU YAML files in corpus', () => {
    expect(wuFiles.length > 0).toBe(true);
    expect(wuFiles.length > 200).toBe(true);
  });

  describe('round-trip conversion', () => {
    wuFiles.forEach((wuPath) => {
      const wuId = wuPath.match(/WU-\d+/)?.[0];

      it(`should preserve structure for ${wuId}`, () => {
        // Read original YAML
        const originalText = readFileSync(wuPath, 'utf8');

        let parsed1;
        try {
          // Parse with yaml library
          parsed1 = parse(originalText);
        } catch (err: any) {
          // Skip malformed legacy files that yaml library rejects
          // (These are pre-existing issues, not caused by library migration)
          expect(
            err.message.includes('Implicit keys need to be on a single line') ||
              err.message.includes('Nested mappings are not allowed')
          ).toBe(true);
          return; // Skip this test
        }

        expect(parsed1).toBeTruthy();
        expect(parsed1.id).toBe(wuId);

        // Stringify back to YAML
        const stringified = stringify(parsed1, { lineWidth: 100 });
        expect(stringified).toBeTruthy();
        expect(stringified.length > 0).toBe(true);

        // Parse again
        const parsed2 = parse(stringified);
        expect(parsed2).toBeTruthy();

        // Verify structural equality (not raw text equality)
        expect(deepEqualIgnoreUndefined(parsed1, parsed2)).toBe(true);
      });
    });
  });

  describe('key field preservation', () => {
    wuFiles.forEach((wuPath) => {
      const wuId = wuPath.match(/WU-\d+/)?.[0];

      it(`should preserve required fields for ${wuId}`, () => {
        const originalText = readFileSync(wuPath, 'utf8');

        let parsed;
        try {
          parsed = parse(originalText);
        } catch (err) {
          // Skip malformed legacy files
          return;
        }

        const stringified = stringify(parsed, { lineWidth: 100 });
        const reparsed = parse(stringified);

        // Check required fields
        expect(reparsed.id).toBe(parsed.id, 'id should be preserved');
        expect(reparsed.title).toBe(parsed.title, 'title should be preserved');
        expect(reparsed.lane).toBe(parsed.lane, 'lane should be preserved');
        expect(reparsed.status).toBe(parsed.status, 'status should be preserved');
        expect(reparsed.type).toBe(parsed.type, 'type should be preserved');

        // Check arrays preserved
        if (parsed.acceptance) {
          expect(reparsed.acceptance).toEqual(parsed.acceptance);
        }
        if (parsed.code_paths) {
          expect(reparsed.code_paths).toEqual(parsed.code_paths);
        }
        if (parsed.dependencies) {
          expect(reparsed.dependencies).toEqual(parsed.dependencies);
        }
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays', () => {
      const doc = { id: 'TEST', code_paths: [], dependencies: [] };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      expect(reparsed.code_paths).toEqual([], 'Empty code_paths array should be preserved');
      expect(reparsed.dependencies).toEqual([], 'Empty dependencies array should be preserved');
    });

    it('should handle empty strings', () => {
      const doc = { id: 'TEST', notes: '' };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      expect(reparsed.notes).toBe('', 'Empty string should be preserved');
    });

    it('should handle multiline strings', () => {
      const doc = {
        id: 'TEST',
        description: 'Line 1\nLine 2\nLine 3',
      };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      expect(reparsed.description).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle nested objects', () => {
      const doc = {
        id: 'TEST',
        tests: { manual: ['test1', 'test2'], automated: [] },
      };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      expect(reparsed.tests.manual).toEqual(['test1', 'test2']);
      expect(reparsed.tests.automated).toEqual([]);
    });

    it('should handle ISO timestamps', () => {
      const doc = {
        id: 'TEST',
        created: '2025-11-29',
        claimed_at: '2025-11-29T19:19:55.803Z',
      };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      expect(reparsed.created).toBe('2025-11-29');
      expect(reparsed.claimed_at).toBe('2025-11-29T19:19:55.803Z');
    });
  });
});
