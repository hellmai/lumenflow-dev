// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { loadSignals, markSignalsAsRead } from '@lumenflow/memory';

/**
 * WU-2148: throttle signal checks to once every 5 seconds per process.
 */
export const SIGNAL_ENRICHMENT_THROTTLE_MS = 5_000;

let lastSignalCheckAtMs = 0;

interface MemorySignal {
  id: string;
  message: string;
  created_at: string;
  read: boolean;
  wu_id?: string;
  lane?: string;
  type?: string;
  sender?: string;
  target_agent?: string;
  origin?: string;
  remote_id?: string;
}

interface SurfacedSignal {
  id: string;
  message: string;
  created_at: string;
  wu_id?: string;
  lane?: string;
  type?: string;
  sender?: string;
  target_agent?: string;
  origin?: string;
  remote_id?: string;
}

interface SignalEnvelope {
  count: number;
  items: SurfacedSignal[];
}

export interface SignalEnrichmentOptions {
  projectRoot: string;
  now?: () => number;
  throttleMs?: number;
  loadUnreadSignals?: (projectRoot: string) => Promise<MemorySignal[]>;
  markRead?: (projectRoot: string, signalIds: string[]) => Promise<{ markedCount: number }>;
  acknowledgeRemote?: (signals: SurfacedSignal[]) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toSurfacedSignal(signal: MemorySignal): SurfacedSignal {
  return {
    id: signal.id,
    message: signal.message,
    created_at: signal.created_at,
    ...(signal.wu_id && { wu_id: signal.wu_id }),
    ...(signal.lane && { lane: signal.lane }),
    ...(signal.type && { type: signal.type }),
    ...(signal.sender && { sender: signal.sender }),
    ...(signal.target_agent && { target_agent: signal.target_agent }),
    ...(signal.origin && { origin: signal.origin }),
    ...(signal.remote_id && { remote_id: signal.remote_id }),
  };
}

async function defaultLoadUnreadSignals(projectRoot: string): Promise<MemorySignal[]> {
  return loadSignals(projectRoot, { unreadOnly: true });
}

async function defaultMarkRead(
  projectRoot: string,
  signalIds: string[],
): Promise<{ markedCount: number }> {
  return markSignalsAsRead(projectRoot, signalIds);
}

/**
 * Add `_signals` payload to MCP tool results when unread signals exist.
 *
 * Fail-open by design: any enrichment failure returns the original result.
 */
export async function enrichToolResultWithSignals(
  result: unknown,
  options: SignalEnrichmentOptions,
): Promise<unknown> {
  if (!isRecord(result)) {
    return result;
  }

  const now = options.now ?? Date.now;
  const throttleMs = options.throttleMs ?? SIGNAL_ENRICHMENT_THROTTLE_MS;
  const nowMs = now();

  if (lastSignalCheckAtMs !== 0 && nowMs - lastSignalCheckAtMs < throttleMs) {
    return result;
  }
  lastSignalCheckAtMs = nowMs;

  const loadUnreadSignals = options.loadUnreadSignals ?? defaultLoadUnreadSignals;
  const markRead = options.markRead ?? defaultMarkRead;

  try {
    const unreadSignals = await loadUnreadSignals(options.projectRoot);
    if (unreadSignals.length === 0) {
      return result;
    }

    const surfacedSignals = unreadSignals.map(toSurfacedSignal);
    const signalIds = surfacedSignals.map((signal) => signal.id);

    try {
      await markRead(options.projectRoot, signalIds);
    } catch {
      // Local read receipts are best-effort.
    }

    if (options.acknowledgeRemote) {
      try {
        await options.acknowledgeRemote(surfacedSignals);
      } catch {
        // Remote acknowledgements are optional and fail-open.
      }
    }

    const envelope: SignalEnvelope = {
      count: surfacedSignals.length,
      items: surfacedSignals,
    };

    return {
      ...result,
      _signals: envelope,
    };
  } catch {
    return result;
  }
}

export function resetSignalEnrichmentStateForTests(): void {
  lastSignalCheckAtMs = 0;
}
