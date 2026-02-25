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
 * - Loads WU metadata (acceptance criteria, code_paths) from YAML (WU-2157)
 * - Includes git diff stat from checkpoint metadata (WU-2157)
 * - Size-limited output (default 8KB) to prevent truncation
 * - Vendor-agnostic (works for any client)
 *
 * @see {@link packages/@lumenflow/cli/src/mem-recover.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/__tests__/mem-recover-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { loadMemory } from './memory-store.js';
import { MEMORY_PATTERNS, type MemoryNode } from './memory-schema.js';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Default maximum recovery context size in bytes (8KB)
 * Increased from 2KB in WU-2157 to accommodate WU metadata, git diff, and richer context.
 */
const DEFAULT_MAX_SIZE = 8192;

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
 * Maximum number of acceptance criteria items to include in recovery context.
 * Prevents large WU specs from consuming the entire size budget (review item #5).
 */
const MAX_ACCEPTANCE_ITEMS = 8;

/**
 * Maximum number of code path items to include in recovery context.
 */
const MAX_CODE_PATH_ITEMS = 10;

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
  ACCEPTANCE_CRITERIA: 'Acceptance Criteria',
  CODE_PATHS: 'Code Paths',
  FILES_CHANGED: 'Files Changed',
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
| pnpm wu:brief --id WU-XXX | Generate fresh agent handoff prompt |
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
  /** Maximum output size in bytes (default: 8192) */
  maxSize?: number;
  /** Include constraints section (default: true) */
  includeConstraints?: boolean;
  /** Include CLI reference section (default: true) */
  includeCLIRef?: boolean;
  /** Include WU metadata: acceptance criteria and code_paths (default: true, WU-2157) */
  includeWuMetadata?: boolean;
}

/**
 * Checkpoint data extracted from memory
 */
interface CheckpointData {
  content: string;
  timestamp: string;
  progress?: string;
  nextSteps?: string;
  /** Git diff --stat output captured at checkpoint time (WU-2157) */
  gitDiffStat?: string;
}

/**
 * WU metadata extracted from YAML spec (WU-2157)
 */
interface WuMetadata {
  acceptance: string[];
  codePaths: string[];
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
      gitDiffStat: latest.metadata?.gitDiffStat as string | undefined,
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
 * Loads WU metadata (acceptance criteria, code_paths) from YAML spec (WU-2157)
 */
async function loadWuMetadata(baseDir: string, wuId: string): Promise<WuMetadata | null> {
  const wuYamlPath = path.join(baseDir, 'docs', '04-operations', 'tasks', 'wu', `${wuId}.yaml`);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const content = await fs.readFile(wuYamlPath, 'utf-8');
    const doc = parseYaml(content) as Record<string, unknown>;

    const acceptance = Array.isArray(doc.acceptance)
      ? (doc.acceptance as string[]).filter((s) => typeof s === 'string')
      : [];
    const codePaths = Array.isArray(doc.code_paths)
      ? (doc.code_paths as string[]).filter((s) => typeof s === 'string')
      : [];

    if (acceptance.length === 0 && codePaths.length === 0) {
      return null;
    }

    return { acceptance, codePaths };
  } catch {
    return null;
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
  wuMetadata: WuMetadata | null,
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

  // WU metadata sections (WU-2157)
  // Limit items to prevent large WU specs from consuming the entire size budget
  const acceptanceItems = wuMetadata?.acceptance.slice(0, MAX_ACCEPTANCE_ITEMS) ?? [];
  const acceptanceTruncated = (wuMetadata?.acceptance.length ?? 0) > MAX_ACCEPTANCE_ITEMS;
  const acceptanceSection =
    acceptanceItems.length > 0
      ? `## ${SECTION_HEADERS.ACCEPTANCE_CRITERIA}
${acceptanceItems.map((ac) => `- [ ] ${ac}`).join('\n')}${acceptanceTruncated ? `\n- ... (${(wuMetadata?.acceptance.length ?? 0) - MAX_ACCEPTANCE_ITEMS} more — run wu:brief for full list)` : ''}

`
      : '';

  const codePathItems = wuMetadata?.codePaths.slice(0, MAX_CODE_PATH_ITEMS) ?? [];
  const codePathsTruncated = (wuMetadata?.codePaths.length ?? 0) > MAX_CODE_PATH_ITEMS;
  const codePathsSection =
    codePathItems.length > 0
      ? `## ${SECTION_HEADERS.CODE_PATHS}
${codePathItems.map((cp) => `- ${cp}`).join('\n')}${codePathsTruncated ? `\n- ... (${(wuMetadata?.codePaths.length ?? 0) - MAX_CODE_PATH_ITEMS} more)` : ''}

`
      : '';

  // Git diff stat from checkpoint metadata (WU-2157)
  const gitDiffSection = checkpoint?.gitDiffStat
    ? `## ${SECTION_HEADERS.FILES_CHANGED}
\`\`\`
${checkpoint.gitDiffStat}
\`\`\`

`
    : '';

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
Continue working on the WU using the acceptance criteria and code paths above.
If you need full context: \`pnpm wu:brief --id ${wuId}\`
`;

  // Build sections in priority order
  // Priority: header > checkpoint > WU metadata > git diff > constraints > CLI > footer
  // WU metadata placed before constraints so agent sees acceptance first (WU-2157)
  const fixedContent =
    header +
    acceptanceSection +
    codePathsSection +
    gitDiffSection +
    constraintsSection +
    cliSection +
    footer;
  const fixedSize = Buffer.byteLength(fixedContent, 'utf-8');

  if (fixedSize > maxSize) {
    // Even fixed content exceeds budget - return minimal recovery
    const minimal = `# ${SECTION_HEADERS.RECOVERY_TITLE}
WU: ${wuId}
Run: pnpm wu:brief --id ${wuId}
`;
    return { context: minimal, truncated: true };
  }

  const remainingBudget = maxSize - fixedSize;
  const checkpointSize = Buffer.byteLength(checkpointSection, 'utf-8');

  if (checkpointSize <= remainingBudget) {
    // Full checkpoint fits
    const fullContext =
      header +
      checkpointSection +
      acceptanceSection +
      codePathsSection +
      gitDiffSection +
      constraintsSection +
      cliSection +
      footer;
    return { context: fullContext, truncated: false };
  }

  // Truncate checkpoint to fit
  const truncatedCheckpoint = `## ${SECTION_HEADERS.LAST_CHECKPOINT}
- **Progress:** (truncated - run mem:ready --wu ${wuId} for details)
- **Timestamp:** ${checkpoint?.timestamp ?? TIMESTAMP_UNKNOWN}

`;

  const context =
    header +
    truncatedCheckpoint +
    acceptanceSection +
    codePathsSection +
    gitDiffSection +
    constraintsSection +
    cliSection +
    footer;
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
 *   maxSize: 8192,
 *   includeWuMetadata: true,
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
    includeWuMetadata = true,
  } = options;

  // Validate WU ID
  validateWuId(wuId);

  // Load checkpoint from memory
  const checkpoint = await getLastCheckpoint(baseDir, wuId);

  // Load constraints (or use empty if disabled)
  const constraints = includeConstraints ? await loadCompactConstraints(baseDir) : '';

  // Get CLI reference (or empty if disabled)
  const cliRef = includeCLIRef ? ESSENTIAL_CLI_COMMANDS : '';

  // Load WU metadata (acceptance criteria, code_paths) from YAML (WU-2157)
  const wuMetadata = includeWuMetadata ? await loadWuMetadata(baseDir, wuId) : null;

  // Format with size budget
  const { context, truncated } = formatRecoveryPrompt(
    wuId,
    checkpoint,
    constraints,
    cliRef,
    wuMetadata,
    maxSize,
  );

  return {
    success: true,
    context,
    size: Buffer.byteLength(context, 'utf-8'),
    truncated,
  };
}
