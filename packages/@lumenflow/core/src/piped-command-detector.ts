// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2278: Piped Command Detection
 *
 * Detects when pnpm dependency commands are being executed with piped input,
 * which can bypass interactive prompts and cause security issues.
 *
 * Note: No external library exists for this specific shell command analysis.
 *
 * @module piped-command-detector
 */

/**
 * List of pnpm commands that mutate dependencies
 * @constant {string[]}
 */
const DEPENDENCY_COMMANDS = ['add', 'install', 'i', 'remove', 'rm', 'uninstall', 'update', 'up'];

/**
 * Check if a command is a piped pnpm dependency command
 *
 * Detects patterns like:
 * - echo "y" | pnpm add foo
 * - yes | pnpm install
 * - pnpm add foo < /dev/null
 * - pnpm install <<< "y"
 *
 * Does NOT flag:
 * - pnpm test | grep foo (pnpm not receiving input)
 * - pnpm add foo (no pipe)
 *
 * @param {string} command - Shell command to analyze
 * @returns {boolean} True if command is a piped pnpm dependency command
 */
export function isPipedPnpmCommand(command: string) {
  if (!command || typeof command !== 'string') {
    return false;
  }

  // Pattern 1: Something piped TO pnpm (before pnpm in command)
  // e.g., "echo y | pnpm add", "yes | pnpm install"
  const pipeToPattern = /\|\s*pnpm\s+(add|install|i|remove|rm|uninstall|update|up)\b/i;
  if (pipeToPattern.test(command)) {
    return true;
  }

  // Pattern 2: Input redirection (< or <<<)
  // e.g., "pnpm add foo < /dev/null", "pnpm install <<< y"
  const redirectPattern = /pnpm\s+(add|install|i|remove|rm|uninstall|update|up)\b[^|]*<(?!<)/i;
  const heredocPattern = /pnpm\s+(add|install|i|remove|rm|uninstall|update|up)\b[^|]*<<</i;
  if (redirectPattern.test(command) || heredocPattern.test(command)) {
    return true;
  }

  return false;
}

/**
 * Check if a command contains UnsafeAny dependency-mutating pnpm subcommand
 *
 * @param {string} command - Shell command to analyze
 * @returns {boolean} True if command contains pnpm dependency mutation
 */
export function containsPnpmDependencyCommand(command: string) {
  if (!command || typeof command !== 'string') {
    return false;
  }

  // eslint-disable-next-line security/detect-non-literal-regexp -- command names from internal constant array, not user input
  const pattern = new RegExp(`pnpm\\s+(${DEPENDENCY_COMMANDS.join('|')})\\b`, 'i');
  return pattern.test(command);
}
