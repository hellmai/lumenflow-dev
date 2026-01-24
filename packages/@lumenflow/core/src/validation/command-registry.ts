/**
 * Command Registry for WU Lifecycle Commands
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Declarative definitions for all wu:* commands specifying:
 * - Required location (main vs worktree)
 * - Required WU status
 * - Custom validation predicates
 * - Success next steps
 *
 * @module
 */

import {
  CONTEXT_VALIDATION,
  WU_STATUS,
  type LocationType,
} from '../wu-constants.js';
import type { CommandDefinition, CommandPredicate, WuContext } from './types.js';

const { LOCATION_TYPES, COMMANDS, SEVERITY } = CONTEXT_VALIDATION;

/**
 * Predicate: Check if worktree is clean (no uncommitted changes).
 */
const worktreeCleanPredicate: CommandPredicate = {
  id: 'worktree-clean',
  description: 'Worktree must not have uncommitted changes',
  severity: SEVERITY.ERROR,
  check: (context: WuContext) => !context.git.isDirty,
  getFixMessage: (context: WuContext) => {
    const worktreePath = context.location.worktreeName
      ? `worktrees/${context.location.worktreeName}`
      : 'worktree';
    return `Commit or stash changes in ${worktreePath} before running wu:done`;
  },
};

/**
 * Predicate: Check if branch has commits to push.
 */
const hasCommitsPredicate: CommandPredicate = {
  id: 'has-commits',
  description: 'Branch must have commits ahead of tracking branch',
  severity: SEVERITY.WARNING,
  check: (context: WuContext) => context.git.ahead > 0,
  getFixMessage: () => 'No new commits to merge. Did you forget to commit your changes?',
};

/**
 * Predicate: Check if WU state is consistent between YAML and state store.
 */
const stateConsistentPredicate: CommandPredicate = {
  id: 'state-consistent',
  description: 'WU state must be consistent between YAML and state store',
  severity: SEVERITY.WARNING,
  check: (context: WuContext) => context.wu?.isConsistent ?? true,
  getFixMessage: (context: WuContext) =>
    context.wu?.inconsistencyReason || 'State store and YAML are inconsistent',
};

/**
 * Command definition for wu:create.
 */
const wuCreate: CommandDefinition = {
  name: COMMANDS.WU_CREATE,
  description: 'Create a new WU YAML spec',
  requiredLocation: LOCATION_TYPES.MAIN,
  requiredWuStatus: null, // Creates new WU, no existing status required
  predicates: [],
  getNextSteps: (context: WuContext) => [
    `1. Edit the WU spec with acceptance criteria`,
    `2. Run: pnpm wu:claim --id ${context.wu?.id || 'WU-XXX'} --lane "<lane>"`,
  ],
};

/**
 * Command definition for wu:claim.
 */
const wuClaim: CommandDefinition = {
  name: COMMANDS.WU_CLAIM,
  description: 'Claim a WU and create worktree',
  requiredLocation: LOCATION_TYPES.MAIN,
  requiredWuStatus: WU_STATUS.READY,
  predicates: [],
  getNextSteps: (context: WuContext) => {
    const wuId = context.wu?.id?.toLowerCase() || 'wu-xxx';
    const lane = context.wu?.lane?.toLowerCase().replace(/[: ]+/g, '-') || 'lane';
    return [
      `1. cd worktrees/${lane}-${wuId}`,
      '2. Implement changes per acceptance criteria',
      '3. Run: pnpm gates',
      `4. Return to main and run: pnpm wu:done --id ${context.wu?.id || 'WU-XXX'}`,
    ];
  },
};

/**
 * Command definition for wu:done.
 */
const wuDone: CommandDefinition = {
  name: COMMANDS.WU_DONE,
  description: 'Complete WU (merge, stamp, cleanup)',
  requiredLocation: LOCATION_TYPES.MAIN,
  requiredWuStatus: WU_STATUS.IN_PROGRESS,
  predicates: [worktreeCleanPredicate, hasCommitsPredicate, stateConsistentPredicate],
  getNextSteps: () => [
    'WU completed successfully!',
    'Check backlog.md for your next task or run: pnpm wu:status',
  ],
};

/**
 * Command definition for wu:block.
 */
const wuBlock: CommandDefinition = {
  name: COMMANDS.WU_BLOCK,
  description: 'Block WU due to external dependency',
  requiredLocation: null, // Can run from main or worktree
  requiredWuStatus: WU_STATUS.IN_PROGRESS,
  predicates: [],
  getNextSteps: () => [
    'WU blocked. The lane is now available for other work.',
    'When blocker is resolved, run: pnpm wu:unblock --id WU-XXX',
  ],
};

/**
 * Command definition for wu:unblock.
 */
const wuUnblock: CommandDefinition = {
  name: COMMANDS.WU_UNBLOCK,
  description: 'Unblock a blocked WU',
  requiredLocation: null, // Can run from main or worktree
  requiredWuStatus: WU_STATUS.BLOCKED,
  predicates: [],
  getNextSteps: (context: WuContext) => [
    'WU unblocked and returned to in_progress.',
    `Continue working in the worktree or run: pnpm wu:done --id ${context.wu?.id || 'WU-XXX'}`,
  ],
};

/**
 * Command definition for wu:status.
 */
const wuStatus: CommandDefinition = {
  name: COMMANDS.WU_STATUS,
  description: 'Show WU status, location, and valid commands',
  requiredLocation: null, // Informational, works anywhere
  requiredWuStatus: null, // Works without WU context too
  predicates: [],
};

/**
 * Command definition for wu:recover.
 */
const wuRecover: CommandDefinition = {
  name: COMMANDS.WU_RECOVER,
  description: 'Analyze and fix WU state inconsistencies',
  requiredLocation: LOCATION_TYPES.MAIN,
  requiredWuStatus: null, // Handles any state
  predicates: [],
  getNextSteps: () => ['Review recovery actions and confirm to proceed.'],
};

/**
 * Command registry mapping command names to definitions.
 */
export const COMMAND_REGISTRY: Map<string, CommandDefinition> = new Map([
  [COMMANDS.WU_CREATE, wuCreate],
  [COMMANDS.WU_CLAIM, wuClaim],
  [COMMANDS.WU_DONE, wuDone],
  [COMMANDS.WU_BLOCK, wuBlock],
  [COMMANDS.WU_UNBLOCK, wuUnblock],
  [COMMANDS.WU_STATUS, wuStatus],
  [COMMANDS.WU_RECOVER, wuRecover],
]);

/**
 * Get command definition by name.
 *
 * @param command - Command name (e.g., 'wu:create')
 * @returns CommandDefinition or null if not found
 */
export function getCommandDefinition(command: string): CommandDefinition | null {
  return COMMAND_REGISTRY.get(command) ?? null;
}

/**
 * Check if a command's location requirement is satisfied.
 */
function isLocationValid(
  def: CommandDefinition,
  locationType: LocationType,
): boolean {
  // null means any location is valid
  if (def.requiredLocation === null) return true;
  return def.requiredLocation === locationType;
}

/**
 * Check if a command's WU status requirement is satisfied.
 */
function isStatusValid(
  def: CommandDefinition,
  wuStatus: string | null,
): boolean {
  // null requirement means no status check needed
  if (def.requiredWuStatus === null) return true;
  return def.requiredWuStatus === wuStatus;
}

/**
 * Check if all predicates pass (ignoring warnings).
 */
function arePredicatesValid(def: CommandDefinition, context: WuContext): boolean {
  if (!def.predicates || def.predicates.length === 0) return true;

  // Only check error-severity predicates for validity
  return def.predicates
    .filter((p) => p.severity === SEVERITY.ERROR)
    .every((p) => p.check(context));
}

/**
 * Get all commands valid for the current context.
 *
 * A command is valid if:
 * - Location requirement is satisfied (or null = any)
 * - WU status requirement is satisfied (or null = no WU required)
 * - All error-severity predicates pass
 *
 * @param context - Current WU context
 * @returns Array of valid CommandDefinitions
 */
export function getValidCommandsForContext(context: WuContext): CommandDefinition[] {
  const validCommands: CommandDefinition[] = [];
  const locationType = context.location.type;
  const wuStatus = context.wu?.status ?? null;

  for (const def of COMMAND_REGISTRY.values()) {
    if (
      isLocationValid(def, locationType) &&
      isStatusValid(def, wuStatus) &&
      arePredicatesValid(def, context)
    ) {
      validCommands.push(def);
    }
  }

  return validCommands;
}

// Re-export types for convenience
export type { CommandDefinition, CommandPredicate, WuContext };
