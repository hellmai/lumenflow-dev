// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Events Cleanup (WU-1207)
 *
 * Archive old WU events to prevent unbounded growth of wu-events.jsonl.
 * Moves completed WU events older than 90d to .lumenflow/archive/wu-events-YYYY-MM.jsonl.
 * Keeps active WU events intact.
 *
 * Features:
 * - Configurable archiveAfter threshold (default: 90 days)
 * - Groups events by WU ID for atomic archival
 * - Monthly archive file rollup
 * - Active WU protection (in_progress/blocked/waiting never archived)
 * - Dry-run mode for preview
 *
 * Reuses atomic write patterns from wu-state-store.ts.
 *
 * @see {@link packages/@lumenflow/core/src/__tests__/wu-events-cleanup.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import {
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ms = require('ms') as (value: string) => number;
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import { WUStateStore, WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import type { EventArchivalConfig } from './lumenflow-config-schema.js';
import { MS_PER_DAY } from './constants/duration-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

// Re-export the type for convenience
export type { EventArchivalConfig };

// WU-2044: Use canonical MS_PER_DAY from duration-constants.ts
const ONE_DAY_MS = MS_PER_DAY;

/**
 * Import centralized path constants (WU-1430)
 */
import { LUMENFLOW_PATHS, WU_STATUS, type NodeFsError } from './wu-constants.js';

/**
 * Default event archival configuration
 */
export const DEFAULT_EVENT_ARCHIVAL_CONFIG: EventArchivalConfig = {
  archiveAfter: 90 * ONE_DAY_MS,
  keepArchives: true,
};

/**
 * Context for archive decision making
 */
export interface ArchiveContext {
  /** Current timestamp for age calculations */
  now: number;
  /** Set of WU IDs that are currently active (in_progress/blocked/waiting) */
  activeWuIds: Set<string>;
}

/**
 * Result of shouldArchiveEvent decision
 */
export interface ArchiveDecision {
  archive: boolean;
  reason: string;
}

/**
 * Breakdown of archival by category
 */
export interface ArchivalBreakdown {
  archivedOlderThanThreshold: number;
  retainedActiveWu: number;
  retainedWithinThreshold: number;
}

/**
 * Options for archiveWuEvents operation
 */
export interface ArchiveWuEventsOptions {
  /** If true, preview without modifications */
  dryRun?: boolean;
  /** Archive threshold duration string (e.g., '90d') */
  archiveAfter?: string;
  /** Archive threshold in milliseconds (alternative to archiveAfter string) */
  archiveAfterMs?: number;
  /** Current timestamp for testing (defaults to Date.now()) */
  now?: number;
  /** Function to get active WU IDs (override for testing) */
  getActiveWuIds?: (baseDir: string) => Promise<Set<string>>;
}

/**
 * Result of archiveWuEvents operation
 */
export interface ArchiveWuEventsResult {
  /** Whether archival succeeded */
  success: boolean;
  /** WU IDs that were archived */
  archivedWuIds: string[];
  /** WU IDs that were retained */
  retainedWuIds: string[];
  /** Total number of events archived */
  archivedEventCount: number;
  /** Total number of events retained */
  retainedEventCount: number;
  /** Approximate bytes moved to archive */
  bytesArchived: number;
  /** True if in dry-run mode */
  dryRun?: boolean;
  /** Breakdown by category */
  breakdown: ArchivalBreakdown;
}

// NodeFsError imported from wu-constants.ts (WU-1548: consolidated)

/**
 * Parse an archiveAfter duration string into milliseconds.
 *
 * Uses the `ms` package to parse human-readable duration strings.
 *
 * @param archiveAfterString - Duration string (e.g., '90d', '30d', '24h')
 * @returns Duration in milliseconds
 * @throws If format is invalid
 *
 * @example
 * parseArchiveAfter('90d');  // 7776000000 (90 days in ms)
 * parseArchiveAfter('30d');  // 2592000000 (30 days in ms)
 */
export function parseArchiveAfter(archiveAfterString: string): number {
  if (!archiveAfterString || typeof archiveAfterString !== 'string') {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      'Invalid archiveAfter format: duration string is required',
    );
  }

  const trimmed = archiveAfterString.trim();
  if (!trimmed) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      'Invalid archiveAfter format: duration string is required',
    );
  }

  const result = ms(trimmed);

  if (!Number.isFinite(result) || result <= 0) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      `Invalid archiveAfter format: "${archiveAfterString}" is not a valid duration`,
    );
  }

  return result;
}

/**
 * Get the archive file path for a given event timestamp.
 *
 * Groups events by month into files like:
 * .lumenflow/archive/wu-events-2026-01.jsonl
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Relative path to archive file
 *
 * @example
 * getArchiveFilePath('2026-01-15T10:30:00.000Z');
 * // Returns: '.lumenflow/archive/wu-events-2026-01.jsonl'
 */
export function getArchiveFilePath(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${LUMENFLOW_PATHS.ARCHIVE_DIR}/wu-events-${year}-${month}.jsonl`;
}

/**
 * Check if an event's WU is older than the archive threshold.
 *
 * Uses the complete event timestamp (if WU is done) to determine age.
 *
 * @param timestamp - Event timestamp
 * @param archiveAfterMs - Threshold in milliseconds
 * @param now - Current timestamp
 * @returns True if event is older than threshold
 */
function isOlderThanThreshold(timestamp: string, archiveAfterMs: number, now: number): boolean {
  const eventTime = new Date(timestamp).getTime();

  if (Number.isNaN(eventTime)) {
    return false; // Invalid timestamp - safer to retain
  }

  const age = now - eventTime;
  return age > archiveAfterMs;
}

/**
 * Determine if an event should be archived based on WU status and age.
 *
 * Policy rules (checked in order):
 * 1. Active WU events (in_progress/blocked/waiting) are never archived
 * 2. Completed WU events older than threshold are archived
 * 3. Otherwise, event is retained
 *
 * @param event - WU event to check
 * @param config - Archival configuration
 * @param context - Archive context (now timestamp, active WU IDs)
 * @returns Archive decision with reason
 */
export function shouldArchiveEvent(
  event: WUEvent,
  config: EventArchivalConfig,
  context: ArchiveContext,
): ArchiveDecision {
  const { now, activeWuIds } = context;

  // Active WU protection: events linked to in_progress/blocked/waiting WUs are always retained
  if (activeWuIds.has(event.wuId)) {
    return { archive: false, reason: 'active-wu-protected' };
  }

  // Check age threshold
  if (isOlderThanThreshold(event.timestamp, config.archiveAfter, now)) {
    return { archive: true, reason: 'completed-older-than-threshold' };
  }

  // Default: retain
  return { archive: false, reason: 'within-retention-period' };
}

/**
 * Load all events from wu-events.jsonl file.
 *
 * @param baseDir - Project base directory
 * @returns Array of all WU events
 */
async function loadAllEvents(baseDir: string): Promise<WUEvent[]> {
  const eventsPath = path.join(baseDir, LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);

  try {
    const content = await fs.readFile(eventsPath, { encoding: 'utf-8' as BufferEncoding });
    const lines = content.split('\n').filter((line) => line.trim());
    return lines.map((line) => {
      const parsed = JSON.parse(line);
      const validation = validateWUEvent(parsed);
      if (!validation.success) {
        // Return as-is if validation fails (repair later)
        return parsed as WUEvent;
      }
      return validation.data;
    });
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get active WU IDs by replaying events to determine current state.
 *
 * A WU is active if its last status-changing event leaves it in:
 * - in_progress (claim without complete)
 * - blocked (block without unblock)
 * - waiting (could be future state)
 *
 * @param baseDir - Project base directory
 * @returns Set of active WU IDs
 */
async function getActiveWuIdsFromStore(baseDir: string): Promise<Set<string>> {
  const store = new WUStateStore(path.join(baseDir, LUMENFLOW_PATHS.STATE_DIR));
  await store.load();

  const activeStatuses = [WU_STATUS.IN_PROGRESS, WU_STATUS.BLOCKED, 'waiting'];
  const activeIds = new Set<string>();

  for (const status of activeStatuses) {
    const wuIds = store.getByStatus(status);
    for (const wuId of wuIds) {
      activeIds.add(wuId);
    }
  }

  return activeIds;
}

/**
 * Build archival configuration from options.
 *
 * @param options - Archive options
 * @returns Effective archival configuration
 */
function buildArchivalConfig(options: ArchiveWuEventsOptions): EventArchivalConfig {
  const { archiveAfter, archiveAfterMs: providedArchiveAfterMs } = options;

  let archiveAfterMs = providedArchiveAfterMs ?? DEFAULT_EVENT_ARCHIVAL_CONFIG.archiveAfter;
  if (archiveAfter && !providedArchiveAfterMs) {
    archiveAfterMs = parseArchiveAfter(archiveAfter);
  }

  return {
    archiveAfter: archiveAfterMs,
    keepArchives: DEFAULT_EVENT_ARCHIVAL_CONFIG.keepArchives,
  };
}

/**
 * Group events by WU ID for atomic archival.
 *
 * @param events - Array of WU events
 * @returns Map of WU ID to events array
 */
function groupEventsByWuId(events: WUEvent[]): Map<string, WUEvent[]> {
  const grouped = new Map<string, WUEvent[]>();

  for (const event of events) {
    const existing = grouped.get(event.wuId) ?? [];
    existing.push(event);
    grouped.set(event.wuId, existing);
  }

  return grouped;
}

/**
 * Get the most recent event timestamp for a WU.
 *
 * @param events - Events for a single WU
 * @returns Most recent timestamp
 */
function getMostRecentTimestamp(events: WUEvent[]): string {
  const firstEvent = events[0];
  if (!firstEvent) {
    return new Date(0).toISOString();
  }
  let mostRecent = firstEvent.timestamp;
  for (const event of events) {
    if (new Date(event.timestamp) > new Date(mostRecent)) {
      mostRecent = event.timestamp;
    }
  }
  return mostRecent;
}

/**
 * Group events by archive file path (monthly buckets).
 *
 * @param events - Events to group
 * @returns Map of archive file path to events
 */
function groupEventsByArchivePath(events: WUEvent[]): Map<string, WUEvent[]> {
  const grouped = new Map<string, WUEvent[]>();

  for (const event of events) {
    const archivePath = getArchiveFilePath(event.timestamp);
    const existing = grouped.get(archivePath) ?? [];
    existing.push(event);
    grouped.set(archivePath, existing);
  }

  return grouped;
}

/**
 * Calculate byte size of events when serialized.
 *
 * @param events - Events to measure
 * @returns Approximate byte size
 */
function estimateEventsBytes(events: WUEvent[]): number {
  return events.reduce((total, event) => total + JSON.stringify(event).length + 1, 0);
}

/**
 * Write retained events back to wu-events.jsonl.
 *
 * Uses atomic write pattern: temp file + fsync + rename.
 *
 * @param baseDir - Project base directory
 * @param events - Events to write
 */
async function writeRetainedEvents(baseDir: string, events: WUEvent[]): Promise<void> {
  const eventsPath = path.join(baseDir, LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);
  const tempPath = `${eventsPath}.tmp.${process.pid}`;
  const content = events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');

  try {
    const fd = openSync(tempPath, 'w');
    writeFileSync(fd, content, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);

    // Atomic rename
    renameSync(tempPath, eventsPath);

    // Fsync directory
    const dirPath = path.dirname(eventsPath);
    const dirFd = openSync(dirPath, 'r');
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch (error) {
    // Cleanup temp file on failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Append events to archive file.
 *
 * Creates archive directory and file if they don't exist.
 * Appends to existing archive file for monthly rollup.
 *
 * @param baseDir - Project base directory
 * @param archivePath - Relative path to archive file
 * @param events - Events to append
 */
async function appendToArchive(
  baseDir: string,
  archivePath: string,
  events: WUEvent[],
): Promise<void> {
  const fullPath = path.join(baseDir, archivePath);
  const dirPath = path.dirname(fullPath);

  // Ensure archive directory exists
  mkdirSync(dirPath, { recursive: true });

  const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';

  // Append to archive file (creates if doesn't exist)

  await fs.appendFile(fullPath, content, 'utf-8');
}

/**
 * Archive old WU events to monthly archive files.
 *
 * Moves completed WU events older than threshold to archive files.
 * Events are grouped by WU ID so all events for a WU are archived together.
 * Active WU events (in_progress/blocked/waiting) are never archived.
 *
 * @param baseDir - Project base directory
 * @param options - Archive options
 * @returns Archive result with statistics
 *
 * @example
 * // Preview archival
 * const preview = await archiveWuEvents(baseDir, { dryRun: true });
 * console.log(`Would archive ${preview.archivedWuIds.length} WUs`);
 *
 * @example
 * // Archive with custom threshold
 * const result = await archiveWuEvents(baseDir, { archiveAfter: '30d' });
 */
export async function archiveWuEvents(
  baseDir: string,
  options: ArchiveWuEventsOptions = {},
): Promise<ArchiveWuEventsResult> {
  const { dryRun = false, now = Date.now(), getActiveWuIds = getActiveWuIdsFromStore } = options;

  const config = buildArchivalConfig(options);
  const events = await loadAllEvents(baseDir);
  const activeWuIds = await getActiveWuIds(baseDir);

  // Group events by WU ID for atomic archival decisions
  const eventsByWu = groupEventsByWuId(events);

  // Determine which WUs to archive
  const archivedWuIds: string[] = [];
  const retainedWuIds: string[] = [];
  const eventsToArchive: WUEvent[] = [];
  const eventsToRetain: WUEvent[] = [];
  const breakdown: ArchivalBreakdown = {
    archivedOlderThanThreshold: 0,
    retainedActiveWu: 0,
    retainedWithinThreshold: 0,
  };

  for (const [wuId, wuEvents] of eventsByWu) {
    // Check if WU is active - if so, retain all events
    if (activeWuIds.has(wuId)) {
      retainedWuIds.push(wuId);
      eventsToRetain.push(...wuEvents);
      breakdown.retainedActiveWu++;
      continue;
    }

    // Check age based on most recent event
    const mostRecentTimestamp = getMostRecentTimestamp(wuEvents);
    const decision = shouldArchiveEvent(
      { wuId, timestamp: mostRecentTimestamp } as WUEvent,
      config,
      { now, activeWuIds },
    );

    if (decision.archive) {
      archivedWuIds.push(wuId);
      eventsToArchive.push(...wuEvents);
      breakdown.archivedOlderThanThreshold++;
    } else {
      retainedWuIds.push(wuId);
      eventsToRetain.push(...wuEvents);
      breakdown.retainedWithinThreshold++;
    }
  }

  const bytesArchived = estimateEventsBytes(eventsToArchive);

  const baseResult: ArchiveWuEventsResult = {
    success: true,
    archivedWuIds,
    retainedWuIds,
    archivedEventCount: eventsToArchive.length,
    retainedEventCount: eventsToRetain.length,
    bytesArchived,
    breakdown,
  };

  if (dryRun) {
    return { ...baseResult, dryRun: true };
  }

  // Actually archive events
  if (eventsToArchive.length > 0) {
    // Group by archive file path (monthly)
    const archiveGroups = groupEventsByArchivePath(eventsToArchive);

    // Write to archive files
    for (const [archivePath, archiveEvents] of archiveGroups) {
      await appendToArchive(baseDir, archivePath, archiveEvents);
    }

    // Write retained events back to main file
    await writeRetainedEvents(baseDir, eventsToRetain);
  }

  return baseResult;
}
