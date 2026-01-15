/**
 * Memory Schema Tests
 *
 * Tests for memory node schema validation.
 *
 * @module @lumenflow/memory/__tests__/schema
 */

import { describe, it, expect } from 'vitest';
import {
  validateMemoryNode,
  validateRelationship,
  MemoryNodeSchema,
  RelationshipSchema,
  MEMORY_NODE_TYPES,
  MEMORY_LIFECYCLES,
  RELATIONSHIP_TYPES,
  MEMORY_PATTERNS,
} from '../src/schema.js';

describe('Memory Schema', () => {
  describe('MEMORY_PATTERNS', () => {
    it('validates memory ID format', () => {
      expect(MEMORY_PATTERNS.MEMORY_ID.test('mem-abc1')).toBe(true);
      expect(MEMORY_PATTERNS.MEMORY_ID.test('mem-0000')).toBe(true);
      expect(MEMORY_PATTERNS.MEMORY_ID.test('mem-ABC1')).toBe(false);
      expect(MEMORY_PATTERNS.MEMORY_ID.test('invalid')).toBe(false);
    });

    it('validates WU ID format', () => {
      expect(MEMORY_PATTERNS.WU_ID.test('WU-123')).toBe(true);
      expect(MEMORY_PATTERNS.WU_ID.test('WU-1')).toBe(true);
      expect(MEMORY_PATTERNS.WU_ID.test('WU-')).toBe(false);
      expect(MEMORY_PATTERNS.WU_ID.test('wu-123')).toBe(false);
    });
  });

  describe('validateMemoryNode', () => {
    const validNode = {
      id: 'mem-abc1',
      type: 'session',
      lifecycle: 'wu',
      content: 'Test content',
      created_at: '2026-01-15T10:00:00.000Z',
    };

    it('accepts valid memory node', () => {
      const result = validateMemoryNode(validNode);
      expect(result.success).toBe(true);
    });

    it('accepts node with optional fields', () => {
      const nodeWithOptionals = {
        ...validNode,
        wu_id: 'WU-123',
        session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        metadata: { foo: 'bar' },
        tags: ['test', 'example'],
      };
      const result = validateMemoryNode(nodeWithOptionals);
      expect(result.success).toBe(true);
    });

    it('rejects invalid memory ID', () => {
      const result = validateMemoryNode({ ...validNode, id: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid type', () => {
      const result = validateMemoryNode({ ...validNode, type: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid lifecycle', () => {
      const result = validateMemoryNode({ ...validNode, lifecycle: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects empty content', () => {
      const result = validateMemoryNode({ ...validNode, content: '' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid timestamp', () => {
      const result = validateMemoryNode({ ...validNode, created_at: 'not-a-date' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid WU ID format', () => {
      const result = validateMemoryNode({ ...validNode, wu_id: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('validateRelationship', () => {
    const validRelationship = {
      from_id: 'mem-abc1',
      to_id: 'mem-def2',
      type: 'blocks',
    };

    it('accepts valid relationship', () => {
      const result = validateRelationship(validRelationship);
      expect(result.success).toBe(true);
    });

    it('accepts relationship with optional fields', () => {
      const relationshipWithOptionals = {
        ...validRelationship,
        created_at: '2026-01-15T10:00:00.000Z',
        metadata: { priority: 'high' },
      };
      const result = validateRelationship(relationshipWithOptionals);
      expect(result.success).toBe(true);
    });

    it('rejects invalid from_id', () => {
      const result = validateRelationship({ ...validRelationship, from_id: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid to_id', () => {
      const result = validateRelationship({ ...validRelationship, to_id: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid relationship type', () => {
      const result = validateRelationship({ ...validRelationship, type: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('constants', () => {
    it('exports all memory node types', () => {
      expect(MEMORY_NODE_TYPES).toContain('session');
      expect(MEMORY_NODE_TYPES).toContain('discovery');
      expect(MEMORY_NODE_TYPES).toContain('checkpoint');
      expect(MEMORY_NODE_TYPES).toContain('note');
      expect(MEMORY_NODE_TYPES).toContain('summary');
      expect(MEMORY_NODE_TYPES).toHaveLength(5);
    });

    it('exports all memory lifecycles', () => {
      expect(MEMORY_LIFECYCLES).toContain('ephemeral');
      expect(MEMORY_LIFECYCLES).toContain('session');
      expect(MEMORY_LIFECYCLES).toContain('wu');
      expect(MEMORY_LIFECYCLES).toContain('project');
      expect(MEMORY_LIFECYCLES).toHaveLength(4);
    });

    it('exports all relationship types', () => {
      expect(RELATIONSHIP_TYPES).toContain('blocks');
      expect(RELATIONSHIP_TYPES).toContain('parent_child');
      expect(RELATIONSHIP_TYPES).toContain('related');
      expect(RELATIONSHIP_TYPES).toContain('discovered_from');
      expect(RELATIONSHIP_TYPES).toHaveLength(4);
    });
  });
});
