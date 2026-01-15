import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createError, ErrorCodes } from '@lumenflow/core/lib/error-handler.js';
import {
  PATTERNS,
  BRANCHES,
  STDIO,
  FILE_SYSTEM,
  STRING_LITERALS,
  EXIT_CODES,
} from '@lumenflow/core/lib/wu-constants.js';

function run(cmd) {
  try {
    return execSync(cmd, { stdio: STDIO.PIPE, encoding: FILE_SYSTEM.UTF8 }).trim();
  } catch {
    return '';
  }
}

function formatWUId(wuId) {
  if (!wuId || typeof wuId !== 'string') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      'verifyWUComplete requires a WU id (e.g., WU-123)',
      { wuId, type: typeof wuId }
    );
  }
  const normalized = wuId.trim().toUpperCase();
  if (!PATTERNS.WU_ID.test(normalized)) {
    throw createError(
      ErrorCodes.INVALID_WU_ID,
      `Invalid WU id "${wuId}". Expected format: WU-123`,
      { wuId, normalized }
    );
  }
  return normalized;
}

function checkGitStatus(runFn = run) {
  const status = runFn('git status --porcelain');
  if (!status) return null;
  const lines = status.split(STRING_LITERALS.NEWLINE).filter(Boolean).slice(0, 10);
  return `Working tree dirty (stage or discard changes): ${lines.join('; ')}`;
}

function stampPath(wuId) {
  return path.join('.beacon', 'stamps', `${wuId}.done`);
}

function checkStamp(wuId, existsFn = existsSync) {
  if (existsFn(stampPath(wuId))) return null;
  return `Missing stamp .beacon/stamps/${wuId}.done`;
}

function checkCommit(wuId, runFn = run) {
  const history = runFn(
    `git log --oneline ${BRANCHES.MAIN} -- docs/04-operations/tasks/wu/${wuId}.yaml | head -n 1`
  );
  if (history) return null;
  return `No commit on ${BRANCHES.MAIN} touching docs/04-operations/tasks/wu/${wuId}.yaml`;
}

/**
 * Verify that a WU has been completed and merged to main.
 *
 * Checks:
 *   1. Working tree is clean
 *   2. Completion stamp exists
 *   3. Main history contains a commit updating the WU YAML
 *
 * @param {string} wuId - Work Unit identifier (e.g., "WU-510")
 * @param {object} [overrides]
 * @param {(cmd: string) => string} [overrides.run] - Override git runner (for tests)
 * @param {(path: string) => boolean} [overrides.exists] - Override exists check (for tests)
 * @returns {{ complete: boolean, failures: string[] }}
 */
export function verifyWUComplete(wuId, overrides = {}) {
  const normalized = formatWUId(wuId);
  const failures = [];
  const runFn = typeof overrides.run === 'function' ? overrides.run : run;
  const existsFn =
    typeof overrides.exists === 'function' ? overrides.exists : (filePath) => existsSync(filePath);

  const gitStatusFailure = checkGitStatus(runFn);
  if (gitStatusFailure) failures.push(gitStatusFailure);

  const stampFailure = checkStamp(normalized, existsFn);
  if (stampFailure) failures.push(stampFailure);

  const commitFailure = checkCommit(normalized, runFn);
  if (commitFailure) failures.push(commitFailure);

  return {
    complete: failures.length === 0,
    failures,
  };
}

export function debugSummary(result) {
  if (!result || typeof result !== 'object') {
    return 'No verification result';
  }
  if (result.complete) {
    return 'Verification passed: WU complete.';
  }
  const failures = Array.isArray(result.failures) ? result.failures : [];
  if (!failures.length) {
    return 'Verification failed: unknown reason.';
  }
  return `Verification failed:${STRING_LITERALS.NEWLINE}- ${failures.join(`${STRING_LITERALS.NEWLINE}- `)}`;
}

const isDirectExecution = (() => {
  if (typeof process === 'undefined') return false;
  if (!Array.isArray(process.argv)) return false;
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  const wuId = process.argv[2];
  try {
    const result = verifyWUComplete(wuId);
    const message = debugSummary(result);
    console.log(message);
    process.exit(result.complete ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  } catch (error) {
    console.error(`Verification error: ${error.message}`);
    process.exit(EXIT_CODES.ERROR);
  }
}
