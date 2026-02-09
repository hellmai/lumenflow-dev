#!/usr/bin/env node
/**
 * Guard Main Branch CLI Tool
 *
 * Provides branch protection checks for WU workflow:
 * - Blocks operations on main/master branches
 * - Blocks operations on lane branches (require worktree)
 * - Optionally allows agent branches
 *
 * Usage:
 *   node guard-main-branch.js [--allow-agent-branch] [--strict]
 *
 * WU-1109: INIT-003 Phase 4b - Migrate git operations
 */

import { createGitForPath, getGitForCwd, isAgentBranch, getConfig } from '@lumenflow/core';
import { isInWorktree } from '@lumenflow/core/core/worktree-guard';

/**
 * Arguments for guard-main-branch operation
 */
export interface GuardMainBranchArgs {
  /** Base directory for git operations */
  baseDir?: string;
  /** Allow agent branches (e.g., claude/session-123) */
  allowAgentBranch?: boolean;
  /** Strict mode - fail on any protected branch */
  strict?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Result of guard-main-branch operation
 */
export interface GuardMainBranchResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Whether current branch is protected */
  isProtected: boolean;
  /** Current branch name */
  currentBranch?: string;
  /** Reason for protection */
  reason?: string;
}

/**
 * Parse command line arguments for guard-main-branch
 */
export function parseGuardMainBranchArgs(argv: string[]): GuardMainBranchArgs {
  const args: GuardMainBranchArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--allow-agent-branch') {
      args.allowAgentBranch = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--base-dir') {
      args.baseDir = cliArgs[++i];
    }
  }

  return args;
}

/**
 * Get lane branch pattern from config
 */
function getLaneBranchPattern(): RegExp {
  const config = getConfig();
  const prefix = config?.git?.laneBranchPrefix ?? 'lane/';
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}`);
}

/**
 * Get protected branches from config
 */
function getProtectedBranches(): string[] {
  const config = getConfig();
  const mainBranch = config?.git?.mainBranch ?? 'main';
  // Always include master for legacy compatibility
  const protectedSet = new Set([mainBranch, 'master']);
  return Array.from(protectedSet);
}

/**
 * Check if a branch is a lane branch (requires worktree)
 */
function isLaneBranch(branch: string): boolean {
  return getLaneBranchPattern().test(branch);
}

/**
 * Guard against operations on protected branches
 */
export async function guardMainBranch(args: GuardMainBranchArgs): Promise<GuardMainBranchResult> {
  try {
    const git = args.baseDir ? createGitForPath(args.baseDir) : getGitForCwd();

    const currentBranch = await git.getCurrentBranch();

    // Handle detached HEAD
    if (currentBranch === 'HEAD' || !currentBranch) {
      return {
        success: true,
        isProtected: true,
        currentBranch: 'HEAD (detached)',
        reason: 'Detached HEAD state is protected - checkout a branch',
      };
    }

    const protectedBranches = getProtectedBranches();

    // Check if on main/master
    if (protectedBranches.includes(currentBranch)) {
      return {
        success: true,
        isProtected: true,
        currentBranch,
        reason: `Branch '${currentBranch}' is protected - use a worktree for WU work`,
      };
    }

    // Check if on a lane branch (requires worktree discipline)
    if (isLaneBranch(currentBranch)) {
      // If we're actually in a worktree, allow the operation (WU-1130)
      const cwd = args.baseDir ?? process.cwd();
      if (isInWorktree({ cwd })) {
        return {
          success: true,
          isProtected: false,
          currentBranch,
        };
      }
      // On lane branch but not in worktree - block
      return {
        success: true,
        isProtected: true,
        currentBranch,
        reason: `Lane branch '${currentBranch}' requires worktree - use 'pnpm wu:claim' to create worktree`,
      };
    }

    // Check agent branch if not explicitly allowed
    if (!args.allowAgentBranch) {
      const isAgent = await isAgentBranch(currentBranch);
      if (isAgent) {
        // Agent branches are allowed by default (unless --strict)
        if (args.strict) {
          return {
            success: true,
            isProtected: true,
            currentBranch,
            reason: `Agent branch '${currentBranch}' is protected in strict mode`,
          };
        }
        // Allow agent branch
        return {
          success: true,
          isProtected: false,
          currentBranch,
        };
      }
    }

    // Branch is not protected
    return {
      success: true,
      isProtected: false,
      currentBranch,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      isProtected: true, // Fail-closed
      error: errorMessage,
    };
  }
}

/**
 * Print help message
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
function printHelp(): void {
  console.log(`
Usage: guard-main-branch [options]

Check if current branch is protected and block operations.

Options:
  --base-dir <dir>      Base directory for git operations
  --allow-agent-branch  Allow operations on agent branches
  --strict              Block all protected branches (including agent)
  -h, --help            Show this help message

Exit codes:
  0 - Branch is not protected (safe to proceed)
  1 - Branch is protected (operation blocked)

Protected branches:
  - main/master: Always protected
  - lane/*: Requires worktree (use wu:claim)
  - Agent branches: Allowed unless --strict

Examples:
  guard-main-branch
  guard-main-branch --allow-agent-branch
  guard-main-branch --strict
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
async function main(): Promise<void> {
  const args = parseGuardMainBranchArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await guardMainBranch(args);

  if (result.success) {
    if (result.isProtected) {
      console.error(`[guard-main-branch] BLOCKED: ${result.reason}`);
      console.error(`Current branch: ${result.currentBranch}`);
      process.exit(1);
    } else {
      // Silent success in normal mode
      if (process.env.DEBUG) {
        console.log(`[guard-main-branch] OK: Branch '${result.currentBranch}' is not protected`);
      }
      process.exit(0);
    }
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

// Run main if executed directly
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}
