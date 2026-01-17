/**
 * Memory Schema (WU-1462)
 *
 * Zod schema for runtime validation of memory node structure.
 * Foundation for the entire memory layer (INIT-007 Phase 1).
 *
 * Defines schemas for:
 * - Memory nodes (5 types: session, discovery, checkpoint, note, summary)
 * - Lifecycles (4 levels: ephemeral, session, wu, project)
 * - Relationships (4 types: blocks, parent_child, related, discovered_from)
 *
 * @see {@link tools/lib/__tests__/memory-schema.test.mjs} - Tests
 */

import { z } from 'zod';

/**
 * Memory node types
 *
 * - session: Session-level context (agent startup, context snapshot)
 * - discovery: Found information (file locations, code patterns)
 * - checkpoint: Progress marker (task milestone, state save)
 * - note: Free-form annotation (observation, decision rationale)
 * - summary: Condensed context (session summary, WU summary)
 */
export const MEMORY_NODE_TYPES = ['session', 'discovery', 'checkpoint', 'note', 'summary'] as const;

/**
 * Memory lifecycle durations
 *
 * - ephemeral: Discarded immediately after use (scratch pad)
 * - session: Lives for current agent session only
 * - wu: Lives for WU duration (cleared on wu:done)
 * - project: Persists across WUs (architectural knowledge)
 */
export const MEMORY_LIFECYCLES = ['ephemeral', 'session', 'wu', 'project'] as const;

/**
 * Relationship types between memory nodes
 *
 * - blocks: This node blocks another (dependency)
 * - parent_child: Hierarchical relationship (session contains discoveries)
 * - related: Semantic similarity or topical connection
 * - discovered_from: Source attribution (discovered from another node)
 */
export const RELATIONSHIP_TYPES = ['blocks', 'parent_child', 'related', 'discovered_from'] as const;

/**
 * Regex patterns for memory validation
 */
export const MEMORY_PATTERNS = {
  /** Memory ID format: mem-[a-z0-9]{4} */
  MEMORY_ID: /^mem-[a-z0-9]{4}$/,

  /** WU ID format (reused from wu-schema) */
  WU_ID: /^WU-\d+$/,
};

/**
 * Error messages for schema validation
 */
const ERROR_MESSAGES = {
  MEMORY_ID: 'ID must match pattern mem-[a-z0-9]{4} (e.g., mem-abc1)',
  NODE_TYPE: `Type must be one of: ${MEMORY_NODE_TYPES.join(', ')}`,
  LIFECYCLE: `Lifecycle must be one of: ${MEMORY_LIFECYCLES.join(', ')}`,
  RELATIONSHIP_TYPE: `Type must be one of: ${RELATIONSHIP_TYPES.join(', ')}`,
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1462)',
  CONTENT_REQUIRED: 'Content is required',
  DATETIME_REQUIRED: 'Created timestamp is required',
};

/**
 * Zod schema for Memory Node
 *
 * Validates memory nodes against the memory layer requirements.
 * All memory operations should validate against this schema.
 */
export const MemoryNodeSchema = z.object({
  /** Memory node identifier (mem-[a-z0-9]{4}) */
  id: z.string().regex(MEMORY_PATTERNS.MEMORY_ID, { message: ERROR_MESSAGES.MEMORY_ID }),

  /** Node type classification */
  type: z.enum(MEMORY_NODE_TYPES, {
    error: ERROR_MESSAGES.NODE_TYPE,
  }),

  /** Lifecycle duration */
  lifecycle: z.enum(MEMORY_LIFECYCLES, {
    error: ERROR_MESSAGES.LIFECYCLE,
  }),

  /** Node content (required, non-empty) */
  content: z.string().min(1, { message: ERROR_MESSAGES.CONTENT_REQUIRED }),

  /** Creation timestamp (ISO 8601 datetime) */
  created_at: z.string().datetime({ message: ERROR_MESSAGES.DATETIME_REQUIRED }),

  /** Last update timestamp (optional, ISO 8601 datetime) */
  updated_at: z.string().datetime().optional(),

  /** Associated WU ID (optional) */
  wu_id: z
    .string()
    .regex(MEMORY_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID })
    .optional(),

  /** Session ID this node belongs to (optional, UUID) */
  session_id: z.string().uuid().optional(),

  /** Arbitrary metadata (optional) */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /** Tags for categorization (optional) */
  tags: z.array(z.string()).optional(),
});

/**
 * Zod schema for Relationship between memory nodes
 *
 * Validates relationships between memory nodes.
 * Used for building the memory graph.
 */
export const RelationshipSchema = z.object({
  /** Source node ID (mem-[a-z0-9]{4}) */
  from_id: z.string().regex(MEMORY_PATTERNS.MEMORY_ID, { message: ERROR_MESSAGES.MEMORY_ID }),

  /** Target node ID (mem-[a-z0-9]{4}) */
  to_id: z.string().regex(MEMORY_PATTERNS.MEMORY_ID, { message: ERROR_MESSAGES.MEMORY_ID }),

  /** Relationship type */
  type: z.enum(RELATIONSHIP_TYPES, {
    error: ERROR_MESSAGES.RELATIONSHIP_TYPE,
  }),

  /** Creation timestamp (optional, ISO 8601 datetime) */
  created_at: z.string().datetime().optional(),

  /** Arbitrary metadata (optional) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * TypeScript types inferred from schemas
 */
export type MemoryNode = z.infer<typeof MemoryNodeSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;

/**
 * Validates memory node data against schema
 *
 * @param data - Data to validate
 * @returns Validation result
 *
 * @example
 * const result = validateMemoryNode(nodeData);
 * if (!result.success) {
 *   result.error.issues.forEach(issue => {
 *     console.error(`${issue.path.join('.')}: ${issue.message}`);
 *   });
 * }
 */
export function validateMemoryNode(data: unknown) {
  return MemoryNodeSchema.safeParse(data);
}

/**
 * Validates relationship data against schema
 *
 * @param data - Data to validate
 * @returns Validation result
 *
 * @example
 * const result = validateRelationship(relData);
 * if (!result.success) {
 *   result.error.issues.forEach(issue => {
 *     console.error(`${issue.path.join('.')}: ${issue.message}`);
 *   });
 * }
 */
export function validateRelationship(data: unknown) {
  return RelationshipSchema.safeParse(data);
}
