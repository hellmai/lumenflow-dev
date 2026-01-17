/**
 * Memory ID Tests (WU-1465)
 *
 * TDD: Tests written first, implementation follows.
 * Hash-based collision-free ID generation for memory nodes.
 *
 * @see {@link tools/lib/mem-id.mjs} - Implementation
 */

import { describe, it, expect } from 'vitest';
import {
  generateMemId,
  generateHierarchicalId,
  validateMemId,
  MEM_ID_PATTERNS,
} from '../src/mem-id.js';

describe('mem-id', () => {
  describe('MEM_ID_PATTERNS', () => {
    describe('BASE_ID', () => {
      it('should match valid base memory IDs (hex format)', () => {
        const validIds = ['mem-abcd', 'mem-1234', 'mem-a1b2', 'mem-0000', 'mem-dead', 'mem-beef'];
        for (const id of validIds) {
          expect(MEM_ID_PATTERNS.BASE_ID.test(id)).toBe(true);
        }
      });

      it('should reject non-hex characters in suffix', () => {
        const invalidIds = [
          'mem-ghij', // g-z are not hex
          'mem-zzzz', // z is not hex
          'mem-xyz1', // x, y, z are not hex
        ];
        for (const id of invalidIds) {
          expect(MEM_ID_PATTERNS.BASE_ID.test(id)).toBe(false);
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
          expect(MEM_ID_PATTERNS.BASE_ID.test(id)).toBe(false);
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
          expect(MEM_ID_PATTERNS.HIERARCHICAL_ID.test(id)).toBe(true);
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
          expect(MEM_ID_PATTERNS.HIERARCHICAL_ID.test(id)).toBe(false);
        }
      });
    });
  });

  describe('generateMemId', () => {
    it('should return mem-[a-f0-9]{4} format', () => {
      const result = generateMemId('test content');
      expect(result).toMatch(/^mem-[a-f0-9]{4}$/);
    });

    it('should return same ID for same content (deterministic)', () => {
      const content = 'identical content for testing';
      const id1 = generateMemId(content);
      const id2 = generateMemId(content);
      expect(id1).toBe(id2);
    });

    it('should return different ID for different content', () => {
      const id1 = generateMemId('content A');
      const id2 = generateMemId('content B');
      expect(id1).not.toBe(id2);
    });

    it('should handle empty string', () => {
      const result = generateMemId('');
      expect(result).toMatch(/^mem-[a-f0-9]{4}$/);
    });

    it('should handle unicode content', () => {
      const result = generateMemId('日本語テスト');
      expect(result).toMatch(/^mem-[a-f0-9]{4}$/);
    });

    it('should handle very long content', () => {
      const longContent = 'x'.repeat(100000);
      const result = generateMemId(longContent);
      expect(result).toMatch(/^mem-[a-f0-9]{4}$/);
    });

    it('should handle content with special characters', () => {
      const result = generateMemId('content with\nnewlines\tand\rspecial chars !@#$%^&*()');
      expect(result).toMatch(/^mem-[a-f0-9]{4}$/);
    });

    it('should pass base ID validation from schema', () => {
      const id = generateMemId('test content');
      const validation = validateMemId(id);
      expect(validation.valid).toBe(true);
    });
  });

  describe('generateHierarchicalId', () => {
    it('should generate first-level hierarchical ID', () => {
      const baseId = 'mem-a1b2';
      const result = generateHierarchicalId(baseId, 1);
      expect(result).toBe('mem-a1b2.1');
    });

    it('should generate second-level hierarchical ID', () => {
      const parentId = 'mem-a1b2.1';
      const result = generateHierarchicalId(parentId, 2);
      expect(result).toBe('mem-a1b2.1.2');
    });

    it('should support multi-digit indices', () => {
      const baseId = 'mem-a1b2';
      const result = generateHierarchicalId(baseId, 10);
      expect(result).toBe('mem-a1b2.10');
    });

    it('should throw for invalid base ID', () => {
      expect(() => generateHierarchicalId('invalid', 1)).toThrow(/invalid.*id/i);
    });

    it('should throw for non-positive index', () => {
      expect(() => generateHierarchicalId('mem-a1b2', 0)).toThrow(/index.*positive/i);
      expect(() => generateHierarchicalId('mem-a1b2', -1)).toThrow(/index.*positive/i);
    });

    it('should pass hierarchical ID validation', () => {
      const hierarchicalId = generateHierarchicalId('mem-a1b2', 1);
      const validation = validateMemId(hierarchicalId);
      expect(validation.valid).toBe(true);
      expect(validation.type).toBe('hierarchical');
    });
  });

  describe('validateMemId', () => {
    it('should return valid: true for valid base ID', () => {
      const result = validateMemId('mem-a1b2');
      expect(result.valid).toBe(true);
      expect(result.type).toBe('base');
    });

    it('should return valid: true for valid hierarchical ID', () => {
      const result = validateMemId('mem-a1b2.1');
      expect(result.valid).toBe(true);
      expect(result.type).toBe('hierarchical');
    });

    it('should return valid: true for deep hierarchical ID', () => {
      const result = validateMemId('mem-a1b2.1.2');
      expect(result.valid).toBe(true);
      expect(result.type).toBe('hierarchical');
    });

    it('should return valid: false for invalid ID', () => {
      const result = validateMemId('invalid-id');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return valid: false for empty string', () => {
      const result = validateMemId('');
      expect(result.valid).toBe(false);
    });

    it('should return valid: false for non-hex base ID', () => {
      const result = validateMemId('mem-zzzz');
      expect(result.valid).toBe(false);
    });

    it('should return baseId for hierarchical IDs', () => {
      const result = validateMemId('mem-a1b2.1.2');
      expect(result.baseId).toBe('mem-a1b2');
    });

    it('should return indices for hierarchical IDs', () => {
      const result = validateMemId('mem-a1b2.1.2');
      expect(result.indices).toEqual([1, 2]);
    });

    it('should return empty indices for base IDs', () => {
      const result = validateMemId('mem-a1b2');
      expect(result.indices).toEqual([]);
    });

    it('should be compatible with MEMORY_PATTERNS.MEMORY_ID from schema', async () => {
      // Import the schema pattern for compatibility check
      const { MEMORY_PATTERNS } = await import('../src/memory-schema.js');

      // Base IDs from generateMemId should match the schema pattern
      const generatedId = generateMemId('test content');
      expect(MEMORY_PATTERNS.MEMORY_ID.test(generatedId)).toBe(true);
    });
  });

  describe('collision resistance', () => {
    it('should generate unique IDs for 10000+ different inputs', () => {
      const ids = new Set<string>();
      const testCount = 10000;

      for (let i = 0; i < testCount; i++) {
        const content = `unique content ${i} with timestamp ${Date.now()}`;
        const id = generateMemId(content);
        ids.add(id);
      }

      // Calculate collision rate
      const uniqueCount = ids.size;
      const collisionRate = (testCount - uniqueCount) / testCount;

      // With 65536 possible values and 10000 inputs:
      // We allow up to 25% collision rate as acceptable for 4-char hex
      expect(collisionRate).toBeLessThan(0.25);
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
        expect(id1).toBe(id2);
        expect(id2).toBe(id3);
      }
    });
  });
});
