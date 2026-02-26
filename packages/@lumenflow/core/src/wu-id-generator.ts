// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU ID Generator (WU-1246, WU-2208)
 *
 * Auto-generates sequential WU IDs by scanning existing WU YAML files.
 * Provides race-condition handling via retry mechanism.
 *
 * WU-2208: Extended to scan remote state (origin/main) for YAML files,
 * stamps, and wu-events.jsonl to prevent cross-machine ID collisions.
 *
 * @module wu-id-generator
 */

import { existsSync, readdirSync } from 'node:fs';
import { WU_PATHS } from './wu-paths.js';
import { createError, ErrorCodes } from './error-handler.js';
import type { IWuIdGitAdapter } from './ports/sync-validator.ports.js';

// Re-export the adapter type for consumers
export type { IWuIdGitAdapter } from './ports/sync-validator.ports.js';

/** WU ID prefix constant */
export const WU_ID_PREFIX = 'WU-';

/** Default maximum retry attempts for race condition handling */
const DEFAULT_MAX_RETRIES = 5;

/** Retry delay in milliseconds (exponential backoff base) */
const RETRY_DELAY_BASE_MS = 50;

/** Default git ref for remote state */
const DEFAULT_REMOTE_REF = 'origin/main';

/** Log prefix for console output */
const LOG_PREFIX = '[wu-id-generator]';

/** Relative path to wu-events.jsonl from repo root */
const WU_EVENTS_RELATIVE_PATH = '.lumenflow/state/wu-events.jsonl';

/**
 * Parse the numeric part from a WU ID string.
 *
 * Supports formats:
 * - WU-123 (direct ID)
 * - WU-123.yaml (filename)
 * - WU-123.done (stamp filename)
 *
 * @param wuIdOrFilename - WU ID or filename to parse
 * @returns Numeric ID or null if invalid format
 */
export function parseWuIdNumber(wuIdOrFilename: string): number | null {
  if (!wuIdOrFilename || typeof wuIdOrFilename !== 'string') {
    return null;
  }

  // Remove .yaml or .done extension if present
  const wuId = wuIdOrFilename.replace(/\.(yaml|done)$/, '');

  // Match WU-{number} pattern using RegExp method per sonarjs/prefer-regexp-exec
  const WU_ID_PATTERN = /^WU-(\d+)$/;
  const regexResult = WU_ID_PATTERN.exec(wuId);
  if (!regexResult) {
    return null;
  }

  const idSegment = regexResult[1];
  if (!idSegment) {
    return null;
  }
  const num = parseInt(idSegment, 10);
  return isNaN(num) ? null : num;
}

/**
 * Extract the highest WU ID number from a list of filenames.
 *
 * WU-2208: Utility function used by both local and remote scanning.
 * Handles both .yaml and .done suffixes.
 *
 * @param entries - Array of filenames to scan
 * @returns Highest WU ID number or 0 if none found
 */
export function extractHighestIdFromEntries(entries: string[]): number {
  let highest = 0;
  for (const entry of entries) {
    const num = parseWuIdNumber(entry);
    if (num !== null && num > highest) {
      highest = num;
    }
  }
  return highest;
}

/**
 * Extract the highest WU ID number from wu-events.jsonl content.
 *
 * WU-2208: Parses JSONL lines and extracts wuId fields.
 * Malformed lines are silently skipped (events files may have corruption).
 *
 * @param eventsContent - Raw content of wu-events.jsonl
 * @returns Highest WU ID number or 0 if none found
 */
export function getHighestWuIdFromEvents(eventsContent: string): number {
  if (!eventsContent || eventsContent.trim().length === 0) {
    return 0;
  }

  let highest = 0;
  const lines = eventsContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed) as { wuId?: string };
      if (typeof event.wuId === 'string') {
        const num = parseWuIdNumber(event.wuId);
        if (num !== null && num > highest) {
          highest = num;
        }
      }
    } catch {
      // Skip malformed JSON lines
    }
  }
  return highest;
}

/**
 * Get the highest WU ID number from the local WU directory.
 *
 * Scans all WU-*.yaml files and returns the highest numeric ID found.
 * Returns 0 if directory doesn't exist or contains no valid WU files.
 *
 * @returns Highest WU ID number or 0 if none found
 */
export function getHighestWuId(): number {
  const wuDir = WU_PATHS.WU_DIR();

  if (!existsSync(wuDir)) {
    return 0;
  }

  const files = readdirSync(wuDir);
  return extractHighestIdFromEntries(files as unknown as string[]);
}

/**
 * Get the highest WU ID number from local stamps directory.
 *
 * WU-2208: Scans .lumenflow/stamps/ for WU-*.done files.
 * Returns 0 if directory doesn't exist or contains no valid stamp files.
 *
 * @returns Highest WU ID number or 0 if none found
 */
function getHighestLocalStampId(): number {
  const stampsDir = WU_PATHS.STAMPS_DIR();

  if (!existsSync(stampsDir)) {
    return 0;
  }

  const files = readdirSync(stampsDir);
  return extractHighestIdFromEntries(files as unknown as string[]);
}

/**
 * Get the next available WU ID.
 *
 * Returns the next sequential ID after the highest existing WU.
 * Does not fill gaps - always returns highest + 1.
 *
 * @returns Next WU ID in format "WU-{number}"
 */
export function getNextWuId(): string {
  const highest = getHighestWuId();
  return `${WU_ID_PREFIX}${highest + 1}`;
}

/** Options for generateWuIdWithRetry */
interface GenerateOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
}

/**
 * Generate a unique WU ID with retry handling for race conditions.
 *
 * This function handles concurrent wu:create calls by:
 * 1. Generating the next sequential ID
 * 2. Checking if the file already exists (race condition detection)
 * 3. Retrying with exponential backoff if conflict detected
 *
 * @param options - Generation options
 * @returns Promise resolving to unique WU ID
 * @throws Error if max retries exceeded
 */
export async function generateWuIdWithRetry(options: GenerateOptions = {}): Promise<string> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const nextId = getNextWuId();
    const wuPath = WU_PATHS.WU(nextId);

    // Check if file already exists (race condition)
    if (!existsSync(wuPath)) {
      return nextId;
    }

    // Exponential backoff before retry
    const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw createError(
    ErrorCodes.ID_GENERATION_FAILED,
    `Failed to generate unique WU ID after ${maxRetries} attempts`,
  );
}

/** Options for remote-aware ID generation */
export interface RemoteAwareIdOptions {
  /** Git adapter for remote operations */
  git: IWuIdGitAdapter;
  /** Skip remote fetch and use local-only (default: false) */
  offline?: boolean;
  /** Git ref for remote state (default: 'origin/main') */
  remoteRef?: string;
}

/**
 * Get the highest WU ID considering both local and remote state.
 *
 * WU-2208: Scans 5 sources for the highest WU ID:
 * 1. Local YAML directory (docs/04-operations/tasks/wu/)
 * 2. Local stamps directory (.lumenflow/stamps/)
 * 3. Remote YAML directory at ref (origin/main)
 * 4. Remote stamps directory at ref (origin/main)
 * 5. Remote wu-events.jsonl at ref (origin/main)
 *
 * When offline=true, only local sources (1, 2) are scanned and a warning
 * is printed to stderr.
 *
 * When remote operations fail (network error, no remote), falls back to
 * local-only with a warning. This ensures the function never blocks
 * on transient network issues.
 *
 * @param options - Configuration including git adapter and offline flag
 * @returns Highest WU ID number across all scanned sources
 */
export async function getHighestWuIdRemoteAware(options: RemoteAwareIdOptions): Promise<number> {
  const { git, offline = false, remoteRef = DEFAULT_REMOTE_REF } = options;

  // Source 1: Local YAML
  const localYamlHighest = getHighestWuId();

  // Source 2: Local stamps
  const localStampHighest = getHighestLocalStampId();

  let localMax = Math.max(localYamlHighest, localStampHighest);

  if (offline) {
    console.warn(
      `${LOG_PREFIX} offline mode: skipping remote state check. ID collision risk if other machines have created WUs.`,
    );
    return localMax;
  }

  // Attempt remote scanning with graceful fallback
  try {
    // Fetch latest remote refs
    await git.fetch();

    const wuDir = WU_PATHS.WU_DIR();
    const stampsDir = WU_PATHS.STAMPS_DIR();

    // Sources 3, 4, 5: Remote YAML, stamps, and events (parallel)
    const [remoteYamlEntries, remoteStampEntries, remoteEventsContent] = await Promise.all([
      git.listTreeAtRef(remoteRef, wuDir),
      git.listTreeAtRef(remoteRef, stampsDir),
      git.showFileAtRef(remoteRef, WU_EVENTS_RELATIVE_PATH),
    ]);

    // Source 3: Remote YAML
    const remoteYamlHighest = extractHighestIdFromEntries(remoteYamlEntries);

    // Source 4: Remote stamps
    const remoteStampHighest = extractHighestIdFromEntries(remoteStampEntries);

    // Source 5: Remote wu-events.jsonl
    const remoteEventsHighest = getHighestWuIdFromEvents(remoteEventsContent);

    const remoteMax = Math.max(remoteYamlHighest, remoteStampHighest, remoteEventsHighest);
    localMax = Math.max(localMax, remoteMax);
  } catch {
    console.warn(
      `${LOG_PREFIX} Failed to check remote state. Falling back to local-only ID generation. ID collision risk if other machines have created WUs.`,
    );
  }

  return localMax;
}
