#!/usr/bin/env node
/**
 * Git Branch CLI Tool
 *
 * Provides WU-aware git branch with:
 * - Branch listing (local, remote, all)
 * - Current branch detection
 * - Contains filtering
 *
 * Usage:
 *   node git-branch.js [--list] [-a] [-r] [--show-current]
 *
 * WU-1109: INIT-003 Phase 4b - Migrate git operations
 */

import { createGitForPath, getGitForCwd } from '@lumenflow/core';

/**
 * Arguments for git branch operation
 */
export interface GitBranchArgs {
  /** Base directory for git operations */
  baseDir?: string;
  /** List branches */
  list?: boolean;
  /** Show all branches (local and remote) */
  all?: boolean;
  /** Show only remote branches */
  remotes?: boolean;
  /** Show current branch only */
  showCurrent?: boolean;
  /** Filter branches containing commit */
  contains?: string;
  /** Show help */
  help?: boolean;
}

/**
 * Branch information
 */
export interface BranchInfo {
  /** Branch name */
  name: string;
  /** Whether this is the current branch */
  isCurrent: boolean;
  /** Whether this is a remote branch */
  isRemote: boolean;
}

/**
 * Result of git branch operation
 */
export interface GitBranchResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Current branch name */
  current?: string;
  /** List of branches */
  branches?: BranchInfo[];
}

/**
 * Parse command line arguments for git-branch
 */
export function parseGitBranchArgs(argv: string[]): GitBranchArgs {
  const args: GitBranchArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--list' || arg === '-l') {
      args.list = true;
    } else if (arg === '--all' || arg === '-a') {
      args.all = true;
    } else if (arg === '--remotes' || arg === '-r') {
      args.remotes = true;
    } else if (arg === '--show-current') {
      args.showCurrent = true;
    } else if (arg === '--contains') {
      args.contains = cliArgs[++i];
    } else if (arg === '--base-dir') {
      args.baseDir = cliArgs[++i];
    }
  }

  return args;
}

/**
 * Parse branch list output
 */
function parseBranchOutput(output: string): BranchInfo[] {
  const branches: BranchInfo[] = [];

  const lines = output.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if current branch (starts with *)
    const isCurrent = trimmed.startsWith('*');
    // Check if remote branch
    const isRemote = trimmed.includes('remotes/') || trimmed.startsWith('origin/');

    // Extract branch name
    let name = trimmed;
    if (isCurrent) {
      name = name.slice(1).trim();
    }
    // Remove remote prefix for display
    if (name.startsWith('remotes/')) {
      name = name.slice(8);
    }

    // Skip HEAD pointer entries
    if (name.includes(' -> ')) {
      continue;
    }

    branches.push({
      name,
      isCurrent,
      isRemote,
    });
  }

  return branches;
}

/**
 * Get git branch information
 */
export async function getGitBranch(args: GitBranchArgs): Promise<GitBranchResult> {
  try {
    const git = args.baseDir ? createGitForPath(args.baseDir) : getGitForCwd();

    // Show current branch only
    if (args.showCurrent) {
      const current = await git.getCurrentBranch();
      return {
        success: true,
        current: current || undefined,
      };
    }

    // Build branch arguments
    const rawArgs = ['branch'];

    if (args.all) {
      rawArgs.push('-a');
    } else if (args.remotes) {
      rawArgs.push('-r');
    }

    if (args.contains) {
      rawArgs.push('--contains', args.contains);
    }

    const output = await git.raw(rawArgs);
    const branches = parseBranchOutput(output);

    // Find current branch
    const currentBranch = branches.find((b) => b.isCurrent);

    return {
      success: true,
      current: currentBranch?.name,
      branches,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
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
Usage: git-branch [options]

List, create, or delete branches.

Options:
  --base-dir <dir>      Base directory for git operations
  --list, -l            List branches
  -a, --all             List both local and remote branches
  -r, --remotes         List only remote branches
  --show-current        Print the name of the current branch
  --contains <commit>   Only list branches containing the specified commit
  -h, --help            Show this help message

Examples:
  git-branch
  git-branch --list
  git-branch -a
  git-branch --show-current
  git-branch --contains abc123
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
async function main(): Promise<void> {
  const args = parseGitBranchArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await getGitBranch(args);

  if (result.success) {
    if (args.showCurrent) {
      if (result.current) {
        console.log(result.current);
      }
    } else if (result.branches) {
      for (const branch of result.branches) {
        const prefix = branch.isCurrent ? '* ' : '  ';
        console.log(`${prefix}${branch.name}`);
      }
    }
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

// Run main if executed directly
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
