/**
 * Dependency Guard (WU-2539)
 *
 * Detects dependency-mutating pnpm commands and provides blocking/guidance
 * for worktree discipline enforcement.
 *
 * @module @lumenflow/core/guards
 */

/**
 * pnpm subcommands that mutate dependencies.
 */
export const DEPENDENCY_MUTATING_COMMANDS = [
  'add',
  'install',
  'i',
  'remove',
  'rm',
  'uninstall',
  'update',
  'up',
] as const;

export type DependencyMutatingCommand = (typeof DEPENDENCY_MUTATING_COMMANDS)[number];

/**
 * Set of mutating commands for O(1) lookup
 */
const MUTATING_SET = new Set<string>(DEPENDENCY_MUTATING_COMMANDS);

/**
 * Flags that take a value as the next argument
 */
const FLAGS_WITH_VALUES = new Set(['--filter', '-F']);

/**
 * Check if a part is a flag with inline value (e.g., --filter=value)
 */
function isFlagWithInlineValue(part: string): boolean {
  return part.startsWith('-') && part.includes('=');
}

/**
 * Check if a part is a flag that takes a separate value argument
 */
function isFlagWithSeparateValue(part: string): boolean {
  return FLAGS_WITH_VALUES.has(part);
}

/**
 * Extract the first subcommand from pnpm command parts.
 * Returns the subcommand or null if none found.
 */
function extractPnpmSubcommand(parts: string[]): string | null {
  let skipNext = false;
  for (const part of parts.slice(1)) {
    if (!part) continue;
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (part.startsWith('-')) {
      if (!isFlagWithInlineValue(part) && isFlagWithSeparateValue(part)) {
        skipNext = true;
      }
      continue;
    }
    return part;
  }
  return null;
}

/**
 * Check if a command is a dependency-mutating pnpm command.
 *
 * @param command - Command string to check
 * @returns True if the command mutates dependencies
 */
export function isDependencyMutatingCommand(command: string | null | undefined): boolean {
  if (!command) {
    return false;
  }

  const trimmed = command.trim();
  if (!trimmed || (!trimmed.startsWith('pnpm ') && trimmed !== 'pnpm')) {
    return false;
  }

  const parts = trimmed.split(/\s+/);
  const subcommand = extractPnpmSubcommand(parts);

  return subcommand !== null && MUTATING_SET.has(subcommand);
}

/**
 * Get the wrapper command suggestion based on subcommand
 */
function getWrapperSuggestion(subcommand: string): string {
  if (subcommand === 'add' || subcommand === 'i' || subcommand === 'install') {
    return 'pnpm deps:add';
  }
  if (subcommand === 'remove' || subcommand === 'rm' || subcommand === 'uninstall') {
    return 'pnpm deps:remove';
  }
  return 'the corresponding deps:* wrapper';
}

/**
 * Build a blocking message for dependency-mutating commands on main.
 *
 * @param command - The blocked command
 * @returns Formatted error message with guidance
 */
export function buildDependencyBlockMessage(command: string): string {
  const parts = command.trim().split(/\s+/);
  let subcommand = '';

  for (const part of parts.slice(1)) {
    if (part && !part.startsWith('-')) {
      subcommand = part;
      break;
    }
  }

  const wrapperCommand = getWrapperSuggestion(subcommand);

  return `
BLOCKED: Dependency mutation on main checkout

Command: ${command}

REASON: Running ${subcommand || 'dependency'} commands on main bypasses worktree isolation.

TO FIX:
  1. Claim a WU first (if not already claimed):
     pnpm wu:claim --id WU-XXXX --lane "Your Lane"

  2. Navigate to the worktree:
     cd worktrees/<lane>-wu-<id>/

  3. Run your command there, or use the safe wrapper:
     ${wrapperCommand}
`.trim();
}
