// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signal Cleanup Core (WU-1204)
 *
 * TTL-based cleanup for signals to prevent unbounded growth.
 * Implements configurable retention policies:
 * - Read signals: 7 days default TTL
 * - Unread signals: 30 days default TTL
 * - Max entries: 500 default
 * - Active WU protection: signals linked to in_progress/blocked WUs are never removed
 *
 * Reuses patterns from mem-cleanup-core.ts.
 *
 * @see {@link packages/@lumenflow/cli/src/signal-cleanup.ts} - CLI wrapper
 * @see {@link packages/@lumenflow/memory/src/__tests__/signal-cleanup-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ms = require('ms') as (value: string) => number;
import type { NodeFsError } from '@lumenflow/core/wu-constants';
import { MS_PER_DAY } from '@lumenflow/core/constants/duration-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';
import {
  SIGNAL_FILE_NAME,
  SIGNAL_RECEIPTS_FILE_NAME,
  type Signal,
  type SignalReceipt,
} from './mem-signal-core.js';

/**
 * Signal cleanup configuration
 */
export interface SignalCleanupConfig {
  /** TTL for read signals in milliseconds (default: 7 days) */
  ttl: number;
  /** TTL for unread signals in milliseconds (default: 30 days) */
  unreadTtl: number;
  /** Maximum number of signals to retain (default: 500) */
  maxEntries: number;
}

/**
 * Default signal cleanup configuration
 */
export const DEFAULT_SIGNAL_CLEANUP_CONFIG: SignalCleanupConfig = {
  ttl: 7 * MS_PER_DAY,
  unreadTtl: 30 * MS_PER_DAY,
  maxEntries: 500,
};

/**
 * Breakdown of cleanup by category
 */
export interface CleanupBreakdown {
  ttlExpired: number;
  unreadTtlExpired: number;
  countLimitExceeded: number;
  activeWuProtected: number;
}

/**
 * Result of cleanup operation
 */
export interface CleanupSignalsResult {
  /** Whether cleanup succeeded */
  success: boolean;
  /** IDs of removed signals */
  removedIds: string[];
  /** IDs of retained signals */
  retainedIds: string[];
  /** Approximate bytes freed (0 if dry-run) */
  bytesFreed: number;
  /** Ratio of removed to total signals */
  compactionRatio: number;
  /** True if in dry-run mode */
  dryRun?: boolean;
  /** Breakdown by category */
  breakdown: CleanupBreakdown;
}

/**
 * Options for cleanup operation
 */
export interface CleanupSignalsOptions {
  /** If true, preview without modifications */
  dryRun?: boolean;
  /** TTL duration string for read signals (e.g., '7d', '24h') */
  ttl?: string;
  /** TTL in milliseconds for read signals (alternative to ttl string) */
  ttlMs?: number;
  /** TTL duration string for unread signals (e.g., '30d') */
  unreadTtl?: string;
  /** TTL in milliseconds for unread signals */
  unreadTtlMs?: number;
  /** Maximum number of signals to retain */
  maxEntries?: number;
  /** Current timestamp for testing (defaults to Date.now()) */
  now?: number;
  /** Function to get active WU IDs (in_progress/blocked) */
  getActiveWuIds?: () => Promise<Set<string>>;
}

/**
 * Context for shouldRemoveSignal decision
 */
export interface RemovalContext {
  now: number;
  activeWuIds: Set<string>;
}

/**
 * Result of shouldRemoveSignal decision
 */
export interface RemovalDecision {
  remove: boolean;
  reason: string;
}

// WU-1548: NodeFsError imported from @lumenflow/core/wu-constants (consolidated)

/**
 * Parse a TTL duration string into milliseconds.
 *
 * Uses the `ms` package to parse human-readable duration strings.
 *
 * @param ttlString - TTL string (e.g., '7d', '30d', '24h', '60m')
 * @returns TTL in milliseconds
 * @throws If TTL format is invalid
 *
 * @example
 * parseSignalTtl('7d');  // 604800000 (7 days in ms)
 * parseSignalTtl('30d'); // 2592000000 (30 days in ms)
 * parseSignalTtl('24h'); // 86400000 (24 hours in ms)
 */
export function parseSignalTtl(ttlString: string): number {
  if (!ttlString || typeof ttlString !== 'string') {
    throw createError(ErrorCodes.INVALID_DURATION, 'Invalid TTL format: TTL string is required');
  }

  const trimmed = ttlString.trim();
  if (!trimmed) {
    throw createError(ErrorCodes.INVALID_DURATION, 'Invalid TTL format: TTL string is required');
  }

  // Use ms package to parse the duration
  const result = ms(trimmed);

  if (result == null || result <= 0) {
    throw createError(
      ErrorCodes.INVALID_DURATION,
      `Invalid TTL format: "${ttlString}" is not a valid duration`,
    );
  }

  return result;
}

/**
 * Check if a signal has expired based on TTL.
 *
 * @param signal - Signal to check
 * @param ttlMs - TTL in milliseconds
 * @param now - Current timestamp
 * @returns True if signal is older than TTL
 */
function isSignalExpired(signal: Signal, ttlMs: number, now: number): boolean {
  if (!signal.created_at) {
    return false; // No timestamp means we can't determine age - safer to retain
  }

  const createdAt = new Date(signal.created_at).getTime();

  // Invalid date - safer to retain
  if (Number.isNaN(createdAt)) {
    return false;
  }

  const age = now - createdAt;
  return age > ttlMs;
}

/**
 * Check if a signal should be removed based on TTL and active WU protection.
 *
 * Policy rules (checked in order):
 * 1. Active WU signals are always retained
 * 2. Read signals older than TTL are removed
 * 3. Unread signals older than unreadTtl are removed
 * 4. Otherwise, signal is retained
 *
 * @param signal - Signal to check
 * @param config - Cleanup configuration
 * @param context - Removal context (now timestamp, active WU IDs)
 * @returns Removal decision with reason
 */
export function shouldRemoveSignal(
  signal: Signal,
  config: SignalCleanupConfig,
  context: RemovalContext,
): RemovalDecision {
  const { now, activeWuIds } = context;

  // Active WU protection: signals linked to in_progress/blocked WUs are always retained
  if (signal.wu_id && activeWuIds.has(signal.wu_id)) {
    return { remove: false, reason: 'active-wu-protected' };
  }

  // Check TTL based on read status
  if (signal.read) {
    // Read signals use the shorter TTL
    if (isSignalExpired(signal, config.ttl, now)) {
      return { remove: true, reason: 'ttl-expired' };
    }
  } else {
    // Unread signals use the longer unreadTtl
    if (isSignalExpired(signal, config.unreadTtl, now)) {
      return { remove: true, reason: 'unread-ttl-expired' };
    }
  }

  // Default: retain
  return { remove: false, reason: 'within-ttl' };
}

/**
 * Calculate approximate byte size of a signal when serialized.
 *
 * @param signal - Signal to measure
 * @returns Approximate byte size
 */
function estimateSignalBytes(signal: Signal): number {
  // JSON.stringify + newline character
  return JSON.stringify(signal).length + 1;
}

/**
 * Calculate compaction ratio (removed / total).
 *
 * @param removedCount - Number of removed signals
 * @param totalCount - Total number of signals
 * @returns Compaction ratio (0 to 1, or 0 if no signals)
 */
function getCompactionRatio(removedCount: number, totalCount: number): number {
  if (totalCount === 0) {
    return 0;
  }
  return removedCount / totalCount;
}

/**
 * Gets the signals file path for a project.
 *
 * @param baseDir - Project base directory
 * @returns Full path to signals.jsonl
 */
function getSignalsPath(baseDir: string): string {
  return path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR, SIGNAL_FILE_NAME);
}

/**
 * Gets the signal receipts file path for a project (WU-1472).
 *
 * @param baseDir - Project base directory
 * @returns Full path to signal-receipts.jsonl
 */
function getReceiptsPath(baseDir: string): string {
  return path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR, SIGNAL_RECEIPTS_FILE_NAME);
}

/**
 * Load all receipts from the receipts file (WU-1472).
 *
 * @param baseDir - Project base directory
 * @returns Array of all receipts
 */
async function loadAllReceipts(baseDir: string): Promise<SignalReceipt[]> {
  const receiptsPath = getReceiptsPath(baseDir);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known path
    const content = await fs.readFile(receiptsPath, { encoding: 'utf-8' as BufferEncoding });
    const lines = content.split('\n').filter((line) => line.trim());
    return lines.map((line) => JSON.parse(line) as SignalReceipt);
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Write retained receipts back to file (WU-1472).
 *
 * @param baseDir - Project base directory
 * @param receipts - Receipts to write
 */
async function writeReceipts(baseDir: string, receipts: SignalReceipt[]): Promise<void> {
  const receiptsPath = getReceiptsPath(baseDir);
  const content =
    receipts.map((r) => JSON.stringify(r)).join('\n') + (receipts.length > 0 ? '\n' : '');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes known path
  await fs.writeFile(receiptsPath, content, { encoding: 'utf-8' as BufferEncoding });
}

/**
 * Load signals directly from file (for cleanup, to avoid loadSignals filter limitations).
 *
 * @param baseDir - Project base directory
 * @returns Array of all signals
 */
async function loadAllSignals(baseDir: string): Promise<Signal[]> {
  const signalsPath = getSignalsPath(baseDir);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known path
    const content = await fs.readFile(signalsPath, { encoding: 'utf-8' as BufferEncoding });
    const lines = content.split('\n').filter((line) => line.trim());
    return lines.map((line) => JSON.parse(line) as Signal);
  } catch (err) {
    const error = err as NodeFsError;
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Write retained signals back to file.
 *
 * @param baseDir - Project base directory
 * @param signals - Signals to write
 */
async function writeSignals(baseDir: string, signals: Signal[]): Promise<void> {
  const signalsPath = getSignalsPath(baseDir);
  const content =
    signals.map((s) => JSON.stringify(s)).join('\n') + (signals.length > 0 ? '\n' : '');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes known path
  await fs.writeFile(signalsPath, content, { encoding: 'utf-8' as BufferEncoding });
}

/**
 * Default function to get active WU IDs (returns empty set).
 * Override in CLI to actually query WU status.
 */
async function defaultGetActiveWuIds(): Promise<Set<string>> {
  return new Set();
}

/**
 * Build cleanup configuration from options.
 *
 * @param options - Cleanup options
 * @returns Effective cleanup configuration
 */
function buildCleanupConfig(options: CleanupSignalsOptions): SignalCleanupConfig {
  const {
    ttl,
    ttlMs: providedTtlMs,
    unreadTtl,
    unreadTtlMs: providedUnreadTtlMs,
    maxEntries,
  } = options;

  let ttlMs = providedTtlMs ?? DEFAULT_SIGNAL_CLEANUP_CONFIG.ttl;
  if (ttl && !providedTtlMs) {
    ttlMs = parseSignalTtl(ttl);
  }

  let unreadTtlMs = providedUnreadTtlMs ?? DEFAULT_SIGNAL_CLEANUP_CONFIG.unreadTtl;
  if (unreadTtl && !providedUnreadTtlMs) {
    unreadTtlMs = parseSignalTtl(unreadTtl);
  }

  return {
    ttl: ttlMs,
    unreadTtl: unreadTtlMs,
    maxEntries: maxEntries ?? DEFAULT_SIGNAL_CLEANUP_CONFIG.maxEntries,
  };
}

/**
 * State for tracking cleanup decisions
 */
interface CleanupState {
  removedIds: string[];
  retainedIds: string[];
  retainedSignals: Signal[];
  bytesFreed: number;
  breakdown: CleanupBreakdown;
}

/**
 * Process signals for TTL-based removal decisions.
 *
 * @param signals - All signals to process
 * @param config - Cleanup configuration
 * @param context - Removal context
 * @returns Cleanup state after TTL processing
 */
function processSignalsForTtl(
  signals: Signal[],
  config: SignalCleanupConfig,
  context: RemovalContext,
): CleanupState {
  const state: CleanupState = {
    removedIds: [],
    retainedIds: [],
    retainedSignals: [],
    bytesFreed: 0,
    breakdown: {
      ttlExpired: 0,
      unreadTtlExpired: 0,
      countLimitExceeded: 0,
      activeWuProtected: 0,
    },
  };

  for (const signal of signals) {
    const decision = shouldRemoveSignal(signal, config, context);
    processSignalDecision(signal, decision, state);
  }

  return state;
}

/**
 * Process a single signal's removal decision and update state.
 *
 * @param signal - Signal being processed
 * @param decision - Removal decision for this signal
 * @param state - Cleanup state to update
 */
function processSignalDecision(
  signal: Signal,
  decision: RemovalDecision,
  state: CleanupState,
): void {
  if (decision.remove) {
    state.removedIds.push(signal.id);
    state.bytesFreed += estimateSignalBytes(signal);
    updateBreakdownForRemoval(decision.reason, state.breakdown);
  } else {
    state.retainedIds.push(signal.id);
    state.retainedSignals.push(signal);
    if (decision.reason === 'active-wu-protected') {
      state.breakdown.activeWuProtected++;
    }
  }
}

/**
 * Update breakdown statistics for a removed signal.
 *
 * @param reason - Removal reason
 * @param breakdown - Breakdown to update
 */
function updateBreakdownForRemoval(reason: string, breakdown: CleanupBreakdown): void {
  if (reason === 'ttl-expired') {
    breakdown.ttlExpired++;
  } else if (reason === 'unread-ttl-expired') {
    breakdown.unreadTtlExpired++;
  }
}

/**
 * Apply count-based pruning to keep only maxEntries signals.
 *
 * @param state - Current cleanup state (mutated in place)
 * @param maxEntries - Maximum entries to retain
 */
function applyCountPruning(state: CleanupState, maxEntries: number): void {
  if (state.retainedSignals.length <= maxEntries) {
    return;
  }

  // Sort by created_at (oldest first)
  state.retainedSignals.sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return aTime - bTime;
  });

  const toRemove = state.retainedSignals.length - maxEntries;
  for (let i = 0; i < toRemove; i++) {
    // eslint-disable-next-line security/detect-object-injection -- Safe: i is a controlled loop index
    const signal = state.retainedSignals[i];
    if (!signal) continue;
    const idIndex = state.retainedIds.indexOf(signal.id);
    if (idIndex !== -1) {
      state.retainedIds.splice(idIndex, 1);
    }
    state.removedIds.push(signal.id);
    state.bytesFreed += estimateSignalBytes(signal);
    state.breakdown.countLimitExceeded++;
  }

  state.retainedSignals.splice(0, toRemove);
}

/**
 * Cleanup signals based on TTL and count limits.
 *
 * Removes signals according to policy:
 * 1. Active WU signals (in_progress/blocked) are always retained
 * 2. Read signals older than TTL (default 7d) are removed
 * 3. Unread signals older than unreadTtl (default 30d) are removed
 * 4. If over maxEntries, oldest signals are removed (keeping newest)
 *
 * In dry-run mode, no modifications are made but the result shows
 * what would be removed.
 *
 * @param baseDir - Project base directory
 * @param options - Cleanup options
 * @returns Cleanup result with removed/retained IDs and metrics
 *
 * @example
 * // Cleanup with dry-run to preview
 * const preview = await cleanupSignals(baseDir, { dryRun: true });
 * console.log(`Would remove ${preview.removedIds.length} signals`);
 *
 * @example
 * // Cleanup with custom TTL
 * const result = await cleanupSignals(baseDir, { ttl: '3d' });
 */
export async function cleanupSignals(
  baseDir: string,
  options: CleanupSignalsOptions = {},
): Promise<CleanupSignalsResult> {
  const { dryRun = false, now = Date.now(), getActiveWuIds = defaultGetActiveWuIds } = options;

  const config = buildCleanupConfig(options);
  const signals = await loadAllSignals(baseDir);
  const activeWuIds = await getActiveWuIds();

  // Load receipts and merge effective read state (WU-1472)
  const receipts = await loadAllReceipts(baseDir);
  const receiptSignalIds = new Set(receipts.map((r) => r.signal_id));
  for (const signal of signals) {
    if (!signal.read && receiptSignalIds.has(signal.id)) {
      signal.read = true;
    }
  }

  const state = processSignalsForTtl(signals, config, { now, activeWuIds });
  applyCountPruning(state, config.maxEntries);

  const compactionRatio = getCompactionRatio(state.removedIds.length, signals.length);
  const baseResult: CleanupSignalsResult = {
    success: true,
    removedIds: state.removedIds,
    retainedIds: state.retainedIds,
    bytesFreed: state.bytesFreed,
    compactionRatio,
    breakdown: state.breakdown,
  };

  if (dryRun) {
    return { ...baseResult, dryRun: true };
  }

  if (state.removedIds.length > 0) {
    await writeSignals(baseDir, state.retainedSignals);

    // Clean up orphaned receipts (WU-1472)
    const retainedIdSet = new Set(state.retainedIds);
    const retainedReceipts = receipts.filter((r) => retainedIdSet.has(r.signal_id));
    await writeReceipts(baseDir, retainedReceipts);
  }

  return baseResult;
}
