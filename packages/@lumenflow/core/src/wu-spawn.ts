#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Spawn - Thin Facade (WU-2012)
 *
 * Generates ready-to-use Task tool invocations for sub-agent WU execution.
 *
 * This file serves as the public API facade and CLI entry point.
 * All implementation is delegated to focused modules:
 *
 * - spawn-template-assembler.ts: Template loading, context building, constants
 * - spawn-guidance-generators.ts: Test methodology and architecture guidance
 * - spawn-policy-resolver.ts: Mandatory standards, enforcement summary, telemetry
 * - spawn-constraints-generator.ts: Constraints block generation
 * - spawn-prompt-helpers.ts: WU doc formatting helpers (acceptance, invariants, agents)
 * - spawn-agent-guidance.ts: Agent operational guidance sections
 * - spawn-task-builder.ts: Task invocation, Codex prompt assembly, lane occupation
 *
 * Existing helper modules (pre-WU-2012):
 * - wu-spawn-helpers.ts: Thinking mode, spawn registry
 * - wu-spawn-skills.ts: Skills selection and client config
 * - wu-spawn-context.ts: Memory context integration
 *
 * @module wu-spawn
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWUParser, WU_OPTIONS } from './arg-parser.js';
import { WU_PATHS } from './wu-paths.js';
import { parseYAML } from './wu-yaml.js';
import { die, getErrorMessage } from './error-handler.js';
import { WU_STATUS, PATTERNS, EMOJI, LUMENFLOW_PATHS } from './wu-constants.js';
import { SpawnStrategyFactory } from './spawn-strategy.js';
import { getConfig } from './lumenflow-config.js';
import { resolvePolicy } from './resolve-policy.js';
import { validateSpawnDependencies, formatDependencyError } from './dependency-validator.js';
import {
  validateSpawnArgs,
  recordSpawnToRegistry,
  formatSpawnRecordedMessage,
} from './wu-spawn-helpers.js';
import { resolveClientConfig } from './wu-spawn-skills.js';

// ============================================================================
// Re-exports: Public API surface (zero breaking changes)
// ============================================================================

// From spawn-template-assembler
export {
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
  tryAssembleSpawnTemplates,
  buildTemplateContext,
  buildTemplateContextWithPolicy,
} from './spawn-template-assembler.js';

// From spawn-guidance-generators
export {
  generateTestGuidance,
  generatePolicyBasedTestGuidance,
  generatePolicyBasedArchitectureGuidance,
  generateDesignContextSection,
} from './spawn-guidance-generators.js';
export type { TestGuidanceOptions } from './spawn-guidance-generators.js';

// From spawn-policy-resolver
export {
  generateMandatoryStandards,
  generateEnforcementSummary,
  emitMethodologyTelemetry,
} from './spawn-policy-resolver.js';

// From spawn-guidance-generators (worktree recovery guidance)
export { generateWorktreeBlockRecoverySection } from './spawn-guidance-generators.js';

// From spawn-agent-guidance (agent operational guidance)
export {
  generateEffortScalingRules,
  generateParallelToolCallGuidance,
  generateIterativeSearchHeuristics,
  generateTokenBudgetAwareness,
  generateCompletionFormat,
  generateAgentCoordinationSection,
  generateQuickFixCommands,
  generateLaneSelectionSection,
  generateWorktreePathGuidance,
  generateActionSection,
} from './spawn-agent-guidance.js';

// From spawn-task-builder (WU-2048: inlined spawn-lane-occupation re-exports)
export {
  generateTaskInvocation,
  generateCodexPrompt,
  checkLaneOccupation,
  generateLaneOccupationWarning,
} from './spawn-task-builder.js';
export type { SpawnOptions } from './spawn-task-builder.js';

// ============================================================================
// CLI Entry Point
// ============================================================================

interface SpawnCliArgs {
  id: string;
  codex?: boolean;
  thinking?: boolean;
  noThinking?: boolean;
  budget?: string;
  parentWu?: string;
  client?: string;
  vendor?: string;
  noContext?: boolean;
}

type SpawnParserOption = NonNullable<(typeof WU_OPTIONS)[keyof typeof WU_OPTIONS]>;

const LOG_PREFIX = '[wu:spawn]';

/**
 * Main CLI entry point
 */
async function main() {
  // WU-2202: Validate dependencies BEFORE any other operation
  const depResult = await validateSpawnDependencies();
  if (!depResult.valid) {
    die(formatDependencyError('wu:spawn', depResult.missing));
  }

  const args = createWUParser({
    name: 'wu-spawn',
    description: 'Generate Task tool invocation for sub-agent WU execution',
    // WU-2044: Removed duplicate CLI options (copy-paste bug)
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.thinking,
      WU_OPTIONS.noThinking,
      WU_OPTIONS.budget,
      WU_OPTIONS.codex,
      WU_OPTIONS.parentWu,
      WU_OPTIONS.client,
      WU_OPTIONS.vendor,
    ].filter((option): option is SpawnParserOption => option !== undefined),
    required: ['id'],
    allowPositionalId: true,
  }) as SpawnCliArgs;

  // Validate thinking mode options
  try {
    validateSpawnArgs(args);
  } catch (e: unknown) {
    die(getErrorMessage(e));
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU id '${args.id}'. Expected format WU-123`);
  }

  const WU_PATH = WU_PATHS.WU(id);

  // Check if WU file exists
  if (!existsSync(WU_PATH)) {
    die(
      `WU file not found: ${WU_PATH}\n\n` +
        `Cannot spawn a sub-agent for a WU that doesn't exist.\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane <lane> --title "..."\n` +
        `  2. Check if the WU ID is correct`,
    );
  }

  // Read and parse WU YAML
  let doc;
  let text;
  try {
    text = readFileSync(WU_PATH, { encoding: 'utf-8' });
  } catch (e: unknown) {
    die(
      `Failed to read WU file: ${WU_PATH}\n\n` +
        `Error: ${getErrorMessage(e)}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${WU_PATH}\n` +
        `  2. Ensure the file exists and is readable`,
    );
  }
  try {
    doc = parseYAML(text);
  } catch (e: unknown) {
    die(
      `Failed to parse WU YAML ${WU_PATH}\n\n` +
        `Error: ${getErrorMessage(e)}\n\n` +
        `Options:\n` +
        `  1. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  2. Fix YAML errors manually and retry`,
    );
  }

  // Warn if WU is not in ready or in_progress status
  const validStatuses = [WU_STATUS.READY, WU_STATUS.IN_PROGRESS];
  if (!validStatuses.includes(doc.status as string)) {
    console.warn(`${LOG_PREFIX} ${EMOJI.WARNING} Warning: ${id} has status '${doc.status}'.`);
    console.warn(
      `${LOG_PREFIX} ${EMOJI.WARNING} Sub-agents typically work on ready or in_progress WUs.`,
    );
    console.warn('');
  }

  // WU-1603: Check if lane is already occupied and warn
  const { checkLaneOccupation: checkOccupation } = await import('./spawn-task-builder.js');
  const { generateLaneOccupationWarning: generateWarning } =
    await import('./spawn-task-builder.js');
  const lane = doc.lane as string | undefined;
  if (lane) {
    const existingLock = checkOccupation(lane);
    if (existingLock && existingLock.wuId !== id) {
      const { isLockStale } = await import('./lane-lock.js');
      const isStale = isLockStale(existingLock);
      const warning = generateWarning(existingLock, id, { isStale });
      console.warn(`${LOG_PREFIX} ${EMOJI.WARNING}\n${warning}\n`);
    }
  }

  // Build thinking mode options for task invocation
  const thinkingOptions = {
    thinking: args.thinking,
    noThinking: args.noThinking,
    budget: args.budget,
  };

  // Client Resolution
  const config = getConfig();
  let clientName = args.client;

  if (!clientName && args.vendor) {
    console.warn(`${LOG_PREFIX} ${EMOJI.WARNING} Warning: --vendor is deprecated. Use --client.`);
    clientName = args.vendor;
  }

  // Codex handling (deprecated legacy flag)
  if (args.codex) {
    if (!clientName) {
      console.warn(
        `${LOG_PREFIX} ${EMOJI.WARNING} Warning: --codex is deprecated. Use --client codex-cli.`,
      );
      clientName = 'codex-cli';
    }
  }

  if (!clientName) {
    clientName = config.agents.defaultClient || 'claude-code';
  }

  // Create strategy
  const strategy = SpawnStrategyFactory.create(clientName);
  const clientContext = { name: clientName, config: resolveClientConfig(config, clientName) };

  // Import task builders
  const { generateTaskInvocation: buildTaskInvocation, generateCodexPrompt: buildCodexPrompt } =
    await import('./spawn-task-builder.js');

  if (clientName === 'codex-cli' || args.codex) {
    const _prompt = buildCodexPrompt(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });
    console.log(`${LOG_PREFIX} Generated Codex/GPT prompt for ${id}`);
    console.log(`${LOG_PREFIX} Copy the Markdown below:\n`);
    // ...

    // Generate and output the Task invocation
    const invocation = buildTaskInvocation(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });

    console.log(`${LOG_PREFIX} Generated Task tool invocation for ${id}`);
    console.log(`${LOG_PREFIX} Copy the block below to spawn a sub-agent:\n`);
    console.log(invocation);

    // WU-1270: Emit methodology telemetry (opt-in only)
    const { emitMethodologyTelemetry: emitTelemetry } = await import('./spawn-policy-resolver.js');
    const policy = resolvePolicy(config);
    emitTelemetry(config, policy);

    // WU-1945: Record spawn event to registry (non-blocking)
    if (args.parentWu) {
      const registryResult = await recordSpawnToRegistry({
        parentWuId: args.parentWu,
        targetWuId: id,
        lane: doc.lane || 'Unknown',
        baseDir: LUMENFLOW_PATHS.STATE_DIR,
      });

      const registryMessage = formatSpawnRecordedMessage(
        registryResult.spawnId,
        registryResult.error,
      );
      console.log(`\n${registryMessage}`);
    }
  }
}

// Guard main() for testability
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
