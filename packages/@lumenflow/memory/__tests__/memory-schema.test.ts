/**
 * Memory Schema Tests (WU-1462)
 *
 * TDD: Tests written first, implementation follows.
 * Foundation for the entire memory layer.
 *
 * @see {@link tools/lib/memory-schema.mjs} - Implementation
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryNodeSchema,
  RelationshipSchema,
  validateMemoryNode,
  validateRelationship,
  MEMORY_NODE_TYPES,
  MEMORY_LIFECYCLES,
  RELATIONSHIP_TYPES,
  MEMORY_PATTERNS,
} from '../src/memory-schema.js';

describe('memory-schema', () => {
  describe('constants exports', () => {
    it('should export MEMORY_NODE_TYPES with 5 types', () => {
      expect(Array.isArray(MEMORY_NODE_TYPES)).toBe(true);
      expect(MEMORY_NODE_TYPES.length).toBe(5);
      expect(MEMORY_NODE_TYPES).toContain('session');
      expect(MEMORY_NODE_TYPES).toContain('discovery');
      expect(MEMORY_NODE_TYPES).toContain('checkpoint');
      expect(MEMORY_NODE_TYPES).toContain('note');
      expect(MEMORY_NODE_TYPES).toContain('summary');
    });

    it('should export MEMORY_LIFECYCLES with 4 values', () => {
      expect(Array.isArray(MEMORY_LIFECYCLES)).toBe(true);
      expect(MEMORY_LIFECYCLES.length).toBe(4);
      expect(MEMORY_LIFECYCLES).toContain('ephemeral');
      expect(MEMORY_LIFECYCLES).toContain('session');
      expect(MEMORY_LIFECYCLES).toContain('wu');
      expect(MEMORY_LIFECYCLES).toContain('project');
    });

    it('should export RELATIONSHIP_TYPES with 4 types', () => {
      expect(Array.isArray(RELATIONSHIP_TYPES)).toBe(true);
      expect(RELATIONSHIP_TYPES.length).toBe(4);
      expect(RELATIONSHIP_TYPES).toContain('blocks');
      expect(RELATIONSHIP_TYPES).toContain('parent_child');
      expect(RELATIONSHIP_TYPES).toContain('related');
      expect(RELATIONSHIP_TYPES).toContain('discovered_from');
    });

    it('should export MEMORY_PATTERNS with ID pattern', () => {
      expect(MEMORY_PATTERNS.MEMORY_ID).toBeDefined();
      expect(MEMORY_PATTERNS.MEMORY_ID instanceof RegExp).toBe(true);
    });
  });

  describe('MEMORY_PATTERNS.MEMORY_ID', () => {
    it('should match valid memory IDs', () => {
      const validIds = ['mem-abcd', 'mem-1234', 'mem-a1b2', 'mem-0000', 'mem-zzzz'];
      for (const id of validIds) {
        expect(MEMORY_PATTERNS.MEMORY_ID.test(id)).toBe(true);
      }
    });

    it('should reject invalid memory IDs', () => {
      const invalidIds = [
        'mem-ABC', // uppercase
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
        expect(MEMORY_PATTERNS.MEMORY_ID.test(id)).toBe(false);
      }
    });
  });

  describe('MemoryNodeSchema', () => {
    const validNode = {
      id: 'mem-abc1',
      type: 'discovery',
      lifecycle: 'session',
      content: 'Found relevant file at src/utils.js',
      created_at: '2025-12-08T10:30:00Z',
    };

    it('should validate a minimal valid memory node', () => {
      const result = MemoryNodeSchema.safeParse(validNode);
      expect(result.success).toBe(true);
    });

    it('should validate a complete memory node with all optional fields', () => {
      const complete = {
        ...validNode,
        updated_at: '2025-12-08T11:00:00Z',
        wu_id: 'WU-1462',
        session_id: '550e8400-e29b-41d4-a716-446655440000',
        metadata: { source: 'grep', confidence: 0.9 },
        tags: ['architecture', 'important'],
      };
      const result = MemoryNodeSchema.safeParse(complete);
      expect(result.success).toBe(true);
    });

    describe('id validation', () => {
      it('should reject invalid ID format', () => {
        const invalid = { ...validNode, id: 'invalid-id' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        expect(result.error!.issues[0].message).toContain('mem-');
      });

      it('should reject uppercase in ID suffix', () => {
        const invalid = { ...validNode, id: 'mem-ABCD' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject ID with wrong length suffix', () => {
        const invalid = { ...validNode, id: 'mem-ab' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('type validation', () => {
      it('should accept all 5 valid node types', () => {
        const types = ['session', 'discovery', 'checkpoint', 'note', 'summary'];
        for (const type of types) {
          const node = { ...validNode, type };
          const result = MemoryNodeSchema.safeParse(node);
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid node type', () => {
        const invalid = { ...validNode, type: 'invalid_type' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('lifecycle validation', () => {
      it('should accept all 4 valid lifecycle values', () => {
        const lifecycles = ['ephemeral', 'session', 'wu', 'project'];
        for (const lifecycle of lifecycles) {
          const node = { ...validNode, lifecycle };
          const result = MemoryNodeSchema.safeParse(node);
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid lifecycle value', () => {
        const invalid = { ...validNode, lifecycle: 'permanent' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should require lifecycle field', () => {
        const { lifecycle: _unused, ...withoutLifecycle } = validNode;
        void _unused;
        const result = MemoryNodeSchema.safeParse(withoutLifecycle);
        expect(result.success).toBe(false);
      });
    });

    describe('content validation', () => {
      it('should require non-empty content', () => {
        const invalid = { ...validNode, content: '' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should require content field', () => {
        const { content: _unused, ...withoutContent } = validNode;
        void _unused;
        const result = MemoryNodeSchema.safeParse(withoutContent);
        expect(result.success).toBe(false);
      });
    });

    describe('timestamp validation', () => {
      it('should require created_at field', () => {
        const { created_at: _unused, ...withoutCreated } = validNode;
        void _unused;
        const result = MemoryNodeSchema.safeParse(withoutCreated);
        expect(result.success).toBe(false);
      });

      it('should accept ISO datetime format', () => {
        const node = { ...validNode, created_at: '2025-12-08T10:30:00.000Z' };
        const result = MemoryNodeSchema.safeParse(node);
        expect(result.success).toBe(true);
      });

      it('should reject invalid datetime format', () => {
        const invalid = { ...validNode, created_at: 'not-a-date' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('optional fields', () => {
      it('should allow missing updated_at', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        expect(result.success).toBe(true);
      });

      it('should allow missing wu_id', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        expect(result.success).toBe(true);
      });

      it('should allow missing session_id', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        expect(result.success).toBe(true);
      });

      it('should allow missing metadata', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        expect(result.success).toBe(true);
      });

      it('should allow missing tags', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        expect(result.success).toBe(true);
      });

      it('should validate wu_id format when present', () => {
        const withWuId = { ...validNode, wu_id: 'WU-1462' };
        const result = MemoryNodeSchema.safeParse(withWuId);
        expect(result.success).toBe(true);
      });

      it('should reject invalid wu_id format', () => {
        const invalid = { ...validNode, wu_id: 'INVALID-123' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should validate session_id as UUID when present', () => {
        const withSessionId = {
          ...validNode,
          session_id: '550e8400-e29b-41d4-a716-446655440000',
        };
        const result = MemoryNodeSchema.safeParse(withSessionId);
        expect(result.success).toBe(true);
      });

      it('should reject invalid session_id format', () => {
        const invalid = { ...validNode, session_id: 'not-a-uuid' };
        const result = MemoryNodeSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('RelationshipSchema', () => {
    const validRelationship = {
      from_id: 'mem-abc1',
      to_id: 'mem-def2',
      type: 'related',
    };

    it('should validate a minimal valid relationship', () => {
      const result = RelationshipSchema.safeParse(validRelationship);
      expect(result.success).toBe(true);
    });

    it('should validate a complete relationship with all optional fields', () => {
      const complete = {
        ...validRelationship,
        created_at: '2025-12-08T10:30:00Z',
        metadata: { strength: 0.8 },
      };
      const result = RelationshipSchema.safeParse(complete);
      expect(result.success).toBe(true);
    });

    describe('type validation', () => {
      it('should accept all 4 valid relationship types', () => {
        const types = ['blocks', 'parent_child', 'related', 'discovered_from'];
        for (const type of types) {
          const rel = { ...validRelationship, type };
          const result = RelationshipSchema.safeParse(rel);
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid relationship type', () => {
        const invalid = { ...validRelationship, type: 'invalid' };
        const result = RelationshipSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('ID validation', () => {
      it('should validate from_id format', () => {
        const invalid = { ...validRelationship, from_id: 'invalid' };
        const result = RelationshipSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should validate to_id format', () => {
        const invalid = { ...validRelationship, to_id: 'invalid' };
        const result = RelationshipSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should require from_id', () => {
        const { from_id: _unused, ...withoutFromId } = validRelationship;
        void _unused;
        const result = RelationshipSchema.safeParse(withoutFromId);
        expect(result.success).toBe(false);
      });

      it('should require to_id', () => {
        const { to_id: _unused, ...withoutToId } = validRelationship;
        void _unused;
        const result = RelationshipSchema.safeParse(withoutToId);
        expect(result.success).toBe(false);
      });
    });

    describe('optional fields', () => {
      it('should allow missing created_at', () => {
        const result = RelationshipSchema.safeParse(validRelationship);
        expect(result.success).toBe(true);
      });

      it('should allow missing metadata', () => {
        const result = RelationshipSchema.safeParse(validRelationship);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('validateMemoryNode', () => {
    it('should return success for valid memory node', () => {
      const valid = {
        id: 'mem-test',
        type: 'note',
        lifecycle: 'wu',
        content: 'Test note content',
        created_at: '2025-12-08T10:30:00Z',
      };
      const result = validateMemoryNode(valid);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid memory node', () => {
      const invalid = {
        id: 'invalid',
        type: 'invalid',
        lifecycle: 'invalid',
        content: '',
        created_at: 'not-a-date',
      };
      const result = validateMemoryNode(invalid);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.issues.length).toBeGreaterThan(0);
    });
  });

  describe('validateRelationship', () => {
    it('should return success for valid relationship', () => {
      const valid = {
        from_id: 'mem-abc1',
        to_id: 'mem-def2',
        type: 'blocks',
      };
      const result = validateRelationship(valid);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid relationship', () => {
      const invalid = {
        from_id: 'invalid',
        to_id: 'invalid',
        type: 'invalid',
      };
      const result = validateRelationship(invalid);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.issues.length).toBeGreaterThan(0);
    });
  });
});
