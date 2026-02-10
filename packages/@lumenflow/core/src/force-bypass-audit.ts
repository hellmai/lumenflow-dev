/**
 * WU-1070: Force Bypass Audit Logging
 *
 * Provides audit logging for LUMENFLOW_FORCE bypass usage.
 * All hooks log bypass events to .lumenflow/force-bypasses.log for accountability.
 *
 * Key principles:
 * - FAIL-OPEN: Audit logging must never block the bypass itself
 * - WARN ON MISSING REASON: stderr warning if LUMENFLOW_FORCE_REASON not set
 * - GIT-TRACKED: .lumenflow/force-bypasses.log is version controlled
 *
 * Log format:
 *   ISO_TIMESTAMP | HOOK_NAME | GIT_USER | BRANCH | REASON | CWD
 *
 * Example:
 *   2026-01-23T10:30:00.000Z | pre-commit | tom@hellm.ai | lane/ops/wu-1070 | Emergency hotfix | /project
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { LUMENFLOW_PATHS } from './wu-constants.js';

/**
 * Environment variable names for force bypass
 */
export const FORCE_ENV_VAR = 'LUMENFLOW_FORCE';
export const FORCE_REASON_ENV_VAR = 'LUMENFLOW_FORCE_REASON';

/**
 * Log file path relative to project root
 */
const LOG_FILE_NAME = LUMENFLOW_PATHS.FORCE_BYPASSES;

/**
 * Represents a parsed audit log entry
 */
export interface AuditLogEntry {
  timestamp: string;
  hook: string;
  user: string;
  branch: string;
  reason: string;
  cwd: string;
}

/**
 * Check if LUMENFLOW_FORCE bypass is active
 *
 * @returns true if LUMENFLOW_FORCE=1
 */
export function shouldBypass(): boolean {
  return process.env[FORCE_ENV_VAR] === '1';
}

/**
 * Get the audit log file path
 *
 * @param projectRoot - Project root directory
 * @returns Full path to the audit log file
 */
export function getAuditLogPath(projectRoot: string): string {
  return join(projectRoot, LOG_FILE_NAME);
}

/**
 * Get git user.name for audit logging
 *
 * @returns Git user name or 'unknown' if not configured
 */
function getGitUser(): string {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    return execSync('git config user.name', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get current git branch name
 *
 * @returns Branch name or 'unknown' if not in a git repo
 */
function getGitBranch(): string {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Log a force bypass event to the audit log
 *
 * This function is FAIL-OPEN: if logging fails, it warns to stderr
 * but does NOT throw or block the bypass operation.
 *
 * @param hookName - Name of the hook being bypassed (pre-commit, pre-push, etc.)
 * @param projectRoot - Project root directory
 */
export function logForceBypass(hookName: string, projectRoot: string): void {
  // Only log when bypass is active
  if (!shouldBypass()) {
    return;
  }

  // Get reason from environment (warn if missing)
  const reason = process.env[FORCE_REASON_ENV_VAR];
  if (!reason) {
    console.warn(
      `[${hookName}] Warning: ${FORCE_REASON_ENV_VAR} not set. ` +
        'Consider providing a reason for the bypass: ' +
        `${FORCE_REASON_ENV_VAR}="reason here" LUMENFLOW_FORCE=1 git ...`,
    );
  }

  // Collect audit data
  const timestamp = new Date().toISOString();
  const user = getGitUser();
  const branch = getGitBranch();
  const cwd = projectRoot;
  const reasonText = reason || '(no reason provided)';

  // Format log line: ISO timestamp | hook | user | branch | reason | cwd
  const logLine = `${timestamp} | ${hookName} | ${user} | ${branch} | ${reasonText} | ${cwd}\n`;

  // Write to log file (fail-open)
  try {
    const logPath = getAuditLogPath(projectRoot);
    const lumenflowDir = join(projectRoot, LUMENFLOW_PATHS.BASE);

    // Ensure .lumenflow directory exists
    if (!existsSync(lumenflowDir)) {
      mkdirSync(lumenflowDir, { recursive: true });
    }

    appendFileSync(logPath, logLine);
  } catch (error) {
    // Fail-open: warn but don't block
    console.error(
      `[${hookName}] Warning: Failed to write to audit log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse a single line from the audit log
 *
 * @param line - Raw log line
 * @returns Parsed entry or null if invalid
 */
export function parseAuditLogLine(line: string): AuditLogEntry | null {
  if (!line || line.trim() === '') {
    return null;
  }

  const parts = line.split(' | ');
  if (parts.length !== 6) {
    return null;
  }

  const [timestamp, hook, user, branch, reason, cwd] = parts;

  return {
    timestamp: timestamp.trim(),
    hook: hook.trim(),
    user: user.trim(),
    branch: branch.trim(),
    reason: reason.trim(),
    cwd: cwd.trim(),
  };
}
