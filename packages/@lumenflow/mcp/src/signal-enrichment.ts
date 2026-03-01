// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2148: throttle signal checks to once every 5 seconds per process.
 */
export const SIGNAL_ENRICHMENT_THROTTLE_MS = 5_000;
const MEMORY_MODULE_ID = '@lumenflow/memory';

let lastSignalCheckAtMs = 0;
let memoryModulePromise: Promise<MemorySignalModule> | null = null;

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

interface MemorySignalModule {
  loadSignals: (
    projectRoot: string,
    options: { unreadOnly: boolean },
  ) => Promise<MemorySignal[]>;
  markSignalsAsRead: (
    projectRoot: string,
    signalIds: string[],
  ) => Promise<{ markedCount: number }>;
}

async function loadMemorySignalModule(): Promise<MemorySignalModule> {
  const module = (await import(MEMORY_MODULE_ID)) as Record<string, unknown>;
  const loadSignalsExport = module.loadSignals;
  const markSignalsAsReadExport = module.markSignalsAsRead;

  if (typeof loadSignalsExport !== 'function' || typeof markSignalsAsReadExport !== 'function') {
    throw new Error('Memory signal APIs unavailable');
  }

  return {
    loadSignals: loadSignalsExport as MemorySignalModule['loadSignals'],
    markSignalsAsRead: markSignalsAsReadExport as MemorySignalModule['markSignalsAsRead'],
  };
}

async function getMemorySignalModule(): Promise<MemorySignalModule> {
  if (!memoryModulePromise) {
    memoryModulePromise = loadMemorySignalModule();
  }
  return memoryModulePromise;
}

async function defaultLoadUnreadSignals(projectRoot: string): Promise<MemorySignal[]> {
  const module = await getMemorySignalModule();
  return module.loadSignals(projectRoot, { unreadOnly: true });
}

async function defaultMarkRead(
  projectRoot: string,
  signalIds: string[],
): Promise<{ markedCount: number }> {
  const module = await getMemorySignalModule();
  return module.markSignalsAsRead(projectRoot, signalIds);
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
  memoryModulePromise = null;
}
