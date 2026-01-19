import { Command } from 'commander';
import { createError, ErrorCodes } from './error-handler.js';
import { EXIT_CODES } from './wu-constants.js';

/**
 * Collector function for Commander.js repeatable options.
 * Accumulates multiple flag values into an array.
 *
 * @param {string} value - New value from CLI
 * @param {string[]} previous - Previously accumulated values
 * @returns {string[]} Updated array with new value appended
 * @see https://github.com/tj/commander.js#custom-option-processing
 */
function collectRepeatable(value, previous) {
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
}

export const WU_OPTIONS: Record<string, WUOption> = {
  // String options (require values)
  id: {
    name: 'id',
    flags: '-i, --id <wuId>',
    description: 'Work Unit ID (e.g., WU-123)',
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
  createPr: {
    name: 'createPr',
    flags: '--create-pr',
    description: 'Create PR instead of auto-merge',
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
    description: 'Comma-separated WU IDs that block this WU',
  },
  blocks: {
    name: 'blocks',
    flags: '--blocks <wuIds>',
    description: 'Comma-separated WU IDs this WU blocks',
  },
  labels: {
    name: 'labels',
    flags: '--labels <labels>',
    description: 'Comma-separated labels',
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
  codePaths: {
    name: 'codePaths',
    flags: '--code-paths <paths>',
    description: 'Code paths (comma-separated)',
  },
  testPathsManual: {
    name: 'testPathsManual',
    flags: '--test-paths-manual <tests>',
    description: 'Manual test descriptions (comma-separated)',
  },
  testPathsUnit: {
    name: 'testPathsUnit',
    flags: '--test-paths-unit <paths>',
    description: 'Unit test file paths (comma-separated)',
  },
  testPathsE2e: {
    name: 'testPathsE2e',
    flags: '--test-paths-e2e <paths>',
    description: 'E2E test file paths (comma-separated)',
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
    description: 'Spec/plan references (comma-separated paths to docs, required for type: feature)',
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
    description: 'Comma-separated UI WU IDs that consume this API (for api exposure)',
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
    description: 'Output a Codex/GPT-friendly Markdown prompt (instead of Claude Task antml)',
  },

  // WU-1945: Parent WU for spawn registry tracking
  parentWu: {
    name: 'parentWu',
    flags: '--parent-wu <wuId>',
    description: 'Parent WU ID for orchestrator context (e.g., WU-1000)',
  },

  // WU-1542: Mandatory agent enforcement for wu:done
  requireAgents: {
    name: 'requireAgents',
    flags: '--require-agents',
    description:
      'Block wu:done if mandatory agents (security-auditor, beacon-guardian) were not invoked for WUs touching their trigger paths',
  },

  // WU-2411: Agent handoff for crashed/killed agents
  resume: {
    name: 'resume',
    flags: '--resume',
    description:
      'Resume a WU from a crashed/killed agent (handoff) by taking over the existing worktree and updating the lock with new PID. Fails if original PID is still running (safety) or worktree does not exist.',
  },

  // WU-1023: Skip auto-setup for fast claims
  skipSetup: {
    name: 'skipSetup',
    flags: '--skip-setup',
    description:
      'Skip automatic pnpm install in worktree after creation (faster claims when deps already built)',
  },
};

/**
 * Negated options that commander handles specially.
 * --no-foo creates opts.foo = false. We convert to noFoo = true.
 */
const NEGATED_OPTIONS = ['auto', 'remove', 'merge', 'autoRebase'];

/**
 * Post-process commander opts to handle negated boolean options.
 * Commander's --no-* flags create opts.foo = false.
 * For backward compat, we convert to noFoo = true.
 *
 * @param {object} opts - Commander parsed options
 * @returns {object} Processed options with noFoo properties
 */
function processNegatedOptions(opts) {
  const result = { ...opts };

  for (const key of NEGATED_OPTIONS) {
    // Commander sets the property to false when --no-foo is used
    // and undefined when not specified
    if (key in result && result[key] === false) {
      // Convert: auto=false → noAuto=true
      const camelKey = `no${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      result[camelKey] = true;
      delete result[key];
    } else if (key in result && result[key] === true) {
      // Default value (not negated) - remove it
      delete result[key];
    }
  }

  return result;
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
export function createWUParser(config) {
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

  const program = new Command()
    .name(name)
    .description(description)
    .version(version)
    .allowExcessArguments(allowPositionalId) // Allow positional args if needed
    .exitOverride(); // Throw instead of process.exit for testability

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
    // Commander throws on help/version display - exit gracefully
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exit(EXIT_CODES.SUCCESS);
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

  return opts;
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
export function parseWUArgs(argv) {
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
    WU_OPTIONS.overrideOwner,
    WU_OPTIONS.noAutoRebase,
    WU_OPTIONS.requireAgents,
  ];

  for (const opt of allOptions) {
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
