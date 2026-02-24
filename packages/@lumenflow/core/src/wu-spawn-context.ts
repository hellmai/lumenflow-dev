// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Context Integration for wu:spawn (WU-1240, WU-1287)
 *
 * Thin wrapper that delegates to @lumenflow/memory's generateContext function.
 * Provides spawn-specific formatting (## Memory Context header) while leveraging
 * the full feature set of mem-context-core (lane filter, recency, decay).
 *
 * WU-1287: Refactored to eliminate duplicate logic. Now delegates to
 * mem-context-core.generateContext for all memory context generation,
 * ensuring spawn prompts benefit from lane filtering, recency limits,
 * and decay/prioritization features.
 *
 * Features:
 * - Detects memory layer initialization (memory.jsonl existence)
 * - Delegates to mem-context-core for context generation
 * - Respects lane filter, recency limits, decay/prioritization from mem-context-core
 * - Configurable max context size (default 4KB, from workspace.yaml)
 * - Graceful skip when memory not initialized or @lumenflow/memory unavailable
 * - No LLM calls (vendor-agnostic)
 *
 * @see {@link packages/@lumenflow/memory/src/mem-context-core.ts} - Core context generation
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LumenFlowConfig } from './lumenflow-config-schema.js';
import { LUMENFLOW_PATHS } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Default maximum context size in bytes (4KB)
 */
const DEFAULT_MAX_SIZE = 4096;

/**
 * Memory layer paths (WU-1430: Use centralized constants)
 */
const MEMORY_PATHS = {
  MEMORY_DIR: LUMENFLOW_PATHS.MEMORY_DIR,
  MEMORY_FILE: 'memory.jsonl',
} as const;

const MEMORY_CONTEXT_ERRORS = {
  DEPRECATED_SPAWN_CONTEXT_MAX_SIZE:
    'memory.spawn_context_max_size is no longer supported. Use memory.delegation_context_max_size instead.',
} as const;

/**
 * Section header for memory context in spawn prompts
 */
export const MEMORY_CONTEXT_SECTION_HEADER = '## Memory Context';

/**
 * Options for generating memory context
 */
export interface GenerateMemoryContextOptions {
  /** WU ID to filter context for */
  wuId: string;
  /** Lane to filter context for (WU-1281: enables lane-specific filtering) */
  lane?: string;
  /** Maximum size of context block in bytes (default: 4096) */
  maxSize?: number;
  /** WU-1238: Sort by decay score instead of recency (default: false) */
  sortByDecay?: boolean;
  /** WU-1238: Track access for included nodes (default: false) */
  trackAccess?: boolean;
  /** WU-1281: Maximum number of recent summaries to include (default: 5) */
  maxRecentSummaries?: number;
  /** WU-1281: Maximum number of project nodes to include (default: 10) */
  maxProjectNodes?: number;
}

/**
 * Checks if the memory layer is initialized.
 *
 * The memory layer is considered initialized when:
 * 1. The .lumenflow/memory directory exists
 * 2. memory.jsonl file exists and is non-empty
 *
 * @param baseDir - Project root directory
 * @returns true if memory layer is initialized, false otherwise
 */
export async function checkMemoryLayerInitialized(baseDir: string): Promise<boolean> {
  const memoryFilePath = path.join(baseDir, MEMORY_PATHS.MEMORY_DIR, MEMORY_PATHS.MEMORY_FILE);

  if (!existsSync(memoryFilePath)) {
    return false;
  }

  try {
    const stats = statSync(memoryFilePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Gets the maximum context size from config or returns default.
 *
 * Reads from config.memory.delegation_context_max_size, defaulting to 4KB.
 *
 * @param config - LumenFlow configuration object
 * @returns Maximum context size in bytes
 */
export function getMemoryContextMaxSize(config: Partial<LumenFlowConfig>): number {
  const memoryConfig = config as {
    memory?: {
      delegation_context_max_size?: number;
      spawn_context_max_size?: unknown;
    };
  };

  if (memoryConfig?.memory?.spawn_context_max_size !== undefined) {
    throw createError(
      ErrorCodes.DEPRECATED_API,
      MEMORY_CONTEXT_ERRORS.DEPRECATED_SPAWN_CONTEXT_MAX_SIZE,
    );
  }

  return memoryConfig?.memory?.delegation_context_max_size ?? DEFAULT_MAX_SIZE;
}

/**
 * Type for the generateContext function from @lumenflow/memory
 */
interface GenerateContextResult {
  success: boolean;
  contextBlock: string;
  stats: {
    totalNodes: number;
    byType: Record<string, number>;
    truncated: boolean;
    size: number;
    accessTracked?: number;
  };
}

/**
 * Type for the generateContext options from @lumenflow/memory
 */
interface MemContextCoreOptions {
  wuId: string;
  maxSize?: number;
  sortByDecay?: boolean;
  trackAccess?: boolean;
  lane?: string;
  maxRecentSummaries?: number;
  maxProjectNodes?: number;
}

type MemContextModule = {
  generateContext: (
    baseDir: string,
    options: MemContextCoreOptions,
  ) => Promise<GenerateContextResult>;
};

function hasGenerateContext(module: unknown): module is MemContextModule {
  if (!module || typeof module !== 'object') {
    return false;
  }

  const candidate = module as { generateContext?: unknown };
  return typeof candidate.generateContext === 'function';
}

/**
 * Dynamically imports and calls generateContext from @lumenflow/memory.
 *
 * @param baseDir - Project root directory
 * @param options - Generation options
 * @returns Result from mem-context-core.generateContext, or null if unavailable
 */
async function callMemContextCore(
  baseDir: string,
  options: MemContextCoreOptions,
): Promise<GenerateContextResult | null> {
  try {
    // Dynamic import of optional peer dependency
    // Use a non-literal import to avoid compile-time dependency on optional peer
    const memoryModuleName: string = '@lumenflow/memory';
    const memModule = (await import(memoryModuleName)) as unknown;
    if (!hasGenerateContext(memModule)) {
      return null;
    }
    return await memModule.generateContext(baseDir, options);
  } catch {
    // @lumenflow/memory not available - return null for graceful degradation
    return null;
  }
}

/**
 * Converts mem-context-core output format to spawn prompt format.
 *
 * mem-context-core uses "## Section" headers, but spawn prompts expect
 * "### Section" for subsections under "## Memory Context".
 *
 * @param contextBlock - Raw context block from mem-context-core
 * @param wuId - WU ID for the intro line
 * @returns Formatted context with spawn-specific header structure
 */
function formatForSpawnPrompt(contextBlock: string, wuId: string): string {
  if (!contextBlock || contextBlock.trim() === '') {
    return '';
  }

  // Remove the mem:context header comment if present
  let content = contextBlock.replace(/^<!--\s*mem:context[^>]*-->\s*\n*/m, '');

  // Convert ## headers to ### for subsection nesting under ## Memory Context
  content = content.replace(/^## /gm, '### ');

  // Build the full Memory Context section with spawn-specific formatting
  const header = `${MEMORY_CONTEXT_SECTION_HEADER}\n\n`;
  const intro = `Prior context from memory layer for ${wuId}:\n\n`;

  return header + intro + content.trim() + '\n';
}

/**
 * Generates the Memory Context section for wu:spawn prompts.
 *
 * WU-1287: Delegates to mem-context-core.generateContext for all context
 * generation logic, ensuring spawn prompts benefit from:
 * - Lane filtering (WU-1281)
 * - Recency limits (WU-1281)
 * - Decay-based prioritization (WU-1238)
 * - WU-specific content prioritization (WU-1281)
 *
 * Context includes (via mem-context-core):
 * 1. WU-specific context (checkpoints, notes matching wu_id) - high priority
 * 2. Summaries relevant to the WU
 * 3. Discoveries related to the WU
 * 4. Project profile items (lifecycle=project memories) - lower priority, may be truncated
 *
 * @param baseDir - Project root directory
 * @param options - Generation options (wuId, lane, maxSize, etc.)
 * @returns Formatted Memory Context section, or empty string if no context
 */
export async function generateMemoryContextSection(
  baseDir: string,
  options: GenerateMemoryContextOptions,
): Promise<string> {
  const {
    wuId,
    lane,
    maxSize = DEFAULT_MAX_SIZE,
    sortByDecay = false,
    trackAccess = false,
    maxRecentSummaries,
    maxProjectNodes,
  } = options;

  // Check if memory layer is initialized
  const isInitialized = await checkMemoryLayerInitialized(baseDir);
  if (!isInitialized) {
    return '';
  }

  // Delegate to mem-context-core.generateContext
  const result = await callMemContextCore(baseDir, {
    wuId,
    maxSize,
    sortByDecay,
    trackAccess,
    lane,
    maxRecentSummaries,
    maxProjectNodes,
  });

  // Graceful degradation if @lumenflow/memory is not available
  if (!result) {
    return '';
  }

  // If no context was generated, return empty
  if (!result.success || result.stats.totalNodes === 0) {
    return '';
  }

  // Format for spawn prompt
  return formatForSpawnPrompt(result.contextBlock, wuId);
}
