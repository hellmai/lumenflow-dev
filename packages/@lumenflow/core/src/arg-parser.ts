// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { Command, type OptionValues } from 'commander';
import { createError, ErrorCodes, ProcessExitError } from './error-handler.js';
import { EXIT_CODES } from './wu-constants.js';

/**
 * Collector function for Commander.js repeatable options.
 * Accumulates multiple flag values into an array.
 *
 * Usage: --flag a --flag b → ['a', 'b']
 *
 * This follows Commander.js best practices - use repeatable pattern for
 * multi-value options. Do NOT split on commas here; that's a separate
 * pattern with different semantics (see Commander.js docs).
 *
 * @param {string} value - New value from CLI
 * @param {string[]} previous - Previously accumulated values
 * @returns {string[]} Updated array with new value appended
 * @see https://github.com/tj/commander.js#custom-option-processing
 */
function collectRepeatable(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Predefined option configurations for WU management scripts.
 * Each option has: name, flags, description, and optional default.
 *
 * Commander auto-converts kebab-case flags to camelCase in opts().
 * Example: --branch-only becomes opts().branchOnly
 *
 * NOTE: Commander treats --no-* flags specially (negated booleans).
 * --no-foo creates opts.foo = false (default true).
 * We post-process to convert these to noFoo = true for backward compat.
 */
/**
 * WU option definition structure
 */
interface WUOption {
  name: string;
  flags: string;
  description: string;
  default?: string | boolean | string[];
  isNegated?: boolean;
  isRepeatable?: boolean;
  /** Type hint for option parsing (e.g., 'boolean' for flags, 'string' for values) */
  type?: 'boolean' | 'string';
  /** Whether this option is required (used for validation hints) */
  required?: boolean;
}

export const WU_OPTIONS: Record<string, WUOption> = {
  // String options (require values)
  client: {
    name: 'client',
    flags: '--client <client>',
    description: 'Target client (e.g. claude-code, codex-cli, gemini-cli)',
  },
  vendor: {
    name: 'vendor',
    flags: '--vendor <vendor>',
    description: 'Deprecated alias for --client',
  },
  id: {
    name: 'id',
    flags: '-i, --id <wuId>',
    description: 'Work Unit ID (e.g., WU-123). If not provided, auto-generates next sequential ID.',
  },
  wu: {
    name: 'wu',
    flags: '--wu <wuId>',
    description: 'Work Unit ID to link (e.g., WU-123)',
  },
  lane: {
    name: 'lane',
    flags: '-l, --lane <lane>',
    description: 'Lane name (e.g., "Operations: Tooling")',
  },
  title: {
    name: 'title',
    flags: '-t, --title <title>',
    description: 'Work Unit title',
  },
  priority: {
    name: 'priority',
    flags: '-p, --priority <priority>',
    description: 'Priority level (P0, P1, P2, P3)',
  },
  type: {
    name: 'type',
    flags: '--type <type>',
    description: 'WU type (feature, bug, refactor, documentation)',
  },
  reason: {
    name: 'reason',
    flags: '-r, --reason <reason>',
    description: 'Reason for action (required with --skip-gates, --override-owner)',
  },
  worktree: {
    name: 'worktree',
    flags: '-w, --worktree <path>',
    description: 'Override worktree path',
  },
  branch: {
    name: 'branch',
    flags: '-b, --branch <branch>',
    description: 'Override branch name',
  },
  fixWu: {
    name: 'fixWu',
    flags: '--fix-wu <wuId>',
    description: 'WU ID that will fix the failures (required with --skip-gates)',
  },

  // Boolean options
  noAuto: {
    name: 'noAuto',
    flags: '--no-auto',
    description: 'Skip auto-updating YAML/backlog/status',
    isNegated: true, // Commander treats --no-* specially
  },
  force: {
    name: 'force',
    flags: '-f, --force',
    description: 'Force operation',
  },
  branchOnly: {
    name: 'branchOnly',
    flags: '--branch-only',
    description: 'Use branch-only mode (no worktree)',
  },
  prMode: {
    name: 'prMode',
    flags: '--pr-mode',
    description: 'Use PR mode (create PR instead of auto-merge)',
  },
  removeWorktree: {
    name: 'removeWorktree',
    flags: '--remove-worktree',
    description: 'Remove worktree when blocking',
  },
  createWorktree: {
    name: 'createWorktree',
    flags: '--create-worktree',
    description: 'Create worktree when unblocking',
  },
  deleteBranch: {
    name: 'deleteBranch',
    flags: '--delete-branch',
    description: 'Delete lane branch after merge',
  },
  noRemove: {
    name: 'noRemove',
    flags: '--no-remove',
    description: 'Skip worktree removal after completion',
    isNegated: true,
  },
  noMerge: {
    name: 'noMerge',
    flags: '--no-merge',
    description: 'Skip auto-merging lane branch to main',
    isNegated: true,
  },
  help: {
    name: 'help',
    flags: '-h, --help',
    description: 'Display help',
  },
  skipGates: {
    name: 'skipGates',
    flags: '--skip-gates',
    description: 'Skip gates check (requires --reason and --fix-wu)',
  },
  docsOnly: {
    name: 'docsOnly',
    flags: '--docs-only',
    description: 'Run docs-only gates (requires exposure: documentation or docs-only code_paths)',
  },
  allowTodo: {
    name: 'allowTodo',
    flags: '--allow-todo',
    description: 'Allow TODO comments in code',
  },
  skipExposureCheck: {
    name: 'skipExposureCheck',
    flags: '--skip-exposure-check',
    description: 'Skip exposure validation warnings (WU-1999)',
  },
  skipAccessibilityCheck: {
    name: 'skipAccessibilityCheck',
    flags: '--skip-accessibility-check',
    description: 'Skip UI feature accessibility validation (WU-2022, not recommended)',
  },
  allowIncomplete: {
    name: 'allowIncomplete',
    flags: '--allow-incomplete',
    description:
      'Allow claiming with incomplete spec (bypasses spec completeness, NOT schema errors)',
  },
  forceOverlap: {
    name: 'forceOverlap',
    flags: '--force-overlap',
    description: 'Force claiming despite overlap (requires --reason)',
  },
  fix: {
    name: 'fix',
    flags: '--fix',
    description: 'Auto-fix common YAML validation issues (WU-1359)',
  },
  noPush: {
    name: 'noPush',
    flags: '--no-push',
    description: 'Skip pushing claim branch or canonical updates (air-gapped/offline)',
    isNegated: true,
  },
  createPr: {
    name: 'createPr',
    flags: '--create-pr',
    description: 'Create PR instead of auto-merge',
  },
  prDraft: {
    name: 'prDraft',
    flags: '--pr-draft',
    description: 'Create PR as draft (use with --create-pr)',
  },
  overrideOwner: {
    name: 'overrideOwner',
    flags: '--override-owner',
    description: 'Override ownership check (requires --reason)',
  },
  noAutoRebase: {
    name: 'noAutoRebase',
    flags: '--no-auto-rebase',
    description: 'Disable auto-rebase on branch divergence (WU-1303)',
    isNegated: true,
  },

  // Initiative system options (WU-1247)
  initiative: {
    name: 'initiative',
    flags: '--initiative <ref>',
    description: 'Parent initiative (INIT-XXX or slug)',
  },
  phase: {
    name: 'phase',
    flags: '--phase <number>',
    description: 'Phase number within initiative',
  },
  blockedBy: {
    name: 'blockedBy',
    flags: '--blocked-by <wuIds>',
    description: 'WU IDs that block this WU (repeatable)',
    isRepeatable: true,
  },
  blocks: {
    name: 'blocks',
    flags: '--blocks <wuIds>',
    description: 'WU IDs this WU blocks (repeatable)',
    isRepeatable: true,
  },
  labels: {
    name: 'labels',
    flags: '--labels <labels>',
    description: 'Labels (repeatable)',
    isRepeatable: true,
  },
  slug: {
    name: 'slug',
    flags: '-s, --slug <slug>',
    description: 'Initiative slug (kebab-case)',
  },
  initId: {
    name: 'initId',
    flags: '--init-id <initId>',
    description: 'Initiative ID (e.g., INIT-001)',
  },
  owner: {
    name: 'owner',
    flags: '-o, --owner <owner>',
    description: 'Initiative owner (team or individual)',
  },
  targetDate: {
    name: 'targetDate',
    flags: '--target-date <date>',
    description: 'Target completion date (YYYY-MM-DD)',
  },
  format: {
    name: 'format',
    flags: '--format <format>',
    description: 'Output format (table, json, ascii, mermaid)',
  },
  color: {
    name: 'color',
    flags: '--color',
    description: 'Enable colored output',
  },
  // WU-1085: NO_COLOR standard support (https://no-color.org/)
  noColor: {
    name: 'noColor',
    flags: '--no-color',
    description: 'Disable colored output (respects NO_COLOR env var)',
    isNegated: true,
  },
  status: {
    name: 'status',
    flags: '--status <status>',
    description: 'Filter by status',
  },
  depth: {
    name: 'depth',
    flags: '-d, --depth <number>',
    description: 'Maximum traversal depth',
  },
  direction: {
    name: 'direction',
    flags: '--direction <dir>',
    description: 'Graph direction (up, down, both)',
  },
  assignedTo: {
    name: 'assignedTo',
    flags: '--assigned-to <email>',
    description: 'Override assigned_to (defaults to git config user.email)',
  },

  // Bulk tooling options (WU-1614)
  config: {
    name: 'config',
    flags: '--config <path>',
    description: 'Path to config file (tool-specific)',
  },
  apply: {
    name: 'apply',
    flags: '--apply',
    description: 'Apply changes (default is dry-run)',
  },
  syncFromInitiative: {
    name: 'syncFromInitiative',
    flags: '--sync-from-initiative',
    description: 'Ensure WU initiative fields exist for WUs listed in initiatives',
  },
  reconcileInitiative: {
    name: 'reconcileInitiative',
    flags: '--reconcile-initiative <initId>',
    description: 'Reconcile initiative `wus:` from WU initiative fields (repeatable)',
    isRepeatable: true,
  },

  // WU-1364: Full spec inline options for wu:create
  description: {
    name: 'description',
    flags: '--description <text>',
    description: 'WU description text (Context/Problem/Solution)',
  },
  acceptance: {
    name: 'acceptance',
    flags: '--acceptance <criterion>',
    description: 'Acceptance criterion (repeatable, use multiple times)',
    isRepeatable: true,
  },
  notes: {
    name: 'notes',
    flags: '--notes <text>',
    description: 'Implementation notes or context (optional)',
  },
  codePaths: {
    name: 'codePaths',
    flags: '--code-paths <paths>',
    description: 'Code paths (repeatable)',
    isRepeatable: true,
  },
  // WU-1300: Alias for --code-paths (singular form for convenience)
  codePath: {
    name: 'codePath',
    flags: '--code-path <path>',
    description: 'Alias for --code-paths (repeatable)',
    isRepeatable: true,
  },
  testPathsManual: {
    name: 'testPathsManual',
    flags: '--test-paths-manual <tests>',
    description: 'Manual test descriptions (repeatable)',
    isRepeatable: true,
  },
  // WU-1300: Alias for --test-paths-manual (shorter form for convenience)
  manualTest: {
    name: 'manualTest',
    flags: '--manual-test <test>',
    description: 'Alias for --test-paths-manual (repeatable)',
    isRepeatable: true,
  },
  testPathsUnit: {
    name: 'testPathsUnit',
    flags: '--test-paths-unit <paths>',
    description: 'Unit test file paths (repeatable)',
    isRepeatable: true,
  },
  testPathsE2e: {
    name: 'testPathsE2e',
    flags: '--test-paths-e2e <paths>',
    description: 'E2E test file paths (repeatable)',
    isRepeatable: true,
  },
  validate: {
    name: 'validate',
    flags: '--validate',
    description: 'Validate spec completeness (requires description, acceptance, test paths)',
  },

  // WU-2320: Spec reference for feature WUs
  specRefs: {
    name: 'specRefs',
    flags: '--spec-refs <paths>',
    description: 'Spec/plan references (repeatable or comma-separated, required for type: feature)',
    isRepeatable: true,
  },

  // WU-1998: Exposure field options
  exposure: {
    name: 'exposure',
    flags: '--exposure <type>',
    description: 'Exposure level (ui, api, backend-only, documentation)',
  },
  userJourney: {
    name: 'userJourney',
    flags: '--user-journey <text>',
    description: 'User journey description (recommended for ui/api exposure)',
  },
  uiPairingWus: {
    name: 'uiPairingWus',
    flags: '--ui-pairing-wus <wuIds>',
    description:
      'UI WU IDs that consume this API (repeatable or comma-separated, for api exposure)',
    isRepeatable: true,
  },

  // WU-1577: Thinking mode options for wu:spawn
  thinking: {
    name: 'thinking',
    flags: '--thinking',
    description: 'Enable extended thinking for sub-agent WU execution',
  },
  noThinking: {
    name: 'noThinking',
    flags: '--no-thinking',
    description: 'Explicitly disable extended thinking (default behavior)',
    isNegated: true,
  },
  budget: {
    name: 'budget',
    flags: '--budget <tokens>',
    description: 'Token budget for extended thinking (requires --thinking)',
  },

  // WU-1912: Codex/GPT-friendly output mode for wu:spawn
  codex: {
    name: 'codex',
    flags: '--codex',
    description: 'Deprecated: use --client codex-cli. Outputs Markdown prompt format.',
  },

  // WU-1945: Parent WU for spawn registry tracking
  parentWu: {
    name: 'parentWu',
    flags: '--parent-wu <wuId>',
    description: 'Parent WU ID for orchestrator context (e.g., WU-1000)',
  },

  // WU-1240: Skip memory context injection in handoff prompts
  noContext: {
    name: 'noContext',
    flags: '--no-context',
    description: 'Skip memory context injection in handoff prompts',
    isNegated: true,
  },

  // WU-1542: Mandatory agent enforcement for wu:done
  requireAgents: {
    name: 'requireAgents',
    flags: '--require-agents',
    description:
      'Block wu:done if mandatory agents (configured in MANDATORY_TRIGGERS) were not invoked for WUs touching their trigger paths',
  },

  // WU-2411: Agent handoff for crashed/killed agents
  resume: {
    name: 'resume',
    flags: '--resume',
    description:
      'Resume a WU from a crashed/killed agent (handoff) by taking over the existing worktree and updating the lock with new PID. Fails if original PID is still running (safety) or worktree does not exist.',
  },

  // WU-1491: Cloud mode for cloud agents and MCP callers
  cloud: {
    name: 'cloud',
    flags: '--cloud',
    description:
      'Use cloud/branch-pr mode (no worktree, PR-based completion for cloud agents and MCP callers)',
  },

  // WU-1023: Skip auto-setup for fast claims
  skipSetup: {
    name: 'skipSetup',
    flags: '--skip-setup',
    description:
      'Skip automatic pnpm install in worktree after creation (faster claims when deps already built)',
  },

  // WU-1329: Strict validation options
  // NOTE: --no-strict is the opt-out flag; strict is the default behavior
  noStrict: {
    name: 'noStrict',
    flags: '--no-strict',
    description:
      'Bypass strict validation (skip code_paths/test_paths existence checks, treat warnings as advisory). Logged when used.',
    isNegated: true,
  },

  // WU-2141: Strict sizing enforcement for wu:brief
  strictSizing: {
    name: 'strictSizing',
    flags: '--strict-sizing',
    description:
      'Block when sizing_estimate metadata is missing or exceeds thresholds without exception. Advisory by default.',
  },
};

/**
 * WU-1062: Additional options for wu:create command
 *
 * These options control how wu:create handles external plan storage.
 */
export const WU_CREATE_OPTIONS: Record<string, WUOption> = {
  /**
   * Create plan template in $LUMENFLOW_HOME/plans/
   * Stores plans externally for traceability without polluting the repo.
   */
  plan: {
    name: 'plan',
    flags: '--plan',
    description: 'Create plan template in $LUMENFLOW_HOME/plans/ (external plan storage)',
  },
};

/**
 * WU-1755: Additional options for initiative:create command.
 * These supplement WU_OPTIONS with initiative-specific repeatable fields.
 */
export const INITIATIVE_CREATE_OPTIONS: Record<string, WUOption> = {
  initDescription: {
    name: 'initDescription',
    flags: '--description <text>',
    description: 'Initiative description text',
  },
  initPhase: {
    name: 'initPhase',
    flags: '--phase <title>',
    description: 'Phase title (repeatable, e.g., --phase "Phase 1: Foundation")',
    isRepeatable: true,
  },
  successMetric: {
    name: 'successMetric',
    flags: '--success-metric <metric>',
    description: 'Success metric (repeatable)',
    isRepeatable: true,
  },
};

/**
 * Negated options that commander handles specially.
 * --no-foo creates opts.foo = false. We convert to noFoo = true.
 *
 * WU-1329: Export for testing purposes.
 */
export const NEGATED_OPTIONS = ['auto', 'remove', 'merge', 'autoRebase', 'push', 'strict'];

/**
 * Post-process commander opts to handle negated boolean options.
 * Commander's --no-* flags create opts.foo = false.
 * For backward compat, we convert to noFoo = true.
 *
 * @param {object} opts - Commander parsed options
 * @returns {object} Processed options with noFoo properties
 */
function processNegatedOptions(opts: Record<string, unknown>): Record<string, unknown> {
  // Build a new object, excluding keys that need removal
  // This avoids dynamic delete which violates @typescript-eslint/no-dynamic-delete
  const keysToRemove = new Set<string>();
  const keysToAdd: Record<string, boolean> = {};

  for (const key of NEGATED_OPTIONS) {
    // Commander sets the property to false when --no-foo is used
    // and undefined when not specified
    if (key in opts && opts[key] === false) {
      // Convert: auto=false → noAuto=true
      const camelKey = `no${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      keysToAdd[camelKey] = true;
      keysToRemove.add(key);
    } else if (key in opts && opts[key] === true) {
      // Default value (not negated) - remove it
      keysToRemove.add(key);
    }
  }

  // Build result by filtering out removed keys and adding new ones
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (!keysToRemove.has(key)) {
      result[key] = value;
    }
  }

  // Add the transformed keys
  return { ...result, ...keysToAdd };
}

function hasCustomVersionOption(options: WUOption[]): boolean {
  return options.some((option) => {
    const flagTokens = option.flags.split(',').map((token) => token.trim().split(/\s+/)[0]);
    return flagTokens.includes('--version');
  });
}

/**
 * Create a commander-based CLI parser for a WU script.
 *
 * @param {object} config - Parser configuration
 * @param {string} config.name - Script name (e.g., 'wu-claim')
 * @param {string} config.description - Script description for help text
 * @param {Array<object>} config.options - Array of option objects from WU_OPTIONS
 * @param {Array<string>} [config.required=[]] - Array of option names that are required
 * @param {boolean} [config.allowPositionalId=false] - Allow first positional arg as WU ID
 * @param {string} [config.version='1.0.0'] - Script version
 * @returns {object} Parsed options object (camelCase keys)
 *
 * @example
 * const opts = createWUParser({
 *   name: 'wu-claim',
 *   description: 'Claim a work unit for a lane',
 *   options: [WU_OPTIONS.id, WU_OPTIONS.lane, WU_OPTIONS.branchOnly],
 *   required: ['id', 'lane'],
 * });
 * console.log(opts.id); // 'WU-123'
 * console.log(opts.branchOnly); // true
 */
export function createWUParser(config: {
  name: string;
  description: string;
  options?: WUOption[];
  required?: string[];
  allowPositionalId?: boolean;
  version?: string;
}): OptionValues {
  const {
    name,
    description,
    options = [],
    required = [],
    allowPositionalId = false,
    version = '1.0.0',
  } = config;

  // Filter out pnpm's `--` separator from argv
  const filteredArgv = process.argv.filter((arg) => arg !== '--');
  const customVersionOptionEnabled = hasCustomVersionOption(options);

  const program = new Command()
    .name(name)
    .description(description)
    .allowExcessArguments(allowPositionalId) // Allow positional args if needed
    .exitOverride(); // Throw instead of process.exit for testability

  if (!customVersionOptionEnabled) {
    program.version(version);
  }

  // Register options
  for (const opt of options) {
    if (opt.isRepeatable) {
      // Repeatable options use collect function with empty array default
      // This allows: --flag "A" --flag "B" → ["A", "B"]
      program.option(opt.flags, opt.description, collectRepeatable, []);
    } else if (required.includes(opt.name)) {
      program.requiredOption(opt.flags, opt.description, opt.default);
    } else {
      program.option(opt.flags, opt.description, opt.default);
    }
  }

  try {
    program.parse(filteredArgv);
  } catch (err) {
    // Commander throws on help/version display.
    // Core modules throw typed exit errors; CLI entrypoints map them to process.exit().
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      throw new ProcessExitError('Help displayed', EXIT_CODES.SUCCESS);
    }
    // Commander throws on missing required options
    if (
      err.code === 'commander.missingMandatoryOptionValue' ||
      err.code === 'commander.missingArgument'
    ) {
      throw createError(ErrorCodes.VALIDATION_ERROR, err.message, {
        originalError: err.message,
        code: err.code,
      });
    }
    // Re-throw other errors
    throw err;
  }

  let opts = program.opts();

  // Process negated options for backward compat
  opts = processNegatedOptions(opts);

  // WU-1578: Handle --no-thinking explicitly via argv check
  // Commander's handling of negated booleans varies, so we check argv directly
  // when both --thinking and --no-thinking are registered as options
  if (filteredArgv.includes('--no-thinking')) {
    opts.noThinking = true;
    delete opts.thinking;
  }

  // Handle positional argument as WU ID fallback
  if (allowPositionalId && program.args.length > 0 && !opts.id) {
    opts.id = program.args[0];
  }

  // WU-1300: Merge CLI aliases into their canonical options
  opts = mergeAliasOptions(opts);

  return opts;
}

/**
 * WU-1300: Option alias mappings (alias -> canonical)
 * These allow users to use shorter/alternative flag names.
 */
const OPTION_ALIASES: Record<string, string> = {
  codePath: 'codePaths',
  manualTest: 'testPathsManual',
};

/**
 * WU-1300: Merge alias options into their canonical counterparts.
 * Supports both singular aliases (--code-path -> --code-paths)
 * and alternative names (--manual-test -> --test-paths-manual).
 *
 * For repeatable options, values are concatenated.
 * For single-value options, alias value is used if canonical is not set.
 *
 * @param {object} opts - Parsed options from Commander
 * @returns {object} Options with aliases merged into canonical names
 */
function mergeAliasOptions(opts: OptionValues): OptionValues {
  const result = { ...opts };

  for (const [alias, canonical] of Object.entries(OPTION_ALIASES)) {
    const aliasValue = result[alias];
    const canonicalValue = result[canonical];

    if (aliasValue !== undefined && aliasValue !== null) {
      // For arrays (repeatable options), concatenate
      if (Array.isArray(aliasValue)) {
        const existingArray = Array.isArray(canonicalValue) ? canonicalValue : [];
        result[canonical] = [...existingArray, ...aliasValue];
      } else if (canonicalValue === undefined || canonicalValue === null) {
        // For single values, only use alias if canonical not set
        result[canonical] = aliasValue;
      }

      // Remove the alias from results (clean output)
      // Build new result without the alias key to avoid dynamic delete
    }
  }

  // Remove alias keys from final result
  const finalResult: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (!(key in OPTION_ALIASES)) {
      finalResult[key] = value;
    }
  }

  return finalResult;
}

/**
 * Backward-compatible unified argument parser for WU management scripts.
 * Uses commander internally but maintains the same return format.
 *
 * @deprecated Use createWUParser() for new scripts to get better help text.
 *
 * @param {string[]} argv - Process arguments (typically process.argv)
 * @returns {object} Parsed arguments object (camelCase keys)
 * @throws {Error} If unknown flag or missing required value
 *
 * @example
 * const args = parseWUArgs(process.argv);
 * console.log(args.id); // 'WU-123'
 * console.log(args.branchOnly); // true
 */
export function parseWUArgs(argv: string[]): OptionValues {
  // Filter out pnpm's `--` separator before parsing
  const filteredArgv = argv.filter((arg) => arg !== '--');

  const program = new Command()
    .name('wu-script')
    .description('WU management script')
    .allowUnknownOption(false) // Strict mode - throw on unknown options
    .allowExcessArguments(true) // Allow positional arguments
    .exitOverride(); // Throw instead of process.exit

  // Register all options for backward compatibility
  const allOptions = [
    WU_OPTIONS.id,
    WU_OPTIONS.lane,
    WU_OPTIONS.title,
    WU_OPTIONS.priority,
    WU_OPTIONS.type,
    WU_OPTIONS.reason,
    WU_OPTIONS.worktree,
    WU_OPTIONS.branch,
    WU_OPTIONS.fixWu,
    WU_OPTIONS.noAuto,
    WU_OPTIONS.force,
    WU_OPTIONS.branchOnly,
    WU_OPTIONS.prMode,
    WU_OPTIONS.removeWorktree,
    WU_OPTIONS.createWorktree,
    WU_OPTIONS.deleteBranch,
    WU_OPTIONS.noRemove,
    WU_OPTIONS.noMerge,
    WU_OPTIONS.help,
    WU_OPTIONS.skipGates,
    WU_OPTIONS.docsOnly,
    WU_OPTIONS.allowTodo,
    WU_OPTIONS.skipExposureCheck,
    WU_OPTIONS.skipAccessibilityCheck,
    WU_OPTIONS.forceOverlap,
    WU_OPTIONS.createPr,
    WU_OPTIONS.prDraft,
    WU_OPTIONS.overrideOwner,
    WU_OPTIONS.noAutoRebase,

    WU_OPTIONS.requireAgents,
    WU_OPTIONS.client,
    WU_OPTIONS.vendor,
  ];

  for (const opt of allOptions) {
    if (!opt) continue;
    program.option(opt.flags, opt.description, opt.default);
  }

  try {
    program.parse(filteredArgv);
  } catch (err) {
    // Re-throw with structured error for unknown options
    throw createError(ErrorCodes.VALIDATION_ERROR, err.message, {
      originalError: err.message,
      argv: filteredArgv,
    });
  }

  let opts = program.opts();

  // Process negated options for backward compat
  opts = processNegatedOptions(opts);

  // Handle positional argument as WU ID fallback
  if (program.args.length > 0 && !opts.id) {
    opts.id = program.args[0];
  }

  return opts;
}
