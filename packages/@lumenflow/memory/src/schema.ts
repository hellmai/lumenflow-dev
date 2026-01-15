/**
 * Memory Schema (WU-2541)
 *
 * Zod schemas for memory node validation.
 * Defines memory node types, lifecycles, and relationships.
 *
 * @module @lumenflow/memory/schema
 */

import { z } from 'zod';

/**
 * Memory node types
 */
export const MEMORY_NODE_TYPES = [
  'session',
  'discovery',
  'checkpoint',
  'note',
  'summary',
] as const;

export type MemoryNodeType = (typeof MEMORY_NODE_TYPES)[number];

/**
 * Memory lifecycle types (TTL policy)
 */
export const MEMORY_LIFECYCLES = [
  'ephemeral',
  'session',
  'wu',
  'project',
] as const;

export type MemoryLifecycle = (typeof MEMORY_LIFECYCLES)[number];

/**
 * Relationship types between memory nodes
 */
export const RELATIONSHIP_TYPES = [
  'blocks',
  'parent_child',
  'related',
  'discovered_from',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Regex patterns for memory validation
 */
export const MEMORY_PATTERNS = {
  MEMORY_ID: /^mem-[a-z0-9]{4}$/,
  WU_ID: /^WU-\d+$/,
  SESSION_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

const ERROR_MESSAGES = {
  MEMORY_ID: 'Memory ID must match pattern mem-xxxx (4 lowercase alphanumeric chars)',
  WU_ID: 'WU ID must match pattern WU-XXX (e.g., WU-1570)',
  SESSION_ID: 'Session ID must be a valid UUID',
  CONTENT_REQUIRED: 'Content is required',
  TIMESTAMP_REQUIRED: 'Timestamp is required',
  TYPE_INVALID: 'Node type must be one of: session, discovery, checkpoint, note, summary',
  LIFECYCLE_INVALID: 'Lifecycle must be one of: ephemeral, session, wu, project',
  RELATIONSHIP_TYPE_INVALID: 'Relationship type must be one of: blocks, parent_child, related, discovered_from',
} as const;

export const MemoryNodeSchema = z.object({
  id: z.string().regex(MEMORY_PATTERNS.MEMORY_ID, { message: ERROR_MESSAGES.MEMORY_ID }),
  type: z.enum(MEMORY_NODE_TYPES, {
    errorMap: () => ({ message: ERROR_MESSAGES.TYPE_INVALID }),
  }),
  lifecycle: z.enum(MEMORY_LIFECYCLES, {
    errorMap: () => ({ message: ERROR_MESSAGES.LIFECYCLE_INVALID }),
  }),
  content: z.string().min(1, { message: ERROR_MESSAGES.CONTENT_REQUIRED }),
  created_at: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }),
  wu_id: z.string().regex(MEMORY_PATTERNS.WU_ID, { message: ERROR_MESSAGES.WU_ID }).optional(),
  session_id: z.string().regex(MEMORY_PATTERNS.SESSION_ID, { message: ERROR_MESSAGES.SESSION_ID }).optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export const RelationshipSchema = z.object({
  from_id: z.string().regex(MEMORY_PATTERNS.MEMORY_ID, { message: ERROR_MESSAGES.MEMORY_ID }),
  to_id: z.string().regex(MEMORY_PATTERNS.MEMORY_ID, { message: ERROR_MESSAGES.MEMORY_ID }),
  type: z.enum(RELATIONSHIP_TYPES, {
    errorMap: () => ({ message: ERROR_MESSAGES.RELATIONSHIP_TYPE_INVALID }),
  }),
  created_at: z.string().datetime({ message: ERROR_MESSAGES.TIMESTAMP_REQUIRED }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type MemoryNode = z.infer<typeof MemoryNodeSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;

export function validateMemoryNode(data: unknown): z.SafeParseReturnType<MemoryNode, MemoryNode> {
  return MemoryNodeSchema.safeParse(data);
}

export function validateRelationship(data: unknown): z.SafeParseReturnType<Relationship, Relationship> {
  return RelationshipSchema.safeParse(data);
}
