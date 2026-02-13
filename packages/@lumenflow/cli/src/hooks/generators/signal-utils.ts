/**
 * @file generators/signal-utils.ts
 * Signal surfacing and marking utilities for enforcement hooks (WU-1473).
 *
 * Extracted from enforcement-generator.ts by WU-1645.
 */

import { loadSignals, markSignalsAsRead } from '@lumenflow/memory/signal';

/**
 * WU-1473: Lightweight signal shape for display purposes.
 * Mirrors the Signal interface from @lumenflow/memory without direct type import.
 */
export interface DisplaySignal {
  id: string;
  message: string;
  created_at: string;
  read: boolean;
  wu_id?: string;
  lane?: string;
}

/**
 * WU-1473: Result of surfacing unread signals for agent consumption.
 */
export interface UnreadSignalSummary {
  /** Number of unread signals found */
  count: number;
  /** The unread signals (up to a reasonable display limit) */
  signals: DisplaySignal[];
}

/**
 * WU-1473: Surface unread signals for agent consumption during claim/start.
 *
 * Loads all unread signals from the memory layer and returns them for display.
 * Implements fail-open: any error returns an empty result without throwing.
 *
 * @param baseDir - Project base directory
 * @returns Unread signal summary (never throws)
 */
export async function surfaceUnreadSignals(baseDir: string): Promise<UnreadSignalSummary> {
  try {
    const signals = await loadSignals(baseDir, { unreadOnly: true });
    return { count: signals.length, signals };
  } catch {
    // WU-1473 AC4: Fail-open - memory errors never block lifecycle commands
    return { count: 0, signals: [] };
  }
}

/**
 * WU-1473: Mark all signals for a completed WU as read using receipt-aware behavior.
 *
 * Loads signals scoped to the given WU ID and marks any unread ones as read
 * by appending receipts (WU-1472 pattern). Does not rewrite signals.jsonl.
 * Implements fail-open: any error returns zero count without throwing.
 *
 * @param baseDir - Project base directory
 * @param wuId - WU ID whose signals should be marked as read
 * @returns Result with count of signals marked (never throws)
 */
export async function markCompletedWUSignalsAsRead(
  baseDir: string,
  wuId: string,
): Promise<{ markedCount: number }> {
  try {
    const signals = await loadSignals(baseDir, { wuId, unreadOnly: true });
    if (signals.length === 0) {
      return { markedCount: 0 };
    }
    const signalIds = signals.map((sig) => sig.id);
    return await markSignalsAsRead(baseDir, signalIds);
  } catch {
    // WU-1473 AC4: Fail-open - memory errors never block lifecycle commands
    return { markedCount: 0 };
  }
}
