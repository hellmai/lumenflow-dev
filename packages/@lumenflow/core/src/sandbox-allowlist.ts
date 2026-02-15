import fs from 'node:fs';
import path from 'node:path';

export interface SandboxAllowlistEntry {
  originalPath: string;
  normalizedPath: string;
  canonicalPath: string;
}

export interface SandboxAllowlist {
  projectRoot: string;
  writableRoots: SandboxAllowlistEntry[];
}

export interface BuildSandboxAllowlistInput {
  projectRoot: string;
  writableRoots: string[];
}

function normalizeAbsolutePath(targetPath: string): string {
  const normalized = path.resolve(targetPath);

  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function toComparisonKey(targetPath: string): string {
  return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
}

function findNearestExistingAncestor(targetPath: string): {
  ancestor: string;
  suffixParts: string[];
} {
  let cursor = normalizeAbsolutePath(targetPath);
  const suffixParts: string[] = [];

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }

    suffixParts.unshift(path.basename(cursor));
    cursor = parent;
  }

  return { ancestor: cursor, suffixParts };
}

function resolveCanonicalPathForWrite(targetPath: string): string {
  const normalized = normalizeAbsolutePath(targetPath);

  if (fs.existsSync(normalized)) {
    return normalizeAbsolutePath(fs.realpathSync.native(normalized));
  }

  const { ancestor, suffixParts } = findNearestExistingAncestor(normalized);
  const canonicalAncestor = fs.existsSync(ancestor)
    ? normalizeAbsolutePath(fs.realpathSync.native(ancestor))
    : normalizeAbsolutePath(ancestor);

  return normalizeAbsolutePath(path.join(canonicalAncestor, ...suffixParts));
}

function resolveRoot(projectRoot: string, writableRoot: string): string {
  if (path.isAbsolute(writableRoot)) {
    return normalizeAbsolutePath(writableRoot);
  }

  return normalizeAbsolutePath(path.resolve(projectRoot, writableRoot));
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidateKey = toComparisonKey(candidatePath);
  const rootKey = toComparisonKey(rootPath);

  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

export function buildSandboxAllowlist(input: BuildSandboxAllowlistInput): SandboxAllowlist {
  const projectRoot = normalizeAbsolutePath(input.projectRoot);
  const writableRoots = input.writableRoots.map((writableRoot) => {
    const normalizedPath = resolveRoot(projectRoot, writableRoot);

    return {
      originalPath: writableRoot,
      normalizedPath,
      canonicalPath: resolveCanonicalPathForWrite(normalizedPath),
    };
  });

  return {
    projectRoot,
    writableRoots,
  };
}

export function isWritePathAllowed(allowlist: SandboxAllowlist, targetPath: string): boolean {
  const normalizedTargetPath = normalizeAbsolutePath(targetPath);
  const canonicalTargetPath = resolveCanonicalPathForWrite(normalizedTargetPath);

  return allowlist.writableRoots.some((entry) => {
    const normalizedMatch = isWithinRoot(normalizedTargetPath, entry.normalizedPath);
    const canonicalMatch = isWithinRoot(canonicalTargetPath, entry.canonicalPath);

    return normalizedMatch && canonicalMatch;
  });
}
