// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Git Commands Logger
 * Part of WU-630: Detective layer (Layer 3 of 4-layer defense)
 * Part of WU-1552: Complete logging integration with user/outcome tracking
 *
 * Logs all git commands to .lumenflow/commands.log for post-execution analysis.
 * Provides defense-in-depth even if git shim is bypassed.
 *
 * Log format (v2): timestamp | command | branch | worktree | user | outcome
 * Example: 2025-10-24T10:30:00.000Z | git status | lane/operations/wu-630 | worktrees/operations-wu-630 | agent | allowed
 *
 * Legacy format (v1): timestamp | command | branch | worktree
 * - Backward compatible: old entries are parsed with user='unknown' and outcome='unknown'
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCurrentBranch, isMainWorktree } from './wu-helpers.js';
import { GIT_FLAGS, STRING_LITERALS } from './wu-constants.js';
import { MS_PER_DAY } from './constants/duration-constants.js';
import { createPathFactory } from './path-factory.js';

/**
 * Get the default log path using PathFactory (WU-2124).
 *
 * Replaces the previous __dirname-relative resolution:
 *   path.resolve(__dirname, '../..', LUMENFLOW_PATHS.COMMANDS_LOG)
 *
 * Uses config-based project root discovery for correctness
 * regardless of where the compiled JS file lives.
 */
function getDefaultLogPath(): string {
  return createPathFactory().resolveLumenflowPath('COMMANDS_LOG');
}

// Banned patterns (same as git shim)
const BANNED_PATTERNS = [
  { command: 'reset', flags: [GIT_FLAGS.HARD] },
  { command: 'stash' },
  { command: 'clean', flags: [GIT_FLAGS.FD_SHORT, GIT_FLAGS.DF_SHORT] },
  { command: 'checkout', flags: [GIT_FLAGS.FORCE_SHORT, GIT_FLAGS.FORCE] },
  { command: 'push', flags: [GIT_FLAGS.FORCE, GIT_FLAGS.FORCE_SHORT] },
];

const BANNED_FLAGS = [GIT_FLAGS.NO_VERIFY, GIT_FLAGS.NO_GPG_SIGN];

/**
 * Command logging constants (WU-1552)
 *
 * User types and outcome values for audit trail logging.
 */
export const COMMAND_LOG = {
  /** User types: who initiated the command */
  USER: {
    AGENT: 'agent',
    HUMAN: 'human',
    UNKNOWN: 'unknown',
  },
  /** Outcome values: what happened to the command */
  OUTCOME: {
    ALLOWED: 'allowed',
    BLOCKED: 'blocked',
    UNKNOWN: 'unknown',
  },
};

/**
 * Options for logging git commands (WU-1552)
 */
export interface LogGitCommandOptions {
  /** User type: 'agent' | 'human' | 'unknown' */
  user?: string;
  /** Command outcome: 'allowed' | 'blocked' */
  outcome?: string;
}

/**
 * Log a git command to the commands log
 * @param {string[]} args - Git command arguments (e.g., ['status'], ['add', '.'])
 * @param {string} logPath - Path to log file (defaults to .lumenflow/commands.log)
 * @param {LogGitCommandOptions} options - Additional logging options (WU-1552)
 */
export function logGitCommand(
  args: UnsafeAny,
  logPath = getDefaultLogPath(),
  options: LogGitCommandOptions = {},
) {
  try {
    const timestamp = new Date().toISOString();
    const command = `git ${args.join(' ')}`;

    // Get current context
    let branch, worktree;
    if (process.env.TEST_MODE === 'true') {
      branch = process.env.TEST_BRANCH || COMMAND_LOG.USER.UNKNOWN;
      worktree = process.env.TEST_WORKTREE || COMMAND_LOG.USER.UNKNOWN;
    } else {
      branch = getCurrentBranch();
      worktree = isMainWorktree() ? '.' : process.cwd();
    }

    // WU-1552: Extract user and outcome from options with defaults
    const user = options.user || COMMAND_LOG.USER.UNKNOWN;
    const outcome = options.outcome || COMMAND_LOG.OUTCOME.ALLOWED;

    // New format (v2): timestamp | command | branch | worktree | user | outcome
    const logEntry = `${timestamp} | ${command} | ${branch} | ${worktree} | ${user} | ${outcome}\n`;

    // Ensure .lumenflow directory exists
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Append to log file
    fs.appendFileSync(logPath, logEntry, { encoding: 'utf-8' });
  } catch (error) {
    // Don't fail git commands if logging fails
    console.error(`[commands-logger] Warning: Failed to log command: ${error.message}`);
  }
}

/**
 * Parse a log entry line into structured data
 * Supports both v1 (4 fields) and v2 (6 fields) formats.
 *
 * @param {string} line - Log line to parse
 * @returns {{timestamp: string, command: string, branch: string, worktree: string, user: string, outcome: string} | null}
 */
export function parseLogEntry(line: UnsafeAny) {
  if (!line || !line.trim()) {
    return null;
  }

  // Split on " | " (with spaces) to avoid splitting commands that contain pipes
  const parts = line.split(' | ');

  // Minimum 4 fields required (v1 format)
  if (parts.length < 4) {
    return null;
  }

  // v2 format: timestamp | command | branch | worktree | user | outcome (6 fields)
  // v1 format: timestamp | command | branch | worktree (4 fields)
  // Commands may contain pipes, so we need to handle variable field counts
  const hasUserOutcome = parts.length >= 6;

  if (hasUserOutcome) {
    // v2 format: last 2 fields are user and outcome
    const outcome = parts[parts.length - 1].trim();
    const user = parts[parts.length - 2].trim();
    const worktree = parts[parts.length - 3].trim();
    const branch = parts[parts.length - 4].trim();
    // Everything between timestamp and branch is the command (may contain pipes)
    const command = parts
      .slice(1, parts.length - 4)
      .join(' | ')
      .trim();

    return {
      timestamp: parts[0].trim(),
      command,
      branch,
      worktree,
      user,
      outcome,
    };
  } else {
    // v1 format (backward compatibility): no user/outcome fields
    const worktree = parts[parts.length - 1].trim();
    const branch = parts[parts.length - 2].trim();
    const command = parts
      .slice(1, parts.length - 2)
      .join(' | ')
      .trim();

    return {
      timestamp: parts[0].trim(),
      command,
      branch,
      worktree,
      user: COMMAND_LOG.USER.UNKNOWN,
      outcome: COMMAND_LOG.OUTCOME.UNKNOWN,
    };
  }
}

/**
 * Check if a command+context is a violation
 * @param {string} command - The git command
 * @param {string} branch - The branch it was run on
 * @param {string} worktree - The worktree it was run in
 * @returns {boolean}
 */
function isViolation(command: UnsafeAny, branch: UnsafeAny, worktree: UnsafeAny) {
  // Protected context: main branch OR main worktree (.)
  const isProtected = branch === 'main' || worktree === '.';

  if (!isProtected) {
    return false; // Allowed on lane branches in worktrees
  }

  // Parse command into args
  const args = command.replace(/^git\s+/, '').split(/\s+/);
  const commandName = args[0]?.toLowerCase();
  const flags = args.slice(1).map((a: UnsafeAny) => a.toLowerCase());

  // Check banned flags
  for (const bannedFlag of BANNED_FLAGS) {
    if (flags.includes(bannedFlag)) {
      return true;
    }
  }

  // Check banned command patterns
  for (const pattern of BANNED_PATTERNS) {
    if (commandName !== pattern.command) continue;

    // If no specific flags required, ban the command entirely
    if (!pattern.flags) {
      return true;
    }

    // Check if UnsafeAny required flag is present
    const hasRequiredFlag = pattern.flags.some((reqFlag) => flags.includes(reqFlag));
    if (hasRequiredFlag) {
      return true;
    }
  }

  return false;
}

/**
 * Scan log for violations within a session window
 * @param {string} logPath - Path to commands log
 * @param {number} windowMinutes - Session window in minutes (default 60)
 * @returns {Array<{timestamp: string, command: string, branch: string, worktree: string}>}
 */
export function scanLogForViolations(logPath = getDefaultLogPath(), windowMinutes = 60) {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(logPath, { encoding: 'utf-8' });
    const lines = content.trim().split(STRING_LITERALS.NEWLINE).filter(Boolean);

    const now = new Date();
    const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

    const violations = [];

    for (const line of lines) {
      const entry = parseLogEntry(line);
      if (!entry) continue;

      // Filter by session window
      const entryTime = new Date(entry.timestamp);
      if (entryTime < windowStart) {
        continue;
      }

      // Check if this is a violation
      if (isViolation(entry.command, entry.branch, entry.worktree)) {
        violations.push(entry);
      }
    }

    return violations;
  } catch (error) {
    console.error(`[commands-logger] Warning: Failed to scan log: ${error.message}`);
    return [];
  }
}

/**
 * Rotate log by removing entries older than retention period
 * @param {string} logPath - Path to commands log
 * @param {number} retentionDays - Number of days to keep (default 7)
 */
export function rotateLog(logPath = getDefaultLogPath(), retentionDays = 7) {
  if (!fs.existsSync(logPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(logPath, { encoding: 'utf-8' });
    const lines = content.trim().split(STRING_LITERALS.NEWLINE).filter(Boolean);

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - retentionDays * MS_PER_DAY);

    const recentLines = lines.filter((line) => {
      const entry = parseLogEntry(line);
      if (!entry) return false;

      const entryTime = new Date(entry.timestamp);
      return entryTime >= cutoffDate;
    });

    // Write back only recent entries
    fs.writeFileSync(
      logPath,
      recentLines.join(STRING_LITERALS.NEWLINE) +
        (recentLines.length > 0 ? STRING_LITERALS.NEWLINE : ''),
      { encoding: 'utf-8' },
    );
  } catch (error) {
    console.error(`[commands-logger] Warning: Failed to rotate log: ${error.message}`);
  }
}
