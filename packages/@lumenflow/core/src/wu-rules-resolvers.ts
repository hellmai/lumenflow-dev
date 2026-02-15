import { existsSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import fg from 'fast-glob';
import { createGitForPath } from './git-adapter.js';
import {
  CLI_PACKAGE_JSON_PATH,
  hasGlobPattern,
  normalizePathForCoverage,
  type CliBinDiffResult,
  type ResolveChangedFilesResult,
  type WURuleResolvers,
} from './wu-rules-core.js';

const DEFAULT_HEAD_REF = 'HEAD';
const BASE_REF_CANDIDATES = ['origin/main', 'main'] as const;
const BASE_REF_UNAVAILABLE_REASON = `Unable to resolve git base ref (tried ${BASE_REF_CANDIDATES.join(', ')}).`;

const PATH_NOT_FOUND_PATTERNS = [
  /does not exist in/i,
  /exists on disk, but not in/i,
  /path .* not in/i,
  /unknown revision or path/i,
  /fatal: path /i,
];

type JsonRefReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; missing: true }
  | { ok: false; missing: false; reason: string };

function getGlobOptions(cwd: string) {
  return {
    cwd,
    dot: true,
    onlyFiles: false,
    unique: true,
  } as const;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function matchesAnyNotFoundPattern(message: string): boolean {
  return PATH_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(message));
}

async function readJsonFileAtRef(options: {
  cwd: string;
  ref: string;
  filePath: string;
}): Promise<JsonRefReadResult> {
  const git = createGitForPath(options.cwd);

  try {
    const output = await git.raw(['show', `${options.ref}:${options.filePath}`]);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return { ok: true, value: parsed };
  } catch (error) {
    const message = toErrorMessage(error);
    if (matchesAnyNotFoundPattern(message)) {
      return { ok: false, missing: true };
    }
    return { ok: false, missing: false, reason: message };
  }
}

function isMissingRefResult(result: JsonRefReadResult): result is { ok: false; missing: true } {
  return !result.ok && 'missing' in result && result.missing === true;
}

function isErrorRefResult(
  result: JsonRefReadResult,
): result is { ok: false; missing: false; reason: string } {
  return !result.ok && 'missing' in result && result.missing === false;
}

export function pathReferenceExistsSync(reference: string, cwd: string): boolean {
  const normalizedReference = reference.trim();
  if (!normalizedReference) {
    return false;
  }

  if (hasGlobPattern(normalizedReference)) {
    const matches = fg.sync(normalizedReference, getGlobOptions(cwd));
    return matches.length > 0;
  }

  const fullPath = path.join(cwd, normalizedReference);
  return existsSync(fullPath);
}

export async function pathReferenceExists(reference: string, cwd: string): Promise<boolean> {
  const normalizedReference = reference.trim();
  if (!normalizedReference) {
    return false;
  }

  if (hasGlobPattern(normalizedReference)) {
    const matches = await fg(normalizedReference, getGlobOptions(cwd));
    return matches.length > 0;
  }

  const fullPath = path.join(cwd, normalizedReference);
  return existsSync(fullPath);
}

export async function resolveBaseRef(options: {
  cwd: string;
  baseRef?: string;
}): Promise<string | null> {
  if (options.baseRef && options.baseRef.trim()) {
    return options.baseRef.trim();
  }

  const git = createGitForPath(options.cwd);
  for (const candidateRef of BASE_REF_CANDIDATES) {
    try {
      if (await git.branchExists(candidateRef)) {
        return candidateRef;
      }
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}

export async function resolveChangedFiles(options: {
  cwd: string;
  baseRef?: string;
  headRef?: string;
}): Promise<ResolveChangedFilesResult> {
  const cwd = options.cwd;
  const headRef = options.headRef || DEFAULT_HEAD_REF;
  const baseRef = await resolveBaseRef({ cwd, baseRef: options.baseRef });

  if (!baseRef) {
    return {
      ok: false,
      reason: BASE_REF_UNAVAILABLE_REASON,
    };
  }

  const git = createGitForPath(cwd);
  try {
    const output = await git.raw(['diff', '--name-only', `${baseRef}...${headRef}`]);
    const files = splitLines(output).map((filePath) => normalizePathForCoverage(filePath));
    return {
      ok: true,
      files,
      baseRef,
      headRef,
    };
  } catch (error) {
    return {
      ok: false,
      reason: toErrorMessage(error),
    };
  }
}

export async function resolveCliBinDiff(options: {
  cwd: string;
  baseRef?: string;
  headRef?: string;
}): Promise<CliBinDiffResult> {
  const cwd = options.cwd;
  const headRef = options.headRef || DEFAULT_HEAD_REF;
  const baseRef = await resolveBaseRef({ cwd, baseRef: options.baseRef });

  if (!baseRef) {
    return {
      state: 'unavailable',
      reason: BASE_REF_UNAVAILABLE_REASON,
      headRef,
    };
  }

  const baseDoc = await readJsonFileAtRef({ cwd, ref: baseRef, filePath: CLI_PACKAGE_JSON_PATH });
  const headDoc = await readJsonFileAtRef({ cwd, ref: headRef, filePath: CLI_PACKAGE_JSON_PATH });

  if (isErrorRefResult(headDoc)) {
    return {
      state: 'unavailable',
      reason: headDoc.reason,
      baseRef,
      headRef,
    };
  }

  if (isErrorRefResult(baseDoc)) {
    return {
      state: 'unavailable',
      reason: baseDoc.reason,
      baseRef,
      headRef,
    };
  }

  // R-006: Base path missing and head exists means the CLI package file is newly introduced.
  if (isMissingRefResult(baseDoc) && headDoc.ok) {
    return {
      state: 'changed',
      reason: `${CLI_PACKAGE_JSON_PATH} does not exist at ${baseRef} but exists at ${headRef}.`,
      baseRef,
      headRef,
    };
  }

  // File removed is also a change.
  if (baseDoc.ok && isMissingRefResult(headDoc)) {
    return {
      state: 'changed',
      reason: `${CLI_PACKAGE_JSON_PATH} exists at ${baseRef} but not at ${headRef}.`,
      baseRef,
      headRef,
    };
  }

  if (isMissingRefResult(baseDoc) && isMissingRefResult(headDoc)) {
    return {
      state: 'unavailable',
      reason: `${CLI_PACKAGE_JSON_PATH} is missing at both ${baseRef} and ${headRef}.`,
      baseRef,
      headRef,
    };
  }

  if (!baseDoc.ok || !headDoc.ok) {
    return {
      state: 'unavailable',
      reason: 'Unable to resolve package.json state at base/head refs.',
      baseRef,
      headRef,
    };
  }

  const baseBin = baseDoc.value.bin;
  const headBin = headDoc.value.bin;

  return {
    state: isDeepStrictEqual(baseBin, headBin) ? 'unchanged' : 'changed',
    baseRef,
    headRef,
  };
}

export function createDefaultWURuleResolvers(): WURuleResolvers {
  return {
    pathReferenceExists,
    resolveChangedFiles,
    resolveCliBinDiff,
  };
}
