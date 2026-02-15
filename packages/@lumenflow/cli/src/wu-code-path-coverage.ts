import { spawnSync } from 'node:child_process';
import { EXIT_CODES, EMOJI } from '@lumenflow/core/wu-constants';
import {
  findMissingCodePathCoverage as findMissingCodePathCoverageFromRules,
  isCodePathCoveredByChangedFiles,
} from '@lumenflow/core/wu-rules-engine';

const DEFAULT_BASE_REF = 'main';
const DEFAULT_HEAD_REF = 'HEAD';
const GIT_DIFF_STDIO: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe'];

/**
 * Shared code_paths coverage helpers used by wu:prep and wu:edit.
 *
 * Keeping this logic out of command entrypoints avoids command-to-command coupling
 * (hexagonal boundary: orchestration commands depend on shared adapters, not each other).
 */
export function isCodePathCoveredByChanges(options: {
  codePath: string;
  changedFiles: string[];
}): boolean {
  return isCodePathCoveredByChangedFiles(options);
}

export function findMissingCodePathCoverage(options: {
  codePaths: string[];
  changedFiles: string[];
}): string[] {
  return findMissingCodePathCoverageFromRules(options);
}

export type GitDiffSpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: 'utf-8';
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: unknown;
};

export type CodePathCoverageResult = {
  valid: boolean;
  missingCodePaths: string[];
  changedFiles: string[];
  error?: string;
};

export function checkCodePathCoverageBeforeGates(options: {
  wuId: string;
  codePaths?: string[];
  cwd: string;
  baseRef?: string;
  headRef?: string;
  spawnSyncFn?: GitDiffSpawnFn;
}): CodePathCoverageResult {
  const {
    codePaths = [],
    cwd,
    baseRef = DEFAULT_BASE_REF,
    headRef = DEFAULT_HEAD_REF,
    spawnSyncFn = spawnSync as GitDiffSpawnFn,
  } = options;

  const scopedCodePaths = codePaths
    .filter((codePath): codePath is string => typeof codePath === 'string')
    .map((codePath) => codePath.trim())
    .filter(Boolean);

  if (scopedCodePaths.length === 0) {
    return {
      valid: true,
      missingCodePaths: [],
      changedFiles: [],
    };
  }

  const range = `${baseRef}...${headRef}`;
  const diffResult = spawnSyncFn('git', ['diff', '--name-only', range], {
    cwd,
    encoding: 'utf-8',
    stdio: GIT_DIFF_STDIO,
  });

  if ((diffResult.status ?? EXIT_CODES.ERROR) !== EXIT_CODES.SUCCESS) {
    const stderrText = String(diffResult.stderr ?? '').trim();
    const errorText =
      stderrText || (diffResult.error instanceof Error ? diffResult.error.message : '');
    return {
      valid: false,
      missingCodePaths: scopedCodePaths,
      changedFiles: [],
      error: errorText || `git diff --name-only ${range} failed`,
    };
  }

  const changedFiles = String(diffResult.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const missingCodePaths = findMissingCodePathCoverage({
    codePaths: scopedCodePaths,
    changedFiles,
  });

  return {
    valid: missingCodePaths.length === 0,
    missingCodePaths,
    changedFiles,
  };
}

export function formatCodePathCoverageFailure(options: {
  wuId: string;
  missingCodePaths: string[];
  changedFiles: string[];
  error?: string;
}): string {
  const { wuId, missingCodePaths, changedFiles, error } = options;
  const missingSection = missingCodePaths.map((filePath) => `  - ${filePath}`).join('\n');
  const changedSection =
    changedFiles.length > 0
      ? changedFiles.map((filePath) => `  - ${filePath}`).join('\n')
      : '  - (none)';

  const diffErrorSection = error ? `\nUnable to evaluate branch diff:\n  ${error}\n` : '';

  return (
    `${EMOJI.FAILURE} code_paths preflight failed for ${wuId}.\n` +
    `${diffErrorSection}\n` +
    `The following code_paths are not modified on this branch (vs main):\n` +
    `${missingSection}\n\n` +
    `Changed files detected on branch:\n` +
    `${changedSection}\n\n` +
    `Fix options:\n` +
    `  1. Commit changes that touch each missing code_path\n` +
    `  2. Update WU scope to match actual branch work:\n` +
    `     pnpm wu:edit --id ${wuId} --replace-code-paths --code-paths "<path1>" --code-paths "<path2>"\n` +
    `  3. Re-run: pnpm wu:prep --id ${wuId}`
  );
}
