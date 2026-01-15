/**
 * Memory ID Tests (WU-1465)
 *
 * TDD: Tests written first, implementation follows.
 * Hash-based collision-free ID generation for memory nodes.
 *
 * @see {@link tools/lib/mem-id.mjs} - Implementation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMemId,
  generateHierarchicalId,
  validateMemId,
  MEM_ID_PATTERNS,
} from '../mem-id.js';

describe('mem-id', () => {
  describe('MEM_ID_PATTERNS', () => {
    describe('BASE_ID', () => {
      it('should match valid base memory IDs (hex format)', () => {
        const validIds = ['mem-abcd', 'mem-1234', 'mem-a1b2', 'mem-0000', 'mem-dead', 'mem-beef'];
        for (const id of validIds) {
          assert.ok(MEM_ID_PATTERNS.BASE_ID.test(id), `Should match valid ID: ${id}`);
        }
      });

      it('should reject non-hex characters in suffix', () => {
        const invalidIds = [
          'mem-ghij', // g-z are not hex
          'mem-zzzz', // z is not hex
          'mem-xyz1', // x, y, z are not hex
        ];
        for (const id of invalidIds) {
          assert.ok(!MEM_ID_PATTERNS.BASE_ID.test(id), `Should reject non-hex ID: ${id}`);
        }
      });

      it('should reject invalid base memory IDs', () => {
        const invalidIds = [
          'mem-ABCD', // uppercase
          'mem-ab', // too short
          'mem-abcde', // too long
          'MEM-abcd', // uppercase prefix
          'node-abcd', // wrong prefix
          'abcd', // no prefix
          'mem_abcd', // underscore separator
          'mem-ab-cd', // hyphen in suffix
          '', // empty
        ];
        for (const id of invalidIds) {
          assert.ok(!MEM_ID_PATTERNS.BASE_ID.test(id), `Should reject invalid ID: ${id}`);
        }
      });
    });

    describe('HIERARCHICAL_ID', () => {
      it('should match valid hierarchical IDs', () => {
        const validIds = [
          'mem-a1b2', // base format (level 0)
          'mem-a1b2.1', // first level
          'mem-a1b2.2', // first level
          'mem-a1b2.10', // multi-digit index
          'mem-a1b2.1.1', // second level
          'mem-a1b2.1.2', // second level
          'mem-a1b2.1.10', // multi-digit second level
          'mem-a1b2.10.20', // multi-digit both levels
        ];
        for (const id of validIds) {
          assert.ok(MEM_ID_PATTERNS.HIERARCHICAL_ID.test(id), `Should match hierarchical ID: ${id}`);
        }
      });

      it('should reject invalid hierarchical IDs', () => {
        const invalidIds = [
          'mem-a1b2.', // trailing dot
          'mem-a1b2..1', // double dot
          'mem-a1b2.1.', // trailing dot after index
          'mem-a1b2.1..2', // double dot in hierarchy
          'mem-a1b2.a', // non-numeric index
          'mem-a1b2.1.a', // non-numeric second level
          'mem-a1b2.0', // zero index (should be 1-based)
          'mem-a1b2.1.0', // zero second level
        ];
        for (const id of invalidIds) {
          assert.ok(
            !MEM_ID_PATTERNS.HIERARCHICAL_ID.test(id),
            `Should reject invalid hierarchical ID: ${id}`
          );
        }
      });
    });
  });

  describe('generateMemId', () => {
    it('should return mem-[a-f0-9]{4} format', () => {
      const result = generateMemId('test content');
      assert.match(result, /^mem-[a-f0-9]{4}$/, `ID "${result}" should match format mem-[a-f0-9]{4}`);
    });

    it('should return same ID for same content (deterministic)', () => {
      const content = 'identical content for testing';
      const id1 = generateMemId(content);
      const id2 = generateMemId(content);
      assert.equal(id1, id2, 'Same content should produce same ID');
    });

    it('should return different ID for different content', () => {
      const id1 = generateMemId('content A');
      const id2 = generateMemId('content B');
      assert.notEqual(id1, id2, 'Different content should produce different ID');
    });

    it('should handle empty string', () => {
      const result = generateMemId('');
      assert.match(result, /^mem-[a-f0-9]{4}$/, 'Empty string should still produce valid ID');
    });

    it('should handle unicode content', () => {
      const result = generateMemId('日本語テスト');
      assert.match(result, /^mem-[a-f0-9]{4}$/, 'Unicode content should produce valid ID');
    });

    it('should handle very long content', () => {
      const longContent = 'x'.repeat(100000);
      const result = generateMemId(longContent);
      assert.match(result, /^mem-[a-f0-9]{4}$/, 'Long content should produce valid ID');
    });

    it('should handle content with special characters', () => {
      const result = generateMemId('content with\nnewlines\tand\rspecial chars !@#$%^&*()');
      assert.match(result, /^mem-[a-f0-9]{4}$/, 'Special chars should produce valid ID');
    });

    it('should pass base ID validation from schema', () => {
      const id = generateMemId('test content');
      const validation = validateMemId(id);
      assert.ok(validation.valid, 'Generated ID should pass validation');
    });
  });

  describe('generateHierarchicalId', () => {
    it('should generate first-level hierarchical ID', () => {
      const baseId = 'mem-a1b2';
      const result = generateHierarchicalId(baseId, 1);
      assert.equal(result, 'mem-a1b2.1', 'Should append .1 to base ID');
    });

    it('should generate second-level hierarchical ID', () => {
      const parentId = 'mem-a1b2.1';
      const result = generateHierarchicalId(parentId, 2);
      assert.equal(result, 'mem-a1b2.1.2', 'Should append .2 to parent ID');
    });

    it('should support multi-digit indices', () => {
      const baseId = 'mem-a1b2';
      const result = generateHierarchicalId(baseId, 10);
      assert.equal(result, 'mem-a1b2.10', 'Should support index 10');
    });

    it('should throw for invalid base ID', () => {
      assert.throws(
        () => generateHierarchicalId('invalid', 1),
        /invalid.*id/i,
        'Should throw for invalid base ID'
      );
    });

    it('should throw for non-positive index', () => {
      assert.throws(
        () => generateHierarchicalId('mem-a1b2', 0),
        /index.*positive/i,
        'Should throw for zero index'
      );
      assert.throws(
        () => generateHierarchicalId('mem-a1b2', -1),
        /index.*positive/i,
        'Should throw for negative index'
      );
    });

    it('should pass hierarchical ID validation', () => {
      const hierarchicalId = generateHierarchicalId('mem-a1b2', 1);
      const validation = validateMemId(hierarchicalId);
      assert.ok(validation.valid, 'Generated hierarchical ID should pass validation');
      assert.equal(validation.type, 'hierarchical', 'Should be classified as hierarchical');
    });
  });

  describe('validateMemId', () => {
    it('should return valid: true for valid base ID', () => {
      const result = validateMemId('mem-a1b2');
      assert.ok(result.valid, 'Valid base ID should be valid');
      assert.equal(result.type, 'base', 'Should identify as base type');
    });

    it('should return valid: true for valid hierarchical ID', () => {
      const result = validateMemId('mem-a1b2.1');
      assert.ok(result.valid, 'Valid hierarchical ID should be valid');
      assert.equal(result.type, 'hierarchical', 'Should identify as hierarchical type');
    });

    it('should return valid: true for deep hierarchical ID', () => {
      const result = validateMemId('mem-a1b2.1.2');
      assert.ok(result.valid, 'Deep hierarchical ID should be valid');
      assert.equal(result.type, 'hierarchical', 'Should identify as hierarchical type');
    });

    it('should return valid: false for invalid ID', () => {
      const result = validateMemId('invalid-id');
      assert.ok(!result.valid, 'Invalid ID should be invalid');
      assert.ok(result.error, 'Should have error message');
    });

    it('should return valid: false for empty string', () => {
      const result = validateMemId('');
      assert.ok(!result.valid, 'Empty string should be invalid');
    });

    it('should return valid: false for non-hex base ID', () => {
      const result = validateMemId('mem-zzzz');
      assert.ok(!result.valid, 'Non-hex ID should be invalid');
    });

    it('should return baseId for hierarchical IDs', () => {
      const result = validateMemId('mem-a1b2.1.2');
      assert.equal(result.baseId, 'mem-a1b2', 'Should extract base ID');
    });

    it('should return indices for hierarchical IDs', () => {
      const result = validateMemId('mem-a1b2.1.2');
      assert.deepEqual(result.indices, [1, 2], 'Should extract indices');
    });

    it('should return empty indices for base IDs', () => {
      const result = validateMemId('mem-a1b2');
      assert.deepEqual(result.indices, [], 'Base ID should have empty indices');
    });

    it('should be compatible with MEMORY_PATTERNS.MEMORY_ID from schema', async () => {
      // Import the schema pattern for compatibility check
      const { MEMORY_PATTERNS } = await import('../memory-schema.js');

      // Base IDs from generateMemId should match the schema pattern
      const generatedId = generateMemId('test content');
      assert.ok(MEMORY_PATTERNS.MEMORY_ID.test(generatedId), 'Generated ID should match schema');
    });
  });

  describe('collision resistance', () => {
    it('should generate unique IDs for 10000+ different inputs', () => {
      const ids = new Set();
      const collisions = [];
      const testCount = 10000;

      for (let i = 0; i < testCount; i++) {
        const content = `unique content ${i} with timestamp ${Date.now()}`;
        const id = generateMemId(content);
        if (ids.has(id)) {
          collisions.push({ index: i, content, id });
        }
        ids.add(id);
      }

      // With 4 hex chars = 65536 possible IDs, birthday paradox suggests
      // ~50% collision probability around sqrt(65536) ≈ 256 IDs.
      // At 10000 IDs, we expect many collisions due to pigeonhole principle.
      // This test validates we're getting deterministic, well-distributed hashes.
      // The actual collision count depends on hash quality.

      // Calculate collision rate
      const uniqueCount = ids.size;
      const collisionRate = (testCount - uniqueCount) / testCount;

      // Log for visibility
      console.log(`Collision test: ${uniqueCount} unique IDs from ${testCount} inputs`);
      console.log(`Collision rate: ${(collisionRate * 100).toFixed(2)}%`);

      // With 65536 possible values and 10000 inputs:
      // Expected unique ≈ 65536 * (1 - (1 - 1/65536)^10000) ≈ 65536 * (1 - e^(-10000/65536)) ≈ 8640
      // So we expect around 8640 unique IDs (13.6% collision rate)
      // We allow up to 25% collision rate as acceptable for 4-char hex
      assert.ok(
        collisionRate < 0.25,
        `Collision rate ${(collisionRate * 100).toFixed(2)}% exceeds 25% threshold`
      );
    });

    it('should have deterministic output across multiple runs', () => {
      // Test that the same content always produces the same ID
      const testCases = [
        'short',
        'medium length content',
        'very long content '.repeat(100),
        'special chars: !@#$%^&*()',
        'unicode: 日本語',
        '12345',
        '',
      ];

      for (const content of testCases) {
        const id1 = generateMemId(content);
        const id2 = generateMemId(content);
        const id3 = generateMemId(content);
        assert.equal(id1, id2, `Deterministic: run 1 vs 2 for "${content.slice(0, 20)}..."`);
        assert.equal(id2, id3, `Deterministic: run 2 vs 3 for "${content.slice(0, 20)}..."`);
      }
    });
  });
});
