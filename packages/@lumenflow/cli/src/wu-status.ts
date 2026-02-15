#!/usr/bin/env node
/**
 * WU Status Command
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Shows:
 * - Current location (main checkout vs worktree)
 * - WU state if in worktree or --id provided
 * - Git state (branch, dirty, ahead/behind)
 * - Valid commands for current context
 *
 * Usage:
 *   pnpm wu:status              # Auto-detect from current directory
 *   pnpm wu:status --id WU-123  # Show status for specific WU
 */

import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { computeContext } from '@lumenflow/core/context/index';
import { getValidCommandsForContext } from '@lumenflow/core/validation/command-registry';
import { CONTEXT_VALIDATION, EMOJI } from '@lumenflow/core/wu-constants';
import type { WuContext } from '@lumenflow/core/validation/types';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;
const LOG_PREFIX = '[wu:status]';

/**
 * Format location type for display
 */
function formatLocationType(type: string): string {
  switch (type) {
    case LOCATION_TYPES.MAIN:
      return 'main checkout';
    case LOCATION_TYPES.WORKTREE:
      return 'worktree';
    case LOCATION_TYPES.DETACHED:
      return 'detached HEAD';
    default:
      return 'unknown location';
  }
}

/**
 * Format git state for display
 */
function formatGitState(context: WuContext): string[] {
  const lines: string[] = [];
  const { git } = context;

  if (git.hasError) {
    lines.push(`  ${EMOJI.FAILURE} Git error: ${git.errorMessage}`);
    return lines;
  }

  const branchInfo = git.branch || '(detached)';
  lines.push(`  Branch: ${branchInfo}`);

  if (git.isDirty) {
    lines.push(`  ${EMOJI.WARNING} Working tree: dirty (${git.modifiedFiles.length} files)`);
  } else {
    lines.push(`  ${EMOJI.SUCCESS} Working tree: clean`);
  }

  if (git.hasStaged) {
    lines.push(`  Staged: yes`);
  }

  if (git.ahead > 0 || git.behind > 0) {
    const parts: string[] = [];
    if (git.ahead > 0) parts.push(`${git.ahead} ahead`);
    if (git.behind > 0) parts.push(`${git.behind} behind`);
    lines.push(`  Tracking: ${parts.join(', ')}`);
  }

  return lines;
}

/**
 * Format WU state for display
 */
function formatWuState(context: WuContext): string[] {
  const lines: string[] = [];
  const { wu } = context;

  if (!wu) {
    lines.push(`  No WU context`);
    return lines;
  }

  lines.push(`  ID: ${wu.id}`);
  lines.push(`  Title: ${wu.title}`);
  lines.push(`  Lane: ${wu.lane}`);
  lines.push(`  Status: ${wu.status}`);

  // WU-1683: Surface linked plan file path
  if (wu.plan) {
    lines.push(`  Plan: ${wu.plan}`);
  }

  if (!wu.isConsistent) {
    lines.push(`  ${EMOJI.WARNING} State inconsistency: ${wu.inconsistencyReason}`);
  }

  return lines;
}

/**
 * Format valid commands for display
 */
function formatValidCommands(context: WuContext): string[] {
  const lines: string[] = [];
  const validCommands = getValidCommandsForContext(context);

  if (validCommands.length === 0) {
    lines.push(`  No commands available for current context`);
    return lines;
  }

  for (const cmd of validCommands) {
    lines.push(`  ${cmd.name} - ${cmd.description}`);
  }

  return lines;
}

/**
 * Format complete status output
 */
export function formatStatusOutput(context: WuContext): string {
  const lines: string[] = [];

  // Location section
  lines.push('## Location');
  lines.push(`  Type: ${formatLocationType(context.location.type)}`);
  lines.push(`  Path: ${context.location.cwd}`);
  if (context.location.worktreeName) {
    lines.push(`  Worktree: ${context.location.worktreeName}`);
  }
  if (context.location.worktreeWuId) {
    lines.push(`  WU ID: ${context.location.worktreeWuId}`);
  }
  lines.push('');

  // Git section
  lines.push('## Git State');
  lines.push(...formatGitState(context));
  lines.push('');

  // WU section
  lines.push('## WU State');
  lines.push(...formatWuState(context));
  lines.push('');

  // Valid commands section
  lines.push('## Valid Commands');
  lines.push(...formatValidCommands(context));

  return lines.join('\n');
}

/**
 * Get exit code based on context state
 */
export function getStatusExitCode(context: WuContext): number {
  // Error if git has errors
  if (context.git.hasError) {
    return 1;
  }

  // Error if location is unknown
  if (context.location.type === LOCATION_TYPES.UNKNOWN) {
    return 1;
  }

  return 0;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = createWUParser({
    name: 'wu-status',
    description: 'Show WU status, location, and valid commands (WU-1090)',
    options: [
      { ...WU_OPTIONS.id, required: false },
      {
        name: 'json',
        flags: '-j, --json',
        type: 'boolean',
        description: 'Output as JSON',
      },
    ],
    required: [],
    allowPositionalId: true,
  });

  const { id, json } = args as { id?: string; json?: boolean };

  // Compute context
  const { context, computationMs, exceededBudget } = await computeContext({
    wuId: id,
  });

  if (exceededBudget) {
    console.warn(
      `${LOG_PREFIX} ${EMOJI.WARNING} Context computation took ${computationMs.toFixed(0)}ms (exceeded 100ms budget)`,
    );
  }

  // Output
  if (json) {
    console.log(JSON.stringify(context, null, 2));
  } else {
    console.log(formatStatusOutput(context));
  }

  // Exit with appropriate code
  process.exit(getStatusExitCode(context));
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
