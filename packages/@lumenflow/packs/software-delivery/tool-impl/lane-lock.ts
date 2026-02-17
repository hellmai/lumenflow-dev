/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UTF8_ENCODING } from '../constants.js';

export interface LaneLockMetadata {
  lane: string;
  wuId: string;
  owner: string;
  timestamp: string;
}

export interface AcquireLaneLockInput {
  lane: string;
  wuId: string;
  owner: string;
  locksDir: string;
  staleAfterMs?: number;
}

export interface AcquireLaneLockResult {
  acquired: boolean;
  is_stale: boolean;
  lock_path: string;
}

export interface ReleaseLaneLockInput {
  lane: string;
  owner: string;
  locksDir: string;
}

export interface ReleaseLaneLockResult {
  released: boolean;
  lock_path: string;
}

function laneToLockFileName(lane: string): string {
  const chars: string[] = [];
  for (const char of lane.toLowerCase()) {
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
      chars.push(char);
      continue;
    }
    if (chars[chars.length - 1] !== '-') {
      chars.push('-');
    }
  }
  let normalized = chars.join('');
  while (normalized.startsWith('-')) {
    normalized = normalized.slice(1);
  }
  while (normalized.endsWith('-')) {
    normalized = normalized.slice(0, -1);
  }
  return `${normalized || 'lane'}.lock`;
}

function lockPathFor(input: { lane: string; locksDir: string }): string {
  return path.join(input.locksDir, laneToLockFileName(input.lane));
}

function isStale(metadata: LaneLockMetadata, staleAfterMs: number): boolean {
  const lockTime = new Date(metadata.timestamp).getTime();
  return Number.isFinite(lockTime) && Date.now() - lockTime > staleAfterMs;
}

function staleTakeoverMarkerPath(lockPath: string): string {
  return `${lockPath}.takeover`;
}

async function acquireTakeoverMarker(
  markerPath: string,
  metadata: LaneLockMetadata,
): Promise<boolean> {
  try {
    await writeFile(markerPath, JSON.stringify(metadata), { encoding: UTF8_ENCODING, flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

export async function readLaneLockMetadata(lockPath: string): Promise<LaneLockMetadata | null> {
  try {
    const raw = await readFile(lockPath, UTF8_ENCODING);
    const parsed = JSON.parse(raw) as LaneLockMetadata;
    if (
      typeof parsed.lane !== 'string' ||
      typeof parsed.wuId !== 'string' ||
      typeof parsed.owner !== 'string' ||
      typeof parsed.timestamp !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function acquireLaneLockTool(
  input: AcquireLaneLockInput,
): Promise<AcquireLaneLockResult> {
  await mkdir(input.locksDir, { recursive: true });
  const lockPath = lockPathFor(input);
  const staleAfterMs = input.staleAfterMs ?? 2 * 60 * 60 * 1000;
  const nextMetadata: LaneLockMetadata = {
    lane: input.lane,
    wuId: input.wuId,
    owner: input.owner,
    timestamp: new Date().toISOString(),
  };

  try {
    await writeFile(lockPath, JSON.stringify(nextMetadata), {
      encoding: UTF8_ENCODING,
      flag: 'wx',
    });
    return {
      acquired: true,
      is_stale: false,
      lock_path: lockPath,
    };
  } catch (error) {
    const isExists = (error as NodeJS.ErrnoException).code === 'EEXIST';
    if (!isExists) {
      throw error;
    }

    const existing = await readLaneLockMetadata(lockPath);
    if (existing && isStale(existing, staleAfterMs)) {
      const takeoverMarkerPath = staleTakeoverMarkerPath(lockPath);
      const wonTakeoverRace = await acquireTakeoverMarker(takeoverMarkerPath, nextMetadata);
      if (!wonTakeoverRace) {
        return {
          acquired: false,
          is_stale: false,
          lock_path: lockPath,
        };
      }

      try {
        const current = await readLaneLockMetadata(lockPath);
        if (!current || !isStale(current, staleAfterMs)) {
          return {
            acquired: false,
            is_stale: false,
            lock_path: lockPath,
          };
        }

        await unlink(lockPath).catch((unlinkError) => {
          const nodeError = unlinkError as NodeJS.ErrnoException;
          if (nodeError.code === 'ENOENT') {
            return;
          }
          throw unlinkError;
        });

        try {
          await writeFile(lockPath, JSON.stringify(nextMetadata), {
            encoding: UTF8_ENCODING,
            flag: 'wx',
          });
        } catch (writeError) {
          if ((writeError as NodeJS.ErrnoException).code === 'EEXIST') {
            return {
              acquired: false,
              is_stale: false,
              lock_path: lockPath,
            };
          }
          throw writeError;
        }

        return {
          acquired: true,
          is_stale: true,
          lock_path: lockPath,
        };
      } finally {
        await unlink(takeoverMarkerPath).catch(() => {
          // Best-effort marker cleanup.
        });
      }
    }

    return {
      acquired: false,
      is_stale: false,
      lock_path: lockPath,
    };
  }
}

export async function releaseLaneLockTool(
  input: ReleaseLaneLockInput,
): Promise<ReleaseLaneLockResult> {
  const lockPath = lockPathFor(input);
  const metadata = await readLaneLockMetadata(lockPath);
  if (!metadata || metadata.owner !== input.owner) {
    return {
      released: false,
      lock_path: lockPath,
    };
  }

  await unlink(lockPath);
  return {
    released: true,
    lock_path: lockPath,
  };
}
