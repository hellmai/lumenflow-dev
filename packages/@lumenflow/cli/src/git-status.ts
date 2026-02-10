#!/usr/bin/env node
/**
 * Git Status CLI Tool
 *
 * Provides WU-aware git status with:
 * - Porcelain and short output formats
 * - Parsed file status (staged, modified, untracked)
 * - Clean/dirty state detection
 *
 * Usage:
 *   node git-status.js [path] [--porcelain] [--short]
 *
 * WU-1109: INIT-003 Phase 4b - Migrate git operations
 */

import { createGitForPath, getGitForCwd } from '@lumenflow/core';

/**
 * Arguments for git status operation
 */
export interface GitStatusArgs {
  /** Base directory for git operations */
  baseDir?: string;
  /** Path to filter status */
  path?: string;
  /** Use porcelain output format */
  porcelain?: boolean;
  /** Use short output format */
  short?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Result of git status operation
 */
export interface GitStatusResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Whether working tree is clean */
  isClean?: boolean;
  /** List of staged files */
  staged?: string[];
  /** List of modified files (unstaged) */
  modified?: string[];
  /** List of untracked files */
  untracked?: string[];
  /** List of deleted files */
  deleted?: string[];
  /** Raw output (for porcelain mode) */
  output?: string;
}

/**
 * Parse command line arguments for git-status
 */
export function parseGitStatusArgs(argv: string[]): GitStatusArgs {
  const args: GitStatusArgs = {
    porcelain: false,
    short: false,
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--porcelain') {
      args.porcelain = true;
    } else if (arg === '--short' || arg === '-s') {
      args.short = true;
    } else if (arg === '--base-dir') {
      args.baseDir = cliArgs[++i];
    } else if (!arg.startsWith('-')) {
      // Positional argument for path
      args.path = arg;
    }
  }

  return args;
}

/**
 * Parse porcelain status output into categorized files
 */
function parseStatusOutput(output: string): {
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
} {
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const deleted: string[] = [];

  // Don't filter based on trim - leading spaces are significant in git status
  const lines = output.split('\n').filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.length < 3) continue;

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.slice(3).trim();

    // Handle renames (e.g., "R  old -> new")
    const fileName = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath;

    // Untracked files
    if (indexStatus === '?' && workTreeStatus === '?') {
      untracked.push(fileName);
      continue;
    }

    // Staged changes (index has status)
    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.push(fileName);
      if (indexStatus === 'D') {
        deleted.push(fileName);
      }
    }

    // Working tree changes (unstaged modifications)
    if (workTreeStatus === 'M') {
      modified.push(fileName);
    } else if (workTreeStatus === 'D' && indexStatus === ' ') {
      // Only count as deleted in working tree if not already staged for deletion
      deleted.push(fileName);
    }
  }

  return { staged, modified, untracked, deleted };
}

/**
 * Get git status with audit logging
 */
export async function getGitStatus(args: GitStatusArgs): Promise<GitStatusResult> {
  try {
    const git = args.baseDir ? createGitForPath(args.baseDir) : getGitForCwd();

    // Get porcelain status
    const rawArgs = ['status', '--porcelain'];
    if (args.path) {
      rawArgs.push('--', args.path);
    }

    const output = await git.raw(rawArgs);
    // Don't trim the entire output - leading spaces in lines are significant for git status
    // Only trim trailing newlines
    const trimmedOutput = output.replace(/\n+$/, '');

    const isClean = trimmedOutput === '';

    // If porcelain mode requested, return raw output
    if (args.porcelain) {
      return {
        success: true,
        isClean,
        output: trimmedOutput,
      };
    }

    // Parse the status output
    const { staged, modified, untracked, deleted } = parseStatusOutput(trimmedOutput);

    return {
      success: true,
      isClean,
      staged,
      modified,
      untracked,
      deleted,
      output: args.short ? trimmedOutput : undefined,
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
Usage: git-status [path] [options]

Show the working tree status.

Arguments:
  path                  Path to filter status

Options:
  --base-dir <dir>      Base directory for git operations
  --porcelain           Give the output in an easy-to-parse format
  --short, -s           Give the output in short format
  -h, --help            Show this help message

Examples:
  git-status
  git-status src/
  git-status --porcelain
  git-status --short
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
async function main(): Promise<void> {
  const args = parseGitStatusArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await getGitStatus(args);

  if (result.success) {
    if (result.output !== undefined) {
      // Porcelain or short mode
      if (result.output) {
        console.log(result.output);
      }
    } else {
      // Human-readable output
      if (result.isClean) {
        console.log('nothing to commit, working tree clean');
      } else {
        if (result.staged && result.staged.length > 0) {
          console.log('Changes to be committed:');
          result.staged.forEach((f) => console.log(`  ${f}`));
          console.log('');
        }
        if (result.modified && result.modified.length > 0) {
          console.log('Changes not staged for commit:');
          result.modified.forEach((f) => console.log(`  modified:   ${f}`));
          console.log('');
        }
        if (result.untracked && result.untracked.length > 0) {
          console.log('Untracked files:');
          result.untracked.forEach((f) => console.log(`  ${f}`));
        }
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
