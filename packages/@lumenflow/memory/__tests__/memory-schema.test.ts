/**
 * Memory Schema Tests (WU-1462)
 *
 * TDD: Tests written first, implementation follows.
 * Foundation for the entire memory layer.
 *
 * @see {@link tools/lib/memory-schema.mjs} - Implementation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
      assert.ok(Array.isArray(MEMORY_NODE_TYPES), 'MEMORY_NODE_TYPES should be an array');
      assert.equal(MEMORY_NODE_TYPES.length, 5, 'Should have exactly 5 node types');
      assert.ok(MEMORY_NODE_TYPES.includes('session'), 'Should include session type');
      assert.ok(MEMORY_NODE_TYPES.includes('discovery'), 'Should include discovery type');
      assert.ok(MEMORY_NODE_TYPES.includes('checkpoint'), 'Should include checkpoint type');
      assert.ok(MEMORY_NODE_TYPES.includes('note'), 'Should include note type');
      assert.ok(MEMORY_NODE_TYPES.includes('summary'), 'Should include summary type');
    });

    it('should export MEMORY_LIFECYCLES with 4 values', () => {
      assert.ok(Array.isArray(MEMORY_LIFECYCLES), 'MEMORY_LIFECYCLES should be an array');
      assert.equal(MEMORY_LIFECYCLES.length, 4, 'Should have exactly 4 lifecycle values');
      assert.ok(MEMORY_LIFECYCLES.includes('ephemeral'), 'Should include ephemeral');
      assert.ok(MEMORY_LIFECYCLES.includes('session'), 'Should include session');
      assert.ok(MEMORY_LIFECYCLES.includes('wu'), 'Should include wu');
      assert.ok(MEMORY_LIFECYCLES.includes('project'), 'Should include project');
    });

    it('should export RELATIONSHIP_TYPES with 4 types', () => {
      assert.ok(Array.isArray(RELATIONSHIP_TYPES), 'RELATIONSHIP_TYPES should be an array');
      assert.equal(RELATIONSHIP_TYPES.length, 4, 'Should have exactly 4 relationship types');
      assert.ok(RELATIONSHIP_TYPES.includes('blocks'), 'Should include blocks');
      assert.ok(RELATIONSHIP_TYPES.includes('parent_child'), 'Should include parent_child');
      assert.ok(RELATIONSHIP_TYPES.includes('related'), 'Should include related');
      assert.ok(RELATIONSHIP_TYPES.includes('discovered_from'), 'Should include discovered_from');
    });

    it('should export MEMORY_PATTERNS with ID pattern', () => {
      assert.ok(MEMORY_PATTERNS.MEMORY_ID, 'Should export MEMORY_ID pattern');
      assert.ok(MEMORY_PATTERNS.MEMORY_ID instanceof RegExp, 'MEMORY_ID should be a RegExp');
    });
  });

  describe('MEMORY_PATTERNS.MEMORY_ID', () => {
    it('should match valid memory IDs', () => {
      const validIds = ['mem-abcd', 'mem-1234', 'mem-a1b2', 'mem-0000', 'mem-zzzz'];
      for (const id of validIds) {
        assert.ok(MEMORY_PATTERNS.MEMORY_ID.test(id), `Should match valid ID: ${id}`);
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
        assert.ok(!MEMORY_PATTERNS.MEMORY_ID.test(id), `Should reject invalid ID: ${id}`);
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
      assert.ok(result.success, 'Valid node should parse');
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
      assert.ok(result.success, 'Complete node should parse');
    });

    describe('id validation', () => {
      it('should reject invalid ID format', () => {
        const invalid = { ...validNode, id: 'invalid-id' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid ID format should fail');
        assert.ok(
          result.error.issues[0].message.includes('mem-'),
          'Error should mention expected format'
        );
      });

      it('should reject uppercase in ID suffix', () => {
        const invalid = { ...validNode, id: 'mem-ABCD' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Uppercase ID should fail');
      });

      it('should reject ID with wrong length suffix', () => {
        const invalid = { ...validNode, id: 'mem-ab' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Short ID should fail');
      });
    });

    describe('type validation', () => {
      it('should accept all 5 valid node types', () => {
        const types = ['session', 'discovery', 'checkpoint', 'note', 'summary'];
        for (const type of types) {
          const node = { ...validNode, type };
          const result = MemoryNodeSchema.safeParse(node);
          assert.ok(result.success, `Type '${type}' should be valid`);
        }
      });

      it('should reject invalid node type', () => {
        const invalid = { ...validNode, type: 'invalid_type' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid type should fail');
      });
    });

    describe('lifecycle validation', () => {
      it('should accept all 4 valid lifecycle values', () => {
        const lifecycles = ['ephemeral', 'session', 'wu', 'project'];
        for (const lifecycle of lifecycles) {
          const node = { ...validNode, lifecycle };
          const result = MemoryNodeSchema.safeParse(node);
          assert.ok(result.success, `Lifecycle '${lifecycle}' should be valid`);
        }
      });

      it('should reject invalid lifecycle value', () => {
        const invalid = { ...validNode, lifecycle: 'permanent' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid lifecycle should fail');
      });

      it('should require lifecycle field', () => {
        const { lifecycle: _unused, ...withoutLifecycle } = validNode;
        void _unused;
        const result = MemoryNodeSchema.safeParse(withoutLifecycle);
        assert.ok(!result.success, 'Missing lifecycle should fail');
      });
    });

    describe('content validation', () => {
      it('should require non-empty content', () => {
        const invalid = { ...validNode, content: '' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Empty content should fail');
      });

      it('should require content field', () => {
        const { content: _unused, ...withoutContent } = validNode;
        void _unused;
        const result = MemoryNodeSchema.safeParse(withoutContent);
        assert.ok(!result.success, 'Missing content should fail');
      });
    });

    describe('timestamp validation', () => {
      it('should require created_at field', () => {
        const { created_at: _unused, ...withoutCreated } = validNode;
        void _unused;
        const result = MemoryNodeSchema.safeParse(withoutCreated);
        assert.ok(!result.success, 'Missing created_at should fail');
      });

      it('should accept ISO datetime format', () => {
        const node = { ...validNode, created_at: '2025-12-08T10:30:00.000Z' };
        const result = MemoryNodeSchema.safeParse(node);
        assert.ok(result.success, 'ISO datetime should be valid');
      });

      it('should reject invalid datetime format', () => {
        const invalid = { ...validNode, created_at: 'not-a-date' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid datetime should fail');
      });
    });

    describe('optional fields', () => {
      it('should allow missing updated_at', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        assert.ok(result.success, 'Missing updated_at should be valid');
      });

      it('should allow missing wu_id', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        assert.ok(result.success, 'Missing wu_id should be valid');
      });

      it('should allow missing session_id', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        assert.ok(result.success, 'Missing session_id should be valid');
      });

      it('should allow missing metadata', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        assert.ok(result.success, 'Missing metadata should be valid');
      });

      it('should allow missing tags', () => {
        const result = MemoryNodeSchema.safeParse(validNode);
        assert.ok(result.success, 'Missing tags should be valid');
      });

      it('should validate wu_id format when present', () => {
        const withWuId = { ...validNode, wu_id: 'WU-1462' };
        const result = MemoryNodeSchema.safeParse(withWuId);
        assert.ok(result.success, 'Valid wu_id should be accepted');
      });

      it('should reject invalid wu_id format', () => {
        const invalid = { ...validNode, wu_id: 'INVALID-123' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid wu_id format should fail');
      });

      it('should validate session_id as UUID when present', () => {
        const withSessionId = {
          ...validNode,
          session_id: '550e8400-e29b-41d4-a716-446655440000',
        };
        const result = MemoryNodeSchema.safeParse(withSessionId);
        assert.ok(result.success, 'Valid UUID session_id should be accepted');
      });

      it('should reject invalid session_id format', () => {
        const invalid = { ...validNode, session_id: 'not-a-uuid' };
        const result = MemoryNodeSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid session_id format should fail');
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
      assert.ok(result.success, 'Valid relationship should parse');
    });

    it('should validate a complete relationship with all optional fields', () => {
      const complete = {
        ...validRelationship,
        created_at: '2025-12-08T10:30:00Z',
        metadata: { strength: 0.8 },
      };
      const result = RelationshipSchema.safeParse(complete);
      assert.ok(result.success, 'Complete relationship should parse');
    });

    describe('type validation', () => {
      it('should accept all 4 valid relationship types', () => {
        const types = ['blocks', 'parent_child', 'related', 'discovered_from'];
        for (const type of types) {
          const rel = { ...validRelationship, type };
          const result = RelationshipSchema.safeParse(rel);
          assert.ok(result.success, `Type '${type}' should be valid`);
        }
      });

      it('should reject invalid relationship type', () => {
        const invalid = { ...validRelationship, type: 'invalid' };
        const result = RelationshipSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid type should fail');
      });
    });

    describe('ID validation', () => {
      it('should validate from_id format', () => {
        const invalid = { ...validRelationship, from_id: 'invalid' };
        const result = RelationshipSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid from_id should fail');
      });

      it('should validate to_id format', () => {
        const invalid = { ...validRelationship, to_id: 'invalid' };
        const result = RelationshipSchema.safeParse(invalid);
        assert.ok(!result.success, 'Invalid to_id should fail');
      });

      it('should require from_id', () => {
        const { from_id: _unused, ...withoutFromId } = validRelationship;
        void _unused;
        const result = RelationshipSchema.safeParse(withoutFromId);
        assert.ok(!result.success, 'Missing from_id should fail');
      });

      it('should require to_id', () => {
        const { to_id: _unused, ...withoutToId } = validRelationship;
        void _unused;
        const result = RelationshipSchema.safeParse(withoutToId);
        assert.ok(!result.success, 'Missing to_id should fail');
      });
    });

    describe('optional fields', () => {
      it('should allow missing created_at', () => {
        const result = RelationshipSchema.safeParse(validRelationship);
        assert.ok(result.success, 'Missing created_at should be valid');
      });

      it('should allow missing metadata', () => {
        const result = RelationshipSchema.safeParse(validRelationship);
        assert.ok(result.success, 'Missing metadata should be valid');
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
      assert.ok(result.success, 'Valid node should pass');
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
      assert.ok(!result.success, 'Invalid node should fail');
      assert.ok(result.error, 'Should have error object');
      assert.ok(result.error.issues.length > 0, 'Should have validation issues');
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
      assert.ok(result.success, 'Valid relationship should pass');
    });

    it('should return error for invalid relationship', () => {
      const invalid = {
        from_id: 'invalid',
        to_id: 'invalid',
        type: 'invalid',
      };
      const result = validateRelationship(invalid);
      assert.ok(!result.success, 'Invalid relationship should fail');
      assert.ok(result.error, 'Should have error object');
      assert.ok(result.error.issues.length > 0, 'Should have validation issues');
    });
  });
});
