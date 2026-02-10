#!/usr/bin/env node
/**
 * Git Log CLI Tool
 *
 * Provides WU-aware git log with:
 * - Oneline and custom format output
 * - Max count limiting
 * - Date and author filtering
 *
 * Usage:
 *   node git-log.js [ref] [--oneline] [-n <count>] [--format <format>]
 *
 * WU-1109: INIT-003 Phase 4b - Migrate git operations
 */

import { createGitForPath, getGitForCwd } from '@lumenflow/core';

/**
 * Arguments for git log operation
 */
export interface GitLogArgs {
  /** Base directory for git operations */
  baseDir?: string;
  /** Reference or range (e.g., main..feature) */
  ref?: string;
  /** Use oneline format */
  oneline?: boolean;
  /** Maximum number of commits */
  maxCount?: number;
  /** Custom format string */
  format?: string;
  /** Show commits since date */
  since?: string;
  /** Filter by author */
  author?: string;
  /** Show help */
  help?: boolean;
}

/**
 * Commit information
 */
export interface CommitInfo {
  /** Commit hash */
  hash: string;
  /** Commit message */
  message: string;
  /** Author name */
  author?: string;
  /** Author date */
  date?: string;
}

/**
 * Result of git log operation
 */
export interface GitLogResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Parsed commits */
  commits: CommitInfo[];
  /** Raw output (for oneline/custom format) */
  output?: string;
}

/**
 * Parse command line arguments for git-log
 */
export function parseGitLogArgs(argv: string[]): GitLogArgs {
  const args: GitLogArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--oneline') {
      args.oneline = true;
    } else if (arg === '-n') {
      const val = cliArgs[++i];
      if (val) args.maxCount = parseInt(val, 10);
    } else if (arg === '--max-count') {
      const val = cliArgs[++i];
      if (val) args.maxCount = parseInt(val, 10);
    } else if (arg.startsWith('-n') && arg.length > 2) {
      // Handle -n5 format
      args.maxCount = parseInt(arg.slice(2), 10);
    } else if (arg === '--format') {
      args.format = cliArgs[++i];
    } else if (arg === '--since') {
      args.since = cliArgs[++i];
    } else if (arg === '--author') {
      args.author = cliArgs[++i];
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
 * Parse structured log output
 */
function parseLogOutput(output: string): CommitInfo[] {
  if (!output.trim()) {
    return [];
  }

  const commits: CommitInfo[] = [];
  // Parse format: hash|message|author|date (separated by |||)
  const lines = output.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    const parts = line.split('|||');
    if (parts.length >= 2) {
      commits.push({
        hash: parts[0].trim(),
        message: parts[1].trim(),
        author: parts[2]?.trim(),
        date: parts[3]?.trim(),
      });
    } else {
      // Fallback for oneline format (hash + message)
      const match = line.match(/^([a-f0-9]+)\s+(.*)$/);
      if (match) {
        commits.push({
          hash: match[1],
          message: match[2],
        });
      }
    }
  }

  return commits;
}

/**
 * Get git log with audit logging
 */
export async function getGitLog(args: GitLogArgs): Promise<GitLogResult> {
  try {
    const git = args.baseDir ? createGitForPath(args.baseDir) : getGitForCwd();

    // Build log arguments
    const rawArgs = ['log'];

    if (args.maxCount) {
      rawArgs.push(`-n`, String(args.maxCount));
    }

    if (args.oneline) {
      rawArgs.push('--oneline');
    } else if (args.format) {
      rawArgs.push(`--format=${args.format}`);
    } else {
      // Use structured format for parsing
      rawArgs.push('--format=%H|||%s|||%an|||%ai');
    }

    if (args.since) {
      rawArgs.push(`--since=${args.since}`);
    }

    if (args.author) {
      rawArgs.push(`--author=${args.author}`);
    }

    if (args.ref) {
      rawArgs.push(args.ref);
    }

    const output = await git.raw(rawArgs);
    const trimmedOutput = output.trim();

    // Parse commits
    const commits = args.oneline || args.format ? [] : parseLogOutput(trimmedOutput);

    return {
      success: true,
      commits,
      output: args.oneline || args.format ? trimmedOutput : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Handle case of repo with no commits
    if (
      errorMessage.includes('does not have any commits') ||
      errorMessage.includes('fatal: bad revision') ||
      errorMessage.includes("fatal: your current branch 'main' does not have any commits")
    ) {
      return {
        success: true,
        commits: [],
      };
    }
    return {
      success: false,
      error: errorMessage,
      commits: [],
    };
  }
}

/**
 * Print help message
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
function printHelp(): void {
  console.log(`
Usage: git-log [ref] [options]

Show commit logs.

Arguments:
  ref                   Revision range (e.g., main..feature)

Options:
  --base-dir <dir>      Base directory for git operations
  --oneline             Show each commit on a single line
  -n <number>           Limit the number of commits
  --max-count <number>  Limit the number of commits
  --format <format>     Pretty-print format string
  --since <date>        Show commits more recent than a date
  --author <pattern>    Limit to commits by author
  -h, --help            Show this help message

Examples:
  git-log
  git-log --oneline
  git-log -n 10
  git-log main..feature
  git-log --since="2024-01-01"
  git-log --author="test@example.com"
`);
}

/**
 * Main entry point
 */
/* istanbul ignore next -- CLI entry point tested via subprocess */
async function main(): Promise<void> {
  const args = parseGitLogArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await getGitLog(args);

  if (result.success) {
    if (result.output !== undefined) {
      // Custom format or oneline mode
      if (result.output) {
        console.log(result.output);
      }
    } else {
      // Structured output
      for (const commit of result.commits) {
        console.log(`commit ${commit.hash}`);
        if (commit.author) console.log(`Author: ${commit.author}`);
        if (commit.date) console.log(`Date:   ${commit.date}`);
        console.log('');
        console.log(`    ${commit.message}`);
        console.log('');
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
