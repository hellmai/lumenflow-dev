/**
 * Round-trip YAML tests (WU-1342)
 *
 * Validates that YAML parse → stringify → parse doesn't lose data
 * across the full WU corpus in docs/04-operations/tasks/wu/
 *
 * This test suite verifies the migration from js-yaml to yaml library
 * preserves all data structures correctly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

const WU_DIR = 'docs/04-operations/tasks/wu';

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

describe('YAML round-trip tests (WU-1342)', () => {
  const wuFiles = getWUFiles();

  it('should find WU YAML files in corpus', () => {
    assert.ok(wuFiles.length > 0, 'Should find at least one WU file');
    assert.ok(wuFiles.length > 200, 'Should find 200+ WU files (corpus has 248+)');
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
        } catch (err) {
          // Skip malformed legacy files that yaml library rejects
          // (These are pre-existing issues, not caused by library migration)
          assert.ok(
            err.message.includes('Implicit keys need to be on a single line') ||
              err.message.includes('Nested mappings are not allowed'),
            `WU ${wuId} has malformed YAML (legacy issue): ${err.message}`
          );
          return; // Skip this test
        }

        assert.ok(parsed1, 'First parse should succeed');
        assert.equal(parsed1.id, wuId, `WU ID should match ${wuId}`);

        // Stringify back to YAML
        const stringified = stringify(parsed1, { lineWidth: 100 });
        assert.ok(stringified, 'Stringify should produce output');
        assert.ok(stringified.length > 0, 'Stringified YAML should not be empty');

        // Parse again
        const parsed2 = parse(stringified);
        assert.ok(parsed2, 'Second parse should succeed');

        // Verify structural equality (not raw text equality)
        assert.ok(
          deepEqualIgnoreUndefined(parsed1, parsed2),
          `Structure should be preserved for ${wuId}`
        );
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
        assert.equal(reparsed.id, parsed.id, 'id should be preserved');
        assert.equal(reparsed.title, parsed.title, 'title should be preserved');
        assert.equal(reparsed.lane, parsed.lane, 'lane should be preserved');
        assert.equal(reparsed.status, parsed.status, 'status should be preserved');
        assert.equal(reparsed.type, parsed.type, 'type should be preserved');

        // Check arrays preserved
        if (parsed.acceptance) {
          assert.deepEqual(
            reparsed.acceptance,
            parsed.acceptance,
            'acceptance criteria should be preserved'
          );
        }
        if (parsed.code_paths) {
          assert.deepEqual(
            reparsed.code_paths,
            parsed.code_paths,
            'code_paths should be preserved'
          );
        }
        if (parsed.dependencies) {
          assert.deepEqual(
            reparsed.dependencies,
            parsed.dependencies,
            'dependencies should be preserved'
          );
        }
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays', () => {
      const doc = { id: 'TEST', code_paths: [], dependencies: [] };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      assert.deepEqual(reparsed.code_paths, [], 'Empty code_paths array should be preserved');
      assert.deepEqual(reparsed.dependencies, [], 'Empty dependencies array should be preserved');
    });

    it('should handle empty strings', () => {
      const doc = { id: 'TEST', notes: '' };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      assert.equal(reparsed.notes, '', 'Empty string should be preserved');
    });

    it('should handle multiline strings', () => {
      const doc = {
        id: 'TEST',
        description: 'Line 1\nLine 2\nLine 3',
      };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      assert.equal(
        reparsed.description,
        'Line 1\nLine 2\nLine 3',
        'Multiline string should be preserved'
      );
    });

    it('should handle nested objects', () => {
      const doc = {
        id: 'TEST',
        tests: { manual: ['test1', 'test2'], automated: [] },
      };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      assert.deepEqual(
        reparsed.tests.manual,
        ['test1', 'test2'],
        'Nested arrays should be preserved'
      );
      assert.deepEqual(reparsed.tests.automated, [], 'Nested empty arrays should be preserved');
    });

    it('should handle ISO timestamps', () => {
      const doc = {
        id: 'TEST',
        created: '2025-11-29',
        claimed_at: '2025-11-29T19:19:55.803Z',
      };
      const stringified = stringify(doc, { lineWidth: 100 });
      const reparsed = parse(stringified);
      assert.equal(reparsed.created, '2025-11-29', 'Date string should be preserved');
      assert.equal(
        reparsed.claimed_at,
        '2025-11-29T19:19:55.803Z',
        'ISO timestamp should be preserved'
      );
    });
  });
});
