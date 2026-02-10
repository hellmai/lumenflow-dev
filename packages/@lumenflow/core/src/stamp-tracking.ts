import path from 'node:path';
import { createGitForPath } from './git-adapter.js';

interface TrackedStampOptions {
  projectRoot: string;
  stampsDir: string;
  gitRaw?: (args: string[]) => Promise<string>;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function stampIdFromFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = path.posix.basename(normalized);
  if (!fileName.startsWith('WU-') || !fileName.endsWith('.done')) {
    return null;
  }
  return fileName.slice(0, -'.done'.length);
}

/**
 * Return tracked WU stamp IDs from git index.
 * Returns null when git query is unavailable so callers can safely fall back.
 */
export async function listTrackedWUStampIds({
  projectRoot,
  stampsDir,
  gitRaw,
}: TrackedStampOptions): Promise<Set<string> | null> {
  try {
    const raw = gitRaw ?? ((args: string[]) => createGitForPath(projectRoot).raw(args));
    const stampsDirRelative = path.isAbsolute(stampsDir)
      ? path.relative(projectRoot, stampsDir)
      : stampsDir;
    const pathspec = `${toPosixPath(stampsDirRelative)}/WU-*.done`;
    const output = await raw(['ls-files', '--', pathspec]);
    const tracked = new Set<string>();
    for (const line of output.split('\n')) {
      const value = line.trim();
      if (!value) continue;
      const id = stampIdFromFilePath(value);
      if (id) tracked.add(id);
    }
    return tracked;
  } catch {
    return null;
  }
}
