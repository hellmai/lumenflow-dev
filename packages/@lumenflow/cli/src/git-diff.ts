#!/usr/bin/env node
/**
 * Git Diff CLI Tool
 *
 * Provides WU-aware git diff with:
 * - Staged/cached diff support
 * - Name-only and stat output modes
 * - File filtering
 *
 * Usage:
 *   node git-diff.js [ref] [--staged] [--name-only] [--stat]
 *
 * WU-1109: INIT-003 Phase 4b - Migrate git operations
 */

import { createGitForPath, getGitForCwd } from '@lumenflow/core';

/**
 * Arguments for git diff operation
 */
export interface GitDiffArgs {
  /** Base directory for git operations */
  baseDir?: string;
  /** Reference to diff against */
  ref?: string;
  /** Show staged changes */
  staged?: boolean;
  /** Show only file names */
  nameOnly?: boolean;
  /** Show diffstat */
  stat?: boolean;
  /** Path to filter diff */
  path?: string;
  /** Show help */
  help?: boolean;
}

/**
 * Result of git diff operation
 */
export interface GitDiffResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Whether there are any differences */
  hasDiff?: boolean;
  /** Diff output */
  diff?: string;
  /** List of files (for name-only mode) */
  files?: string[];
  /** Diffstat output (for stat mode) */
  stat?: string;
}

/**
 * Parse command line arguments for git-diff
 */
export function parseGitDiffArgs(argv: string[]): GitDiffArgs {
  const args: GitDiffArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);
  let afterDoubleDash = false;

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--') {
      afterDoubleDash = true;
      continue;
    }

    if (afterDoubleDash) {
      // Everything after -- is a path
      args.path = arg;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--staged' || arg === '--cached') {
      args.staged = true;
    } else if (arg === '--name-only') {
      args.nameOnly = true;
    } else if (arg === '--stat') {
      args.stat = true;
    } else if (arg === '--base-dir') {
      args.baseDir = cliArgs[++i];
    } else if (!arg.startsWith('-') && !args.ref) {
      // Positional argument for ref
      args.ref = arg;
    }
  }

  return args;
}

/**
 * Get git diff with audit logging
 */
export async function getGitDiff(args: GitDiffArgs): Promise<GitDiffResult> {
  try {
    const git = args.baseDir ? createGitForPath(args.baseDir) : getGitForCwd();

    // Build diff arguments
    const rawArgs = ['diff'];

    if (args.staged) {
      rawArgs.push('--cached');
    }

    if (args.nameOnly) {
      rawArgs.push('--name-only');
    }

    if (args.stat) {
      rawArgs.push('--stat');
    }

    if (args.ref) {
      rawArgs.push(args.ref);
    }

    if (args.path) {
      rawArgs.push('--', args.path);
    }

    const output = await git.raw(rawArgs);
    const trimmedOutput = output.trim();
    const hasDiff = trimmedOutput !== '';

    // Parse output based on mode
    if (args.nameOnly) {
      const files = trimmedOutput ? trimmedOutput.split('\n').filter((f) => f.trim()) : [];
      return {
        success: true,
        hasDiff,
        files,
      };
    }

    if (args.stat) {
      return {
        success: true,
        hasDiff,
        stat: trimmedOutput,
      };
    }

    return {
      success: true,
      hasDiff,
      diff: trimmedOutput,
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
Usage: git-diff [ref] [options] [-- path]

Show changes between commits, commit and working tree, etc.

Arguments:
  ref                   Reference to diff against (e.g., HEAD~1, main)
  path                  Path to filter diff

Options:
  --base-dir <dir>      Base directory for git operations
  --staged, --cached    Show staged changes
  --name-only           Show only names of changed files
  --stat                Show diffstat
  -h, --help            Show this help message

Examples:
  git-diff
  git-diff --staged
  git-diff HEAD~1
  git-diff --name-only
  git-diff -- src/index.ts
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
async function main(): Promise<void> {
  const args = parseGitDiffArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await getGitDiff(args);

  if (result.success) {
    if (result.files) {
      // Name-only mode
      result.files.forEach((f) => console.log(f));
    } else if (result.stat) {
      // Stat mode
      console.log(result.stat);
    } else if (result.diff) {
      // Full diff
      console.log(result.diff);
    }
    // Empty diff produces no output
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
