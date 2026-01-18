#!/usr/bin/env node
/**
 * @lumenflow/shims - Git Command Shim (WU-2546)
 *
 * Intercepts git commands and blocks destructive operations on main branch/worktree.
 *
 * Usage: Add shims directory to PATH before /usr/bin
 *   export PATH="$(pwd)/node_modules/.bin:$PATH"
 *
 * Blocked commands on main:
 *   - git reset --hard
 *   - git stash (any form)
 *   - git clean -fd
 *   - git checkout -f
 *   - git push --force / -f
 *   - hook bypass flags
 *
 * These commands are ALLOWED on lane branches in worktrees (safe context).
 *
 * @module @lumenflow/shims/git
 */

import { spawnSync } from 'node:child_process';
import type { GitShimConfig, BannedPatternResult, ProtectedContextResult } from './types.js';
import { GitShimConfigSchema, UserType, CommandOutcome } from './types.js';
import { getCurrentBranch, isMainWorktree } from './worktree.js';

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: GitShimConfig = GitShimConfigSchema.parse({});

/**
 * Build context string for protected/unprotected state.
 *
 * @param isProtected - Whether context is protected
 * @param inMainWorktree - Whether in main worktree
 * @param protectedBranch - Name of protected branch
 * @param branch - Current branch name
 * @returns Context description string
 */
function buildContextString(
  isProtected: boolean,
  inMainWorktree: boolean,
  protectedBranch: string,
  branch: string | null,
): string {
  if (isProtected) {
    if (inMainWorktree) {
      return 'main worktree';
    }
    return `${protectedBranch} branch`;
  }
  return `${branch} branch in lane worktree`;
}

/**
 * Detect user type based on environment variables.
 *
 * @param config - Git shim configuration
 * @returns User type: 'agent', 'human', or 'unknown'
 */
export function detectUserType(config: GitShimConfig = DEFAULT_CONFIG): string {
  for (const envVar of config.agentEnvVars) {
    if (process.env[envVar]) {
      return UserType.AGENT;
    }
  }
  return UserType.HUMAN;
}

/**
 * Check if arguments contain a banned command pattern.
 *
 * @param args - Git command arguments
 * @param config - Git shim configuration
 * @returns Object with banned status and reason
 */
export function checkBannedPattern(
  args: string[],
  config: GitShimConfig = DEFAULT_CONFIG,
): BannedPatternResult {
  const command = args[0]?.toLowerCase();
  const flags = args.slice(1).map((a) => a.toLowerCase());

  // Check banned flags first (apply to any command)
  for (const bannedFlag of config.bannedFlags) {
    if (flags.includes(bannedFlag)) {
      return {
        banned: true,
        reason: `Flag ${bannedFlag} bypasses hooks and is forbidden`,
      };
    }
  }

  // Check banned command patterns
  for (const pattern of config.bannedPatterns) {
    if (command !== pattern.command) continue;

    // If no specific flags required, ban the command entirely
    if (!pattern.flags) {
      return {
        banned: true,
        reason: `Command "git ${command}" is destructive and forbidden on main`,
      };
    }

    // Check if any required flag is present
    const hasRequiredFlag = pattern.flags.some((reqFlag) => flags.includes(reqFlag));
    if (hasRequiredFlag) {
      return {
        banned: true,
        reason: `Command "git ${args.join(' ')}" is destructive and forbidden on main`,
      };
    }
  }

  return { banned: false, reason: null };
}

/**
 * Check if we're in a protected context (main branch or main worktree).
 *
 * @param config - Git shim configuration
 * @returns Object with protected status and context description
 */
export function checkProtectedContext(
  config: GitShimConfig = DEFAULT_CONFIG,
): ProtectedContextResult {
  // Allow TEST_MODE for integration tests
  if (process.env['TEST_MODE'] === 'true') {
    const branch = process.env['TEST_BRANCH'] || config.protectedBranch;
    const inMainWorktree = process.env['TEST_IS_MAIN_WORKTREE'] === 'true';
    const isProtectedBranch = branch === config.protectedBranch;
    const isProtected = isProtectedBranch || inMainWorktree;
    const context = buildContextString(isProtected, inMainWorktree, config.protectedBranch, branch);
    return { protected: isProtected, context };
  }

  const branch = getCurrentBranch(config.realGitPath);
  const inMainWorktree = isMainWorktree(config.realGitPath);

  // Protected if:
  // 1. On protected branch (regardless of worktree)
  // 2. OR in main worktree (even if on a lane branch)
  const isProtected = branch === config.protectedBranch || inMainWorktree;
  const context = buildContextString(isProtected, inMainWorktree, config.protectedBranch, branch);

  return { protected: isProtected, context };
}

/**
 * Format error message for blocked command.
 *
 * @param command - The blocked command
 * @param reason - Why it was blocked
 * @param context - Where it was blocked
 * @returns Formatted error message
 */
export function formatBlockedError(command: string, reason: string, context: string): string {
  return `
╔═══════════════════════════════════════════════════════════════════╗
║  GIT SHIM HOOK ERROR
╠═══════════════════════════════════════════════════════════════════╣
║
║  Blocked: git ${command}
║
║  ${reason}
║
║  Context: ${context}
║
║  Why blocked:
║  This command could destroy uncommitted work from other agents
║  working on parallel WUs in their own worktrees.
║
║  Correct workflow:
║  1. Claim a WU: pnpm wu:claim --id WU-XXX --lane <lane>
║  2. Work in worktree: cd worktrees/<lane>-wu-xxx
║  3. Make changes, commit, push: git add . && git commit && git push
║  4. Complete: pnpm wu:done --id WU-XXX (run from main directory)
║
╚═══════════════════════════════════════════════════════════════════╝
`;
}

/**
 * Find real git executable.
 *
 * @param preferredPath - Preferred git path from config
 * @returns Path to real git
 */
export function findRealGit(preferredPath: string = '/usr/bin/git'): string {
  const gitPaths = [preferredPath, '/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];

  for (const gitPath of gitPaths) {
    try {
      const result = spawnSync(gitPath, ['--version'], { encoding: 'utf8' });
      if (result.status === 0) {
        return gitPath;
      }
    } catch {
      // Try next path
    }
  }

  return 'git';
}

/**
 * Log command execution for audit trail.
 *
 * @param _user - User type (agent/human)
 * @param _outcome - Command outcome (allowed/blocked)
 * @param _config - Git shim configuration
 */
function logCommand(_user: string, _outcome: string, _config: GitShimConfig): void {
  // Logging would go here - simplified for extraction
  // Future: write to config.logPath
}

/**
 * Run the git shim with given configuration.
 *
 * @param args - Git command arguments
 * @param config - Git shim configuration
 * @returns Exit code
 */
export function runGitShim(args: string[], config: GitShimConfig = DEFAULT_CONFIG): number {
  // Recursion guard
  if (process.env[config.recursionEnvVar]) {
    const result = spawnSync(config.realGitPath, args, {
      stdio: 'inherit',
      encoding: 'utf8',
    });
    return result.status || 0;
  }
  process.env[config.recursionEnvVar] = '1';

  // Detect user type for audit trail
  const user = detectUserType(config);

  // Check if we're in a protected context
  const { protected: isProtected, context } = checkProtectedContext(config);

  let outcome: string = CommandOutcome.ALLOWED;

  if (isProtected) {
    const { banned, reason } = checkBannedPattern(args, config);

    if (banned && reason) {
      outcome = CommandOutcome.BLOCKED;

      // Log blocked command if logging enabled
      if (config.enableLogging && config.logPath) {
        logCommand(user, outcome, config);
      }

      // Block the command
      const command = args.join(' ');
      const errorMsg = formatBlockedError(command, reason, context);
      console.error(errorMsg);
      return 1;
    }
  }

  // Log allowed command if logging enabled
  if (config.enableLogging && config.logPath) {
    logCommand(user, outcome, config);
  }

  // Pass through to real git
  const realGit = findRealGit(config.realGitPath);
  const result = spawnSync(realGit, args, {
    stdio: 'inherit',
    encoding: 'utf8',
  });

  return result.status || 0;
}

/**
 * Main entry point for CLI execution.
 */
export function main(): void {
  const args = process.argv.slice(2);
  const exitCode = runGitShim(args);
  process.exit(exitCode);
}

// Run if executed directly
const currentUrl = import.meta.url;
const scriptPath = `file://${process.argv[1]}`;
if (currentUrl === scriptPath) {
  main();
}
