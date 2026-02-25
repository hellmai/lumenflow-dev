#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Prompt Helper
 *
 * Generates ready-to-use handoff prompts for sub-agent WU execution.
 * Includes context loading preamble, skills selection guidance, and constraints block.
 *
 * Usage:
 *   pnpm wu:brief --id WU-123
 *   pnpm wu:brief --id WU-123 --codex
 *   pnpm wu:delegate --id WU-123 --parent-wu WU-100
 *
 * Output:
 *   A complete Task tool invocation block with:
 *   - Context loading preamble (.claude/CLAUDE.md, README, lumenflow, WU YAML)
 *   - WU details and acceptance criteria
 *   - Skills Selection section (sub-agent reads catalogue and selects at runtime)
 *   - Mandatory agent advisory
 *   - Constraints block at end (Lost in the Middle research)
 *
 * Skills Selection:
 *   This command is AGENT-FACING. Unlike /wu-prompt (human-facing, skills selected
 *   at generation time), wu:brief instructs the sub-agent to read the skill catalogue
 *   and select skills at execution time based on WU context.
 *
 * Codex Mode:
 *   When --codex is used, outputs a Codex/GPT-friendly Markdown prompt (no antml/XML escaping).
 *
 * Architecture (WU-1652):
 *   This file is a facade that re-exports from:
 *   - wu-spawn-prompt-builders.ts: All prompt section generators, formatters, template helpers
 *   - wu-spawn-strategy-resolver.ts: Client/strategy resolution, lane checks, CLI orchestration
 *
 * @see {@link https://lumenflow.dev/reference/agent-invocation-guide/} - Context loading templates
 */

import { die } from '@lumenflow/core/error-handler';

// ─── Re-exports from prompt builders ───
export {
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
  generateTestGuidance,
  generateAgentCoordinationSection,
  generateTaskInvocation,
  generateCodexPrompt,
  generateEffortScalingRules,
  generateParallelToolCallGuidance,
  generateIterativeSearchHeuristics,
  generateTokenBudgetAwareness,
  generateCompletionFormat,
  generateQuickFixCommands,
  generateWorktreeBlockRecoverySection,
  generateLaneSelectionSection,
  generateWorktreePathGuidance,
  generateActionSection,
  generateCompletionWorkflowSection,
} from './wu-spawn-prompt-builders.js';

// ─── Re-exports from strategy resolver ───
export {
  checkLaneOccupation,
  generateLaneOccupationWarning,
  emitSpawnOutputWithRegistry,
  recordWuBriefEvidence,
  runBriefLogic,
} from './wu-spawn-strategy-resolver.js';

// ─── Re-export types ───
export type { RunBriefOptions } from './wu-spawn-strategy-resolver.js';

/**
 * Main entry point for removed wu:spawn command.
 *
 * WU-1617: command removed in favor of explicit wu:brief and wu:delegate.
 */
async function main(): Promise<void> {
  const removalGuidance =
    'wu:spawn has been removed. Use wu:brief for config-aware prompt generation or ' +
    'wu:delegate for explicit delegation lineage.';
  die(removalGuidance);
}

// Guard main() for testability (WU-1366)
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
