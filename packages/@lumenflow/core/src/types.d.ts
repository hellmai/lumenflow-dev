/**
 * Type declarations for optional peer dependencies and modules
 */

// @lumenflow/memory optional peer dependency
declare module '@lumenflow/memory/signal' {
  export function createSignal(
    baseDir: string,
    options: { message: string; wuId: string; lane: string },
  ): Promise<{ signal: { id: string } }>;

  export function loadSignals(
    baseDir: string,
    options: { unreadOnly?: boolean },
  ): Promise<Array<{ id: string; message: string }>>;

  export function markSignalsAsRead(baseDir: string, signalIds: string[]): Promise<void>;
}

declare module '@lumenflow/memory/store' {
  export function loadMemory(
    memoryDir: string,
    wuId: string,
  ): Promise<{ checkpoints: Array<{ timestamp: string }> } | null>;
}

declare module '@lumenflow/memory/checkpoint' {
  export function createCheckpoint(
    options: unknown,
  ): Promise<{ success: boolean; checkpointId: string }>;
}

// @lumenflow/initiatives optional peer dependency
declare module '@lumenflow/initiatives' {
  export function detectCycles(wuMap: Map<string, unknown>): {
    hasCycle: boolean;
    cycles: string[][];
  };
}

