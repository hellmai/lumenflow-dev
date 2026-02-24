// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Promote Core (WU-1237)
 *
 * Promotes session/WU learnings into project-level knowledge nodes.
 *
 * Features:
 * - Promote individual nodes to project lifecycle
 * - Promote all summaries from a WU
 * - Enforced taxonomy tags (decision, convention, pattern, etc.)
 * - Creates discovered_from relationships for provenance
 * - Dry-run mode for preview without writes
 *
 * @see {@link packages/@lumenflow/cli/src/mem-promote.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-promote-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { loadMemory, appendNode } from './memory-store.js';
import type { MemoryNode, Relationship } from './memory-schema.js';
import { MEMORY_PATTERNS } from './memory-schema.js';
import { generateMemId } from './mem-id.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Relationships file name
 */
const RELATIONSHIPS_FILE_NAME = 'relationships.jsonl';

/**
 * Allowed tags for promoted nodes.
 * These form the project knowledge taxonomy.
 */
export const ALLOWED_PROMOTION_TAGS = [
  'decision',
  'convention',
  'pattern',
  'pitfall',
  'interface',
  'invariant',
  'faq',
] as const;

/**
 * Type for allowed promotion tags
 */
export type PromotionTag = (typeof ALLOWED_PROMOTION_TAGS)[number];

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  NODE_NOT_FOUND: 'Node not found',
  ALREADY_PROJECT: 'Node is already at project lifecycle',
  INVALID_TAG: `Tag must be one of: ${ALLOWED_PROMOTION_TAGS.join(', ')}`,
  INVALID_WU_ID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-1234)',
};

/**
 * Options for promoting a single node
 */
export interface PromoteNodeOptions {
  /** Node ID to promote (mem-xxxx format) */
  nodeId: string;
  /** Tag from the allowed taxonomy */
  tag: string;
  /** If true, return what would be promoted without writing */
  dryRun?: boolean;
}

/**
 * Result of promoting a node
 */
export interface PromoteNodeResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The promoted node */
  promotedNode: MemoryNode;
  /** The created relationship */
  relationship?: Relationship;
  /** Whether this was a dry run */
  dryRun?: boolean;
}

/**
 * Options for promoting all summaries from a WU
 */
export interface PromoteFromWuOptions {
  /** WU ID to promote summaries from */
  wuId: string;
  /** Tag from the allowed taxonomy */
  tag: string;
  /** If true, return what would be promoted without writing */
  dryRun?: boolean;
}

/**
 * Result of promoting from a WU
 */
export interface PromoteFromWuResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** All promoted nodes */
  promotedNodes: MemoryNode[];
  /** All created relationships */
  relationships?: Relationship[];
  /** Whether this was a dry run */
  dryRun?: boolean;
}

/**
 * Validates the promotion tag against allowed taxonomy
 *
 * @param tag - Tag to validate
 * @throws If tag is not in ALLOWED_PROMOTION_TAGS
 */
function validateTag(tag: string): asserts tag is PromotionTag {
  if (!ALLOWED_PROMOTION_TAGS.includes(tag as PromotionTag)) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.INVALID_TAG);
  }
}

/**
 * Validates WU ID format
 *
 * @param wuId - WU ID to validate
 * @throws If WU ID is invalid
 */
function validateWuId(wuId: string): void {
  if (!MEMORY_PATTERNS.WU_ID.test(wuId)) {
    throw createError(ErrorCodes.INVALID_WU_ID, ERROR_MESSAGES.INVALID_WU_ID);
  }
}

/**
 * Appends a relationship to the relationships.jsonl file
 *
 * @param memoryDir - Memory directory path
 * @param relationship - Relationship to append
 */
async function appendRelationship(memoryDir: string, relationship: Relationship): Promise<void> {
  const filePath = path.join(memoryDir, RELATIONSHIPS_FILE_NAME);
  const line = JSON.stringify(relationship) + '\n';
  await fs.appendFile(filePath, line, { encoding: 'utf-8' as BufferEncoding });
}

/**
 * Creates a promoted node from a source node
 *
 * @param sourceNode - Source node to promote
 * @param tag - Taxonomy tag to apply
 * @returns New node with project lifecycle
 */
function createPromotedNode(sourceNode: MemoryNode, tag: PromotionTag): MemoryNode {
  const now = new Date().toISOString();

  // Generate new ID based on content + timestamp for uniqueness
  const newId = generateMemId(`${sourceNode.content}${now}`);

  // Build tags array, ensuring the promotion tag is included
  const existingTags = sourceNode.tags ?? [];
  const tags = existingTags.includes(tag) ? existingTags : [...existingTags, tag];

  return {
    id: newId,
    type: sourceNode.type,
    lifecycle: 'project',
    content: sourceNode.content,
    created_at: now,
    wu_id: sourceNode.wu_id,
    session_id: sourceNode.session_id,
    metadata: {
      ...sourceNode.metadata,
      promoted_from: sourceNode.id,
      promoted_at: now,
    },
    tags,
  };
}

/**
 * Creates a discovered_from relationship between promoted and source nodes
 *
 * @param promotedNodeId - ID of the promoted node
 * @param sourceNodeId - ID of the source node
 * @returns Relationship object
 */
function createRelationship(promotedNodeId: string, sourceNodeId: string): Relationship {
  return {
    from_id: promotedNodeId,
    to_id: sourceNodeId,
    type: 'discovered_from',
    created_at: new Date().toISOString(),
    metadata: {},
  };
}

/**
 * Promotes a single node to project lifecycle.
 *
 * Creates a new project-level node with the same content and a
 * discovered_from relationship back to the source node.
 *
 * @param baseDir - Base directory containing .lumenflow/memory
 * @param options - Promotion options
 * @returns Result with the promoted node
 * @throws If node not found, already project level, or invalid tag
 *
 * @example
 * const result = await promoteNode('/path/to/project', {
 *   nodeId: 'mem-abc1',
 *   tag: 'pattern',
 * });
 * console.log(`Promoted to ${result.promotedNode.id}`);
 */
export async function promoteNode(
  baseDir: string,
  options: PromoteNodeOptions,
): Promise<PromoteNodeResult> {
  const { nodeId, tag, dryRun = false } = options;

  // Validate tag
  validateTag(tag);

  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Load memory and find the source node
  const memory = await loadMemory(memoryDir);
  const sourceNode = memory.byId.get(nodeId);

  if (!sourceNode) {
    throw createError(ErrorCodes.NODE_NOT_FOUND, `${ERROR_MESSAGES.NODE_NOT_FOUND}: ${nodeId}`);
  }

  if (sourceNode.lifecycle === 'project') {
    throw createError(ErrorCodes.ALREADY_EXISTS, `${ERROR_MESSAGES.ALREADY_PROJECT}: ${nodeId}`);
  }

  // Create the promoted node
  const promotedNode = createPromotedNode(sourceNode, tag);

  // Create the relationship
  const relationship = createRelationship(promotedNode.id, sourceNode.id);

  // Write if not dry run
  if (!dryRun) {
    await appendNode(memoryDir, promotedNode);
    await appendRelationship(memoryDir, relationship);
  }

  return {
    success: true,
    promotedNode,
    relationship,
    dryRun,
  };
}

/**
 * Promotes all summaries from a WU to project lifecycle.
 *
 * Finds all summary-type nodes linked to the WU and promotes each one
 * to project level with discovered_from relationships.
 *
 * @param baseDir - Base directory containing .lumenflow/memory
 * @param options - Promotion options
 * @returns Result with all promoted nodes
 * @throws If WU ID is invalid or tag is invalid
 *
 * @example
 * const result = await promoteFromWu('/path/to/project', {
 *   wuId: 'WU-1234',
 *   tag: 'decision',
 * });
 * console.log(`Promoted ${result.promotedNodes.length} summaries`);
 */
export async function promoteFromWu(
  baseDir: string,
  options: PromoteFromWuOptions,
): Promise<PromoteFromWuResult> {
  const { wuId, tag, dryRun = false } = options;

  // Validate inputs
  validateWuId(wuId);
  validateTag(tag);

  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  // Load memory
  const memory = await loadMemory(memoryDir);

  // Find all summaries for this WU that aren't already project level
  const wuNodes = memory.byWu.get(wuId) ?? [];
  const summaries = wuNodes.filter(
    (node) => node.type === 'summary' && node.lifecycle !== 'project',
  );

  // If no summaries, return empty result
  if (summaries.length === 0) {
    return {
      success: true,
      promotedNodes: [],
      relationships: [],
      dryRun,
    };
  }

  const promotedNodes: MemoryNode[] = [];
  const relationships: Relationship[] = [];

  // Promote each summary
  for (const summary of summaries) {
    const promotedNode = createPromotedNode(summary, tag);
    const relationship = createRelationship(promotedNode.id, summary.id);

    promotedNodes.push(promotedNode);
    relationships.push(relationship);

    // Write if not dry run
    if (!dryRun) {
      await appendNode(memoryDir, promotedNode);
      await appendRelationship(memoryDir, relationship);
    }
  }

  return {
    success: true,
    promotedNodes,
    relationships,
    dryRun,
  };
}
