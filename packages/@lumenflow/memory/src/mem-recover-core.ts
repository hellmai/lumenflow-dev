// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Recovery Core (WU-1390)
 *
 * Generates post-compaction recovery context for agents that have lost
 * their LumenFlow instructions due to context compaction.
 *
 * Features:
 * - Loads last checkpoint from memory layer
 * - Extracts compact constraints from .lumenflow/constraints.md
 * - Provides essential CLI commands reference
 * - Size-limited output (default 2KB) to prevent truncation
 * - Vendor-agnostic (works for any client)
 *
 * @see {@link packages/@lumenflow/cli/src/mem-recover.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-recover-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { loadMemory } from './memory-store.js';
import { MEMORY_PATTERNS, type MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Default maximum recovery context size in bytes (2KB)
 * Smaller than spawn context to ensure it doesn't get truncated
 */
const DEFAULT_MAX_SIZE = 2048;

/**
 * Node type constant for checkpoint filtering
 * @see {@link MEMORY_NODE_TYPES} in memory-schema.ts
 */
const NODE_TYPE_CHECKPOINT = 'checkpoint' as const;

/**
 * Constraints file name within .lumenflow directory
 */
const CONSTRAINTS_FILENAME = 'constraints.md';

/**
 * Default value for unknown timestamps
 */
const TIMESTAMP_UNKNOWN = 'unknown';

/**
 * Error messages for validation
 */
const ERROR_MESSAGES = {
  WU_ID_REQUIRED: 'wuId is required',
  WU_ID_EMPTY: 'wuId cannot be empty',
  WU_ID_INVALID: 'Invalid WU ID format. Expected pattern: WU-XXX (e.g., WU-1234)',
} as const;

/**
 * Section headers for recovery context formatting
 */
const SECTION_HEADERS = {
  RECOVERY_TITLE: 'POST-COMPACTION RECOVERY',
  LAST_CHECKPOINT: 'Last Checkpoint',
  CRITICAL_RULES: 'Critical Rules (DO NOT FORGET)',
  CLI_COMMANDS: 'CLI Commands',
  NEXT_ACTION: 'Next Action',
} as const;

/**
 * Essential CLI commands for recovery (hardcoded, ~400 bytes)
 */
const ESSENTIAL_CLI_COMMANDS = `| Command | Purpose |
|---------|---------|
| pnpm wu:status --id WU-XXX | Check WU status and location |
| pnpm wu:brief --id WU-XXX --client claude-code | Generate fresh agent handoff prompt |
| pnpm gates | Run quality gates before completion |
| pnpm mem:checkpoint | Save progress checkpoint |`;

/**
 * Compact constraints (hardcoded fallback, ~800 bytes)
 * Used when constraints.md cannot be loaded
 */
const FALLBACK_CONSTRAINTS = `1. **Worktree Discipline**: Work only in worktrees, treat main as read-only
2. **WUs Are Specs**: Respect code_paths boundaries, no feature creep
3. **Docs-Only vs Code**: Documentation WUs use --docs-only gates
4. **LLM-First Inference**: Use LLMs for semantic tasks, no brittle regex
5. **Gates Required**: Run pnpm gates before wu:done
6. **Safety & Governance**: No secrets in code, stop-and-ask for sensitive ops
7. **Test Ratchet**: NEW test failures block, pre-existing show warning only`;

/**
 * Options for generating recovery context
 */
export interface RecoverOptions {
  /** WU ID to recover context for (required) */
  wuId: string;
  /** Base directory (default: current directory) */
  baseDir?: string;
  /** Maximum output size in bytes (default: 2048) */
  maxSize?: number;
  /** Include constraints section (default: true) */
  includeConstraints?: boolean;
  /** Include CLI reference section (default: true) */
  includeCLIRef?: boolean;
}

/**
 * Checkpoint data extracted from memory
 */
interface CheckpointData {
  content: string;
  timestamp: string;
  progress?: string;
  nextSteps?: string;
}

/**
 * Result of generating recovery context
 */
export interface RecoverResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The formatted recovery context */
  context: string;
  /** Size of the context in bytes */
  size: number;
  /** Whether the context was truncated to fit maxSize */
  truncated: boolean;
}

/**
 * Validates WU ID format
 */
function validateWuId(wuId: string): void {
  if (wuId == null) {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.WU_ID_REQUIRED);
  }
  if (wuId === '') {
    throw createError(ErrorCodes.VALIDATION_ERROR, ERROR_MESSAGES.WU_ID_EMPTY);
  }
  if (!MEMORY_PATTERNS.WU_ID.test(wuId)) {
    throw createError(ErrorCodes.INVALID_WU_ID, ERROR_MESSAGES.WU_ID_INVALID);
  }
}

/**
 * Gets the most recent checkpoint for a WU from memory
 */
async function getLastCheckpoint(baseDir: string, wuId: string): Promise<CheckpointData | null> {
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);

  try {
    const memory = await loadMemory(memoryDir);
    const wuNodes = memory.byWu.get(wuId) ?? [];

    // Filter to checkpoint nodes and sort by timestamp (most recent first)
    const checkpoints = wuNodes
      .filter((node: MemoryNode) => node.type === NODE_TYPE_CHECKPOINT)
      .sort((a: MemoryNode, b: MemoryNode) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime; // Most recent first
      });

    if (checkpoints.length === 0) {
      return null;
    }

    const latest = checkpoints[0];
    if (!latest) return null;
    return {
      content: latest.content,
      timestamp: latest.created_at,
      progress: latest.metadata?.progress as string | undefined,
      nextSteps: latest.metadata?.nextSteps as string | undefined,
    };
  } catch {
    // Memory layer not initialized or error loading
    return null;
  }
}

/**
 * Loads compact constraints from .lumenflow/constraints.md
 * Extracts just the rule summary from each of the 7 sections
 */
async function loadCompactConstraints(baseDir: string): Promise<string> {
  const constraintsPath = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.BASE, CONSTRAINTS_FILENAME);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const content = await fs.readFile(constraintsPath, 'utf-8');

    // Extract section headers and their Rule lines
    const rules: string[] = [];
    const sectionPattern = /### (\d+)\. ([^\n]+)\n\n\*\*Rule:\*\* ([^\n]+)/g;
    let match;

    while ((match = sectionPattern.exec(content)) !== null) {
      const [, num, title, rule] = match;
      rules.push(`${num}. **${title}**: ${rule}`);
    }

    if (rules.length > 0) {
      return rules.join('\n');
    }

    // Fallback if parsing failed
    return FALLBACK_CONSTRAINTS;
  } catch {
    // File not found or read error - use fallback
    return FALLBACK_CONSTRAINTS;
  }
}

/**
 * Formats the recovery prompt with size budget
 */
function formatRecoveryPrompt(
  wuId: string,
  checkpoint: CheckpointData | null,
  constraints: string,
  cliRef: string,
  maxSize: number,
): { context: string; truncated: boolean } {
  const header = `# ${SECTION_HEADERS.RECOVERY_TITLE}

You are resuming work after context compaction. Your previous context was lost.
**WU:** ${wuId}

`;

  const checkpointSection = checkpoint
    ? `## ${SECTION_HEADERS.LAST_CHECKPOINT}
- **Progress:** ${checkpoint.content}
- **Timestamp:** ${checkpoint.timestamp}
${checkpoint.nextSteps ? `- **Next Steps:** ${checkpoint.nextSteps}` : ''}

`
    : `## ${SECTION_HEADERS.LAST_CHECKPOINT}
No checkpoint found for this WU.

`;

  // Only include sections if they have content
  const constraintsSection = constraints
    ? `## ${SECTION_HEADERS.CRITICAL_RULES}
${constraints}

`
    : '';

  const cliSection = cliRef
    ? `## ${SECTION_HEADERS.CLI_COMMANDS}
${cliRef}

`
    : '';

  const footer = `## ${SECTION_HEADERS.NEXT_ACTION}
Run \`pnpm wu:brief --id ${wuId} --client claude-code\` to generate a fresh handoff prompt.
`;

  // Build sections in priority order
  // Priority: header > checkpoint > constraints > CLI > footer
  // If over budget, truncate checkpoint content first
  const fixedContent = header + constraintsSection + cliSection + footer;
  const fixedSize = Buffer.byteLength(fixedContent, 'utf-8');

  if (fixedSize > maxSize) {
    // Even fixed content exceeds budget - return minimal recovery
    const minimal = `# ${SECTION_HEADERS.RECOVERY_TITLE}
WU: ${wuId}
Run: pnpm wu:brief --id ${wuId} --client claude-code
`;
    return { context: minimal, truncated: true };
  }

  const remainingBudget = maxSize - fixedSize;
  const checkpointSize = Buffer.byteLength(checkpointSection, 'utf-8');

  if (checkpointSize <= remainingBudget) {
    // Full checkpoint fits
    const fullContext = header + checkpointSection + constraintsSection + cliSection + footer;
    return { context: fullContext, truncated: false };
  }

  // Truncate checkpoint to fit
  const truncatedCheckpoint = `## ${SECTION_HEADERS.LAST_CHECKPOINT}
- **Progress:** (truncated - run mem:ready --wu ${wuId} for details)
- **Timestamp:** ${checkpoint?.timestamp ?? TIMESTAMP_UNKNOWN}

`;

  const context = header + truncatedCheckpoint + constraintsSection + cliSection + footer;
  return { context, truncated: true };
}

/**
 * Generates post-compaction recovery context for an agent.
 *
 * The recovery context includes:
 * - Last checkpoint for the WU (from memory layer)
 * - Compact constraints (7 rules from constraints.md)
 * - Essential CLI commands reference
 * - Guidance to spawn fresh agent
 *
 * Size is limited to prevent the recovery context itself from being
 * truncated or compacted.
 *
 * @param options - Recovery options
 * @returns Recovery context result
 *
 * @example
 * const result = await generateRecoveryContext({
 *   wuId: 'WU-1390',
 *   maxSize: 2048,
 * });
 * console.log(result.context);
 */
export async function generateRecoveryContext(options: RecoverOptions): Promise<RecoverResult> {
  const {
    wuId,
    baseDir = '.',
    maxSize = DEFAULT_MAX_SIZE,
    includeConstraints = true,
    includeCLIRef = true,
  } = options;

  // Validate WU ID
  validateWuId(wuId);

  // Load checkpoint from memory
  const checkpoint = await getLastCheckpoint(baseDir, wuId);

  // Load constraints (or use empty if disabled)
  const constraints = includeConstraints ? await loadCompactConstraints(baseDir) : '';

  // Get CLI reference (or empty if disabled)
  const cliRef = includeCLIRef ? ESSENTIAL_CLI_COMMANDS : '';

  // Format with size budget
  const { context, truncated } = formatRecoveryPrompt(
    wuId,
    checkpoint,
    constraints,
    cliRef,
    maxSize,
  );

  return {
    success: true,
    context,
    size: Buffer.byteLength(context, 'utf-8'),
    truncated,
  };
}
