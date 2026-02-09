import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createError, ErrorCodes } from '@lumenflow/core/lib/error-handler.js';
import {
  PATTERNS,
  BRANCHES,
  STRING_LITERALS,
  EXIT_CODES,
} from '@lumenflow/core/lib/wu-constants.js';
import { createWuPaths } from '@lumenflow/core/lib/wu-paths.js';

function run(cmd: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function formatWUId(wuId: string | null | undefined): string {
  if (!wuId || typeof wuId !== 'string') {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      'verifyWUComplete requires a WU id (e.g., WU-123)',
      { wuId, type: typeof wuId },
    );
  }
  const normalized = wuId.trim().toUpperCase();
  if (!PATTERNS.WU_ID.test(normalized)) {
    throw createError(
      ErrorCodes.INVALID_WU_ID,
      `Invalid WU id "${wuId}". Expected format: WU-123`,
      { wuId, normalized },
    );
  }
  return normalized;
}

type RunFn = (cmd: string) => string;
type ExistsFn = (path: string) => boolean;

function checkGitStatus(runFn: RunFn = run): string | null {
  const status = runFn('git status --porcelain');
  if (!status) return null;
  const lines = status.split(STRING_LITERALS.NEWLINE).filter(Boolean).slice(0, 10);
  return `Working tree dirty (stage or discard changes): ${lines.join('; ')}`;
}

function stampPath(wuId: string, paths: ReturnType<typeof createWuPaths>): string {
  return paths.STAMP(wuId);
}

function checkStamp(
  wuId: string,
  paths: ReturnType<typeof createWuPaths>,
  existsFn: ExistsFn = existsSync,
): string | null {
  if (existsFn(stampPath(wuId, paths))) return null;
  return `Missing stamp ${paths.STAMPS_DIR()}/${wuId}.done`;
}

function checkCommit(
  wuId: string,
  paths: ReturnType<typeof createWuPaths>,
  runFn: RunFn = run,
): string | null {
  const history = runFn(`git log --oneline ${BRANCHES.MAIN} -- ${paths.WU(wuId)} | head -n 1`);
  if (history) return null;
  return `No commit on ${BRANCHES.MAIN} touching ${paths.WU(wuId)}`;
}

/**
 * Verification result type
 */
export interface VerificationResult {
  complete: boolean;
  failures: string[];
}

/**
 * Verification overrides for testing
 */
interface VerificationOverrides {
  run?: RunFn;
  exists?: ExistsFn;
  projectRoot?: string;
}

/**
 * Verify that a WU has been completed and merged to main.
 *
 * Checks:
 *   1. Working tree is clean
 *   2. Completion stamp exists
 *   3. Main history contains a commit updating the WU YAML
 *
 * @param wuId - Work Unit identifier (e.g., "WU-510")
 * @param overrides - Test overrides
 * @returns Verification result
 */
export function verifyWUComplete(
  wuId: string,
  overrides: VerificationOverrides = {},
): VerificationResult {
  const normalized = formatWUId(wuId);
  const failures: string[] = [];
  const runFn = typeof overrides.run === 'function' ? overrides.run : run;
  const existsFn =
    typeof overrides.exists === 'function'
      ? overrides.exists
      : (filePath: string) => existsSync(filePath);
  const paths = createWuPaths({ projectRoot: overrides.projectRoot });

  const gitStatusFailure = checkGitStatus(runFn);
  if (gitStatusFailure) failures.push(gitStatusFailure);

  const stampFailure = checkStamp(normalized, paths, existsFn);
  if (stampFailure) failures.push(stampFailure);

  const commitFailure = checkCommit(normalized, paths, runFn);
  if (commitFailure) failures.push(commitFailure);

  return {
    complete: failures.length === 0,
    failures,
  };
}

export function debugSummary(result: VerificationResult | null | undefined): string {
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
  const wuId = process.argv[2] ?? '';
  try {
    const result = verifyWUComplete(wuId);
    const message = debugSummary(result);
    // eslint-disable-next-line no-console -- CLI direct execution output
    console.log(message);
    process.exit(result.complete ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  } catch (error) {
    // eslint-disable-next-line no-console -- CLI direct execution error output
    console.error(`Verification error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CODES.ERROR);
  }
}
