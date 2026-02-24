// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Start Core (WU-1466)
 *
 * Core logic for creating session nodes linked to WUs.
 * Called by wu:claim enhancement for context restoration after /clear.
 *
 * Features:
 * - Creates session nodes with WU reference
 * - Stores agent type, start timestamp, context tier
 * - Idempotent: multiple starts create separate sessions
 * - Auto-initializes memory layer if not present
 *
 * @see {@link packages/@lumenflow/cli/src/mem-start.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/cli/src/__tests__/mem-start.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/memory-schema.ts} - Schema definitions
 */

import { randomUUID } from 'node:crypto';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { generateMemId } from './mem-id.js';
import { appendNode } from './memory-store.js';
import { MEMORY_PATTERNS, type MemoryNode } from './memory-schema.js';
import { ensureMemoryDir } from './fs-utils.js';

/**
 * Default values for session metadata
 */
const DEFAULTS = {
  AGENT_TYPE: 'unknown',
  CONTEXT_TIER: 'full',
};

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  WU_ID_REQUIRED: 'wuId is required',
  WU_ID_INVALID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-123)',
};

/**
 * Validates WU ID format
 *
 * @param wuId - WU ID to validate
 * @returns True if valid
 */
function isValidWuId(wuId: string): boolean {
  return MEMORY_PATTERNS.WU_ID.test(wuId);
}

/**
 * Generates content description for session node
 *
 * @param wuId - WU ID
 * @param agentType - Agent type
 * @param contextTier - Context tier
 * @returns Content description
 */
function generateSessionContent(wuId: string, agentType: string, contextTier: string): string {
  return `Session started for ${wuId}. Agent: ${agentType}, Context: ${contextTier}`;
}

/**
 * Session start options
 */
export interface StartSessionOptions {
  /** Work Unit ID (required) */
  wuId: string;
  /** Agent type (defaults to 'unknown') */
  agentType?: string;
  /** Context tier (defaults to 'full') */
  contextTier?: string;
}

/**
 * Session node structure
 */
interface SessionNode {
  id: string;
  type: 'session';
  lifecycle: 'wu';
  content: string;
  created_at: string;
  wu_id: string;
  session_id: string;
  metadata: {
    agentType: string;
    contextTier: string;
  };
}

/**
 * Session start result
 */
export interface StartSessionResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Created session node */
  session: SessionNode;
}

/**
 * Creates a new session node linked to a WU.
 *
 * Creates a session-type memory node with:
 * - Unique ID (mem-XXXX format)
 * - Link to WU via wu_id field
 * - Agent type and context tier in metadata
 * - UUID session_id for unique identification
 *
 * @param baseDir - Base directory containing .lumenflow/memory/
 * @param options - Session options
 * @returns Result with created session node
 * @throws If wuId is missing or invalid
 *
 * @example
 * const result = await startSession('/path/to/project', {
 *   wuId: 'WU-1234',
 *   agentType: 'general-purpose',
 *   contextTier: 'core',
 * });
 * console.log(result.session.id); // 'mem-a1b2'
 */
export async function startSession(
  baseDir: string,
  options: StartSessionOptions,
): Promise<StartSessionResult> {
  const { wuId, agentType = DEFAULTS.AGENT_TYPE, contextTier = DEFAULTS.CONTEXT_TIER } = options;

  // Validate required fields
  if (!wuId) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.WU_ID_REQUIRED);
  }

  // Validate WU ID format
  if (!isValidWuId(wuId)) {
    throw createError(ErrorCodes.INVALID_WU_ID, ERROR_MESSAGES.WU_ID_INVALID);
  }

  // Ensure memory directory exists
  const memoryDir = await ensureMemoryDir(baseDir);

  // Generate session node
  const timestamp = new Date().toISOString();
  const sessionId = randomUUID();
  const content = generateSessionContent(wuId, agentType, contextTier);

  // Generate deterministic ID from content + timestamp for uniqueness
  const idContent = `${content}-${timestamp}-${sessionId}`;
  const id = generateMemId(idContent);

  const sessionNode: SessionNode = {
    id,
    type: 'session',
    lifecycle: 'wu',
    content,
    created_at: timestamp,
    wu_id: wuId,
    session_id: sessionId,
    metadata: {
      agentType,
      contextTier,
    },
  };

  // Persist to memory store
  await appendNode(memoryDir, sessionNode as unknown as MemoryNode);

  return {
    success: true,
    session: sessionNode,
  };
}
