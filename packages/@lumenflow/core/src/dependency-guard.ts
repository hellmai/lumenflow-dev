// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dependency Guard (WU-1783)
 *
 * Detects dependency-mutating pnpm commands and provides blocking/guidance
 * for worktree discipline enforcement.
 *
 * Used by:
 * - pre-tool-use-hook.sh to block dependency mutations on main
 * - deps:add and deps:remove wrapper commands
 *
 * @see {@link .claude/hooks/pre-tool-use-hook.sh} - PreToolUse hook
 * @see {@link packages/@lumenflow/cli/src/deps-add.ts} - Safe wrapper for pnpm add
 * @see {@link packages/@lumenflow/cli/src/deps-remove.ts} - Safe wrapper for pnpm remove
 */

import { EMOJI } from './wu-constants.js';

/**
 * pnpm subcommands that mutate dependencies.
 *
 * These commands modify package.json, pnpm-lock.yaml, and/or node_modules.
 * Running them on main checkout violates worktree isolation.
 *
 * Includes both full names and shorthand aliases:
 * - add: Add packages to dependencies
 * - install/i: Install packages from lockfile
 * - remove/rm/uninstall: Remove packages from dependencies
 * - update/up: Update packages to latest
 */
export const DEPENDENCY_MUTATING_COMMANDS = [
  'add',
  'install',
  'i', // shorthand for install
  'remove',
  'rm', // shorthand for remove
  'uninstall', // alias for remove
  'update',
  'up', // shorthand for update
];

/**
 * Check if a command is a dependency-mutating pnpm command.
 *
 * @param {string|null|undefined} command - Command string to check
 * @returns {boolean} True if the command mutates dependencies
 *
 * @example
 * isDependencyMutatingCommand('pnpm add react'); // true
 * isDependencyMutatingCommand('pnpm run test'); // false
 * isDependencyMutatingCommand('npm install'); // false (not pnpm)
 */
export function isDependencyMutatingCommand(command: string) {
  // Handle null/undefined/empty
  if (!command) {
    return false;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  // Only check pnpm commands
  if (!trimmed.startsWith('pnpm ') && trimmed !== 'pnpm') {
    return false;
  }

  // Extract the subcommand (first argument after 'pnpm')
  // Handle: pnpm add, pnpm --filter web add, etc.
  const parts = trimmed.split(/\s+/);

  // Find the first non-flag argument after 'pnpm'
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? '';

    // Skip flags (start with -)
    if (part.startsWith('-')) {
      // Handle --filter=value format
      if (part.includes('=')) {
        continue;
      }
      // Handle --filter value format (skip next part too)
      if (part === '--filter' || part === '-F') {
        i++; // Skip the filter value
        continue;
      }
      continue;
    }

    // This is the subcommand
    return DEPENDENCY_MUTATING_COMMANDS.includes(part);
  }

  return false;
}

/**
 * Build a blocking message for dependency-mutating commands on main.
 *
 * @param {string} command - The blocked command
 * @returns {string} Formatted error message with guidance
 *
 * @example
 * const message = buildDependencyBlockMessage('pnpm add react');
 * // Returns multi-line message with guidance
 */
export function buildDependencyBlockMessage(command: string) {
  // Extract the pnpm subcommand for targeted guidance
  const parts = command.trim().split(/\s+/);
  let subcommand = '';
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (!part.startsWith('-')) {
      subcommand = part;
      break;
    }
  }

  const wrapperCommand =
    subcommand === 'add' || subcommand === 'i' || subcommand === 'install'
      ? 'pnpm deps:add'
      : subcommand === 'remove' || subcommand === 'rm' || subcommand === 'uninstall'
        ? 'pnpm deps:remove'
        : 'the corresponding deps:* wrapper';

  return `
${EMOJI.BLOCKED} BLOCKED: Dependency mutation on main checkout

Command: ${command}

REASON: Running ${subcommand || 'dependency'} commands on main bypasses worktree isolation.
This can cause:
  - Dirty lockfile diffs that block other agents
  - pnpm virtual-store mismatches
  - Wedged wu:done workflows

TO FIX:
  1. Claim a WU first (if not already claimed):
     pnpm wu:claim --id WU-XXXX --lane "Your Lane"

  2. Navigate to the worktree:
     cd worktrees/<lane>-wu-<id>/

  3. Run your command there, or use the safe wrapper:
     ${wrapperCommand}

The safe wrapper (${wrapperCommand}) enforces worktree context
and runs the underlying pnpm command with proper isolation.

See: CLAUDE.md section 2 'Daily Operating Loop'
See: https://lumenflow.dev/reference/lumenflow-complete/
`;
}

/**
 * Log prefix for dependency guard output
 */
export const DEPS_LOG_PREFIX = '[deps-guard]';
