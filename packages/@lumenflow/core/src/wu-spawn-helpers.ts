// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-spawn-helpers.ts
 * Helper functions for wu:spawn thinking mode and model configuration (WU-1577)
 *
 * Provides:
 * - CLI argument parsing for thinking mode options
 * - Validation for thinking/budget options
 * - Execution Mode section generation
 * - Think tool guidance generation
 * - Help text generation
 * - Spawn registry integration (WU-1945)
 */

import { Command } from 'commander';
import { DelegationRegistryStore } from './delegation-registry-store.js';
import { ProcessExitError, createError, ErrorCodes } from './error-handler.js';
import { EXIT_CODES, LUMENFLOW_PATHS } from './wu-constants.js';

/**
 * Option definitions for thinking mode configuration.
 *
 * Note: Commander.js handles --no-thinking automatically as a negation of --thinking.
 * When --no-thinking is used, opts.thinking is set to false.
 * We detect this and convert to noThinking: true for clarity.
 */
export const THINKING_OPTIONS = {
  thinking: {
    name: 'thinking',
    flags: '--thinking',
    description: 'Enable extended thinking for complex WU execution',
  },
  budget: {
    name: 'budget',
    flags: '--budget <tokens>',
    description: 'Token budget for extended thinking (requires --thinking)',
  },
};

/**
 * Parse spawn-specific arguments from argv.
 *
 * @param {string[]} argv - Process arguments
 * @returns {object} Parsed arguments with thinking options
 */
export function parseSpawnArgs(argv: UnsafeAny) {
  const program = new Command()
    .name('wu-spawn')
    .description('Generate Task tool invocation for sub-agent WU execution')
    .allowUnknownOption(true)
    .allowExcessArguments(true) // Allow positional WU ID argument
    .exitOverride();

  // Core options
  program.option('-i, --id <wuId>', 'Work Unit ID (e.g., WU-123)');

  // Thinking mode options
  // Commander automatically creates --no-thinking when --thinking is registered
  program.option(THINKING_OPTIONS.thinking.flags, THINKING_OPTIONS.thinking.description);
  program.option(THINKING_OPTIONS.budget.flags, THINKING_OPTIONS.budget.description);

  try {
    program.parse(argv);
  } catch (err) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      throw new ProcessExitError('Help displayed', EXIT_CODES.SUCCESS);
    }
    throw err;
  }

  const opts = program.opts();

  // Handle positional argument as WU ID fallback
  if (program.args.length > 0 && !opts.id) {
    opts.id = program.args[0];
  }

  // Handle --no-thinking explicitly
  // Check the argv array directly since Commander's handling of negated booleans varies
  if (argv.includes('--no-thinking')) {
    opts.noThinking = true;
    delete opts.thinking;
  }

  return opts;
}

/**
 * Validate spawn arguments for consistency.
 *
 * @param {object} args - Parsed arguments
 * @throws {Error} If validation fails
 */
export function validateSpawnArgs(args: UnsafeAny) {
  // Check mutually exclusive flags
  if (args.thinking && args.noThinking) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      '--thinking and --no-thinking are mutually exclusive',
    );
  }

  // Budget requires thinking
  if (args.budget && !args.thinking) {
    throw createError(ErrorCodes.INVALID_ARGUMENT, '--budget requires --thinking flag');
  }

  // Budget must be positive integer
  if (args.budget) {
    const budgetNum = parseInt(args.budget, 10);
    if (isNaN(budgetNum) || budgetNum <= 0 || !Number.isInteger(budgetNum)) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, '--budget must be a positive integer');
    }
  }
}

/**
 * Generate the Execution Mode section for the task prompt.
 *
 * @param {object} options - Thinking mode options
 * @param {boolean} [options.thinking] - Whether extended thinking is enabled
 * @param {boolean} [options.noThinking] - Whether thinking is explicitly disabled
 * @param {string} [options.budget] - Token budget for thinking
 * @returns {string} Execution Mode section or empty string if no thinking flags
 */
export function generateExecutionModeSection(options: UnsafeAny) {
  const { thinking, noThinking, budget } = options;

  // No section if no thinking flags specified (default behavior)
  if (!thinking && !noThinking) {
    return '';
  }

  const lines = ['## Execution Mode', ''];

  if (thinking) {
    lines.push('Extended thinking: **enabled**');
    if (budget) {
      lines.push(`Token budget: **${budget}**`);
    }
    lines.push('');
    lines.push('The sub-agent will use extended thinking for complex reasoning tasks.');
  } else if (noThinking) {
    lines.push('Extended thinking: **disabled**');
    lines.push('');
    lines.push('The sub-agent will execute without extended thinking mode.');
  }

  return lines.join('\n');
}

/**
 * Generate think tool guidance for the task prompt.
 *
 * @param {object} options - Thinking mode options
 * @param {boolean} [options.thinking] - Whether extended thinking is enabled
 * @param {boolean} [options.noThinking] - Whether thinking is explicitly disabled
 * @returns {string} Think tool guidance or empty string if not applicable
 */
export function generateThinkToolGuidance(options: UnsafeAny) {
  const { thinking, noThinking } = options;

  // No guidance if thinking is disabled or not specified
  if (!thinking || noThinking) {
    return '';
  }

  return `## Think Tool Guidance

When extended thinking is enabled, use the think tool strategically for:

1. **Complex Decision Points**: Before making architectural decisions or choosing between approaches
2. **Multi-Step Reasoning**: When planning long tool-call chains or multi-file edits
3. **Mid-Execution Reflection**: After gathering information, before implementing changes
4. **Error Analysis**: When troubleshooting failures or unexpected behavior

### Best Practices

- Use think blocks to reason through acceptance criteria before implementation
- Document your reasoning for complex logic decisions
- Break down large tasks into thought-through steps
- Reflect on test results before proceeding with fixes

### When NOT to Use Think Blocks

- Simple file reads or writes with clear outcomes
- Routine git operations
- Running predefined commands like \`pnpm gates\`
- When the next action is obvious and low-risk`;
}

/**
 * Generate help text with examples for thinking mode options.
 *
 * @returns {string} Help text with option descriptions and examples
 */
export function getHelpText() {
  return `
Thinking Mode Options:

  --thinking          Enable extended thinking for complex WU execution
  --no-thinking       Explicitly disable extended thinking (default behavior)
  --budget <tokens>   Token budget for extended thinking (requires --thinking)

Examples:

  # Enable extended thinking for a complex WU
  pnpm wu:spawn --id WU-123 --thinking

  # Enable thinking with a specific token budget
  pnpm wu:spawn --id WU-456 --thinking --budget 10000

  # Explicitly disable thinking (useful for clear-spec WUs)
  pnpm wu:spawn --id WU-789 --no-thinking

Notes:

  - Default behavior (no flags) preserves backward compatibility
  - --budget requires --thinking flag to be set
  - --thinking and --no-thinking are mutually exclusive
  - Token budget is passed to the sub-agent's execution configuration
`;
}

/**
 * Log prefix for spawn registry messages (WU-1945)
 */
const LOG_PREFIX = '[wu:spawn]';

/**
 * Records a spawn event to the spawn registry.
 *
 * This function is non-blocking: if the registry write fails, it returns
 * a result with success=false but does NOT throw an error. This ensures
 * wu:spawn succeeds even if the registry is unavailable.
 *
 * @param {object} options - Spawn recording options
 * @param {string} options.parentWuId - Parent WU ID (orchestrator)
 * @param {string} options.targetWuId - Target WU ID (spawned work)
 * @param {string} options.lane - Lane for the spawned work
 * @param {string} [options.baseDir] - Base directory for registry (defaults to LUMENFLOW_PATHS.STATE_DIR)
 * @returns {Promise<{success: boolean, spawnId: string|null, error?: string}>}
 *
 * @example
 * const result = await recordSpawnToRegistry({
 *   parentWuId: 'WU-1000',
 *   targetWuId: 'WU-1001',
 *   lane: 'Operations: Tooling',
 * });
 *
 * if (result.success) {
 *   console.log(`Recorded: ${result.spawnId}`);
 * }
 */
export async function recordSpawnToRegistry(options: UnsafeAny) {
  const { parentWuId, targetWuId, lane, baseDir = LUMENFLOW_PATHS.STATE_DIR } = options;

  try {
    const store = new DelegationRegistryStore(baseDir);
    await store.load();

    const spawnId = await store.record(parentWuId, targetWuId, lane);

    return {
      success: true,
      spawnId,
    };
  } catch (error) {
    // Non-blocking: return failure result instead of throwing
    return {
      success: false,
      spawnId: null,
      error: error.message,
    };
  }
}

/**
 * Formats a message about spawn recording result.
 *
 * @param {string|null} spawnId - Spawn ID if successful, null otherwise
 * @param {string} [errorMessage] - Error message if spawn recording failed
 * @returns {string} Formatted message for console output
 *
 * @example
 * // Successful recording
 * formatSpawnRecordedMessage('spawn-abc1');
 * // Returns: '[wu:spawn] Spawn recorded spawn-abc1'
 *
 * // Failed recording
 * formatSpawnRecordedMessage(null, 'Registry unavailable');
 * // Returns: '[wu:spawn] Warning: Registry write skipped (Registry unavailable)'
 */
export function formatSpawnRecordedMessage(spawnId: UnsafeAny, errorMessage = undefined) {
  if (spawnId) {
    return `${LOG_PREFIX} Spawn recorded ${spawnId}`;
  }

  if (errorMessage) {
    return `${LOG_PREFIX} Warning: Registry write skipped (${errorMessage})`;
  }

  return `${LOG_PREFIX} Warning: Registry unavailable`;
}
