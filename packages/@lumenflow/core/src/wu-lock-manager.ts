// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Lock Manager (WU-2013)
 *
 * File-level locking with stale detection for concurrent access to
 * wu-events.jsonl. Uses PID checks on same host and timeout-based
 * expiry across hosts.
 *
 * Single responsibility: file locking and stale lock detection.
 *
 * WU-2240: Prepared for proper-lockfile integration.
 *
 * @see {@link ./wu-state-store.ts} - Facade that delegates to this service
 */

import { createError, ErrorCodes } from './error-handler.js';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MS_PER_MINUTE } from './constants/duration-constants.js';
import type { LockData } from './ports/wu-state.ports.js';

// Re-export for backward compatibility (consumers importing from wu-lock-manager)
export type { LockData };

/**
 * Stale lock timeout in milliseconds (5 minutes).
 * WU-2048: Renamed from LOCK_TIMEOUT_MS to disambiguate from
 * lock-constants.ts LOCK_TIMEOUT_MS (30s acquisition timeout).
 */
const WU_LOCK_STALE_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Lock retry configuration
 */
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 100; // 5 seconds total

/**
 * Check if a process with given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without affecting it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a lock is stale (expired or dead process)
 *
 * WU-2240: Prepared for proper-lockfile integration
 */
export function isLockStale(lockData: LockData): boolean {
  const now = Date.now();
  const lockAge = now - lockData.timestamp;

  // Check timeout first (5 minutes)
  if (lockAge > WU_LOCK_STALE_TIMEOUT_MS) {
    return true;
  }

  // Check if on same host - if different host, can't check PID
  if (lockData.hostname !== os.hostname()) {
    // Different host, only rely on timeout
    return false;
  }

  // Same host - check if process is still alive
  return !isProcessRunning(lockData.pid);
}

/**
 * Safely remove a lock file, ignoring errors
 */
function safeUnlink(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore removal errors
  }
}

/**
 * Read and parse existing lock file
 */
function readLockFile(lockPath: string): LockData | null {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    return JSON.parse(content) as LockData;
  } catch {
    return null;
  }
}

/**
 * Handle existing lock file - returns true if should retry
 */
async function handleExistingLock(lockPath: string): Promise<boolean> {
  const existingLock = readLockFile(lockPath);
  if (!existingLock) {
    // Corrupted lock file - remove and retry
    safeUnlink(lockPath);
    return true;
  }

  if (isLockStale(existingLock)) {
    safeUnlink(lockPath);
    return true;
  }

  // Lock is held by active process - wait and retry
  await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
  return true;
}

/**
 * Try to create a lock file atomically
 */
async function tryCreateLock(lockPath: string, lockData: LockData): Promise<boolean> {
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = openSync(lockPath, 'wx');
    const content = JSON.stringify(lockData);
    writeFileSync(fd, content, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      return false;
    }
    throw error;
  }
}

/**
 * Acquire a file lock for the events file
 *
 * Uses a JSON lock file containing PID, timestamp, and hostname.
 * Implements stale lock detection via:
 * - PID check (on same host)
 * - 5-minute timeout (across hosts)
 *
 * WU-2240: Prepared for proper-lockfile integration
 *
 * @throws Error If lock cannot be acquired after retries
 */
export async function acquireLock(lockPath: string): Promise<void> {
  const lockData: LockData = {
    pid: process.pid,
    timestamp: Date.now(),
    hostname: os.hostname(),
  };

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    if (existsSync(lockPath)) {
      const shouldRetry = await handleExistingLock(lockPath);
      if (shouldRetry) continue;
    }

    const acquired = await tryCreateLock(lockPath, lockData);
    if (acquired) return;
  }

  throw createError(
    ErrorCodes.LOCK_ERROR,
    `Failed to acquire lock after ${LOCK_MAX_RETRIES} attempts`,
  );
}

/**
 * Release a file lock
 *
 * WU-2240: Prepared for proper-lockfile integration
 */
export function releaseLock(lockPath: string): void {
  safeUnlink(lockPath);
}
