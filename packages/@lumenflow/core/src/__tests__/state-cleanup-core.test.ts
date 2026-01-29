/**
 * State Cleanup Core Tests (WU-1208)
 *
 * Tests for unified state cleanup orchestration that coordinates
 * signal, memory, and event cleanup in the correct dependency order.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { cleanupState, type CleanupError } from '../state-cleanup-core.js';

/**
 * Test project directory path
 */
const TEST_PROJECT_DIR = '/test/project';

/**
 * Signal cleanup result type
 */
interface SignalCleanupResult {
  success: boolean;
  dryRun?: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  breakdown: {
    ttlExpired: number;
    unreadTtlExpired: number;
    countLimitExceeded: number;
    activeWuProtected: number;
  };
}

/**
 * Memory cleanup result type
 */
interface MemoryCleanupResult {
  success: boolean;
  dryRun?: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  breakdown: {
    ephemeral: number;
    session: number;
    wu: number;
    sensitive: number;
    ttlExpired: number;
    activeSessionProtected: number;
  };
}

/**
 * Event archival result type
 */
interface EventArchivalResult {
  success: boolean;
  dryRun?: boolean;
  archivedWuIds: string[];
  retainedWuIds: string[];
  archivedEventCount: number;
  retainedEventCount: number;
  bytesArchived: number;
  breakdown: {
    archivedOlderThanThreshold: number;
    retainedActiveWu: number;
    retainedWithinThreshold: number;
  };
}

/**
 * Create a default signal cleanup result
 */
function createDefaultSignalResult(): SignalCleanupResult {
  return {
    success: true,
    removedIds: [],
    retainedIds: [],
    bytesFreed: 0,
    compactionRatio: 0,
    breakdown: {
      ttlExpired: 0,
      unreadTtlExpired: 0,
      countLimitExceeded: 0,
      activeWuProtected: 0,
    },
  };
}

/**
 * Create a mock signal cleanup result with overrides
 */
function createSignalResult(overrides: Partial<SignalCleanupResult> = {}): SignalCleanupResult {
  return { ...createDefaultSignalResult(), ...overrides };
}

/**
 * Create a default memory cleanup result
 */
function createDefaultMemoryResult(): MemoryCleanupResult {
  return {
    success: true,
    removedIds: [],
    retainedIds: [],
    bytesFreed: 0,
    compactionRatio: 0,
    breakdown: {
      ephemeral: 0,
      session: 0,
      wu: 0,
      sensitive: 0,
      ttlExpired: 0,
      activeSessionProtected: 0,
    },
  };
}

/**
 * Create a mock memory cleanup result with overrides
 */
function createMemoryResult(overrides: Partial<MemoryCleanupResult> = {}): MemoryCleanupResult {
  return { ...createDefaultMemoryResult(), ...overrides };
}

/**
 * Create a default event archival result
 */
function createDefaultEventResult(): EventArchivalResult {
  return {
    success: true,
    archivedWuIds: [],
    retainedWuIds: [],
    archivedEventCount: 0,
    retainedEventCount: 0,
    bytesArchived: 0,
    breakdown: {
      archivedOlderThanThreshold: 0,
      retainedActiveWu: 0,
      retainedWithinThreshold: 0,
    },
  };
}

/**
 * Create a mock event archival result with overrides
 */
function createEventResult(overrides: Partial<EventArchivalResult> = {}): EventArchivalResult {
  return { ...createDefaultEventResult(), ...overrides };
}

/**
 * Creates a mock signal cleanup function that tracks execution order
 */
function createOrderTrackingSignalsMock(executionOrder: string[]): Mock {
  return vi.fn().mockImplementation(async () => {
    executionOrder.push('signals');
    return createSignalResult();
  });
}

/**
 * Creates a mock memory cleanup function that tracks execution order
 */
function createOrderTrackingMemoryMock(executionOrder: string[]): Mock {
  return vi.fn().mockImplementation(async () => {
    executionOrder.push('memory');
    return createMemoryResult();
  });
}

/**
 * Creates a mock event archival function that tracks execution order
 */
function createOrderTrackingEventsMock(executionOrder: string[]): Mock {
  return vi.fn().mockImplementation(async () => {
    executionOrder.push('events');
    return createEventResult();
  });
}

/**
 * Extract error type from a cleanup error
 */
function extractErrorType(error: CleanupError): string {
  return error.type;
}

describe('state-cleanup-core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanupState', () => {
    describe('orchestration order', () => {
      it('should execute cleanup in correct dependency order: signals -> memory -> events', async () => {
        const executionOrder: string[] = [];

        const mockCleanupSignals = createOrderTrackingSignalsMock(executionOrder);
        const mockCleanupMemory = createOrderTrackingMemoryMock(executionOrder);
        const mockArchiveEvents = createOrderTrackingEventsMock(executionOrder);

        const result = await cleanupState(TEST_PROJECT_DIR, {
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(executionOrder).toEqual(['signals', 'memory', 'events']);
        expect(result.success).toBe(true);
      });
    });

    describe('--dry-run flag', () => {
      it('should pass dryRun option to all cleanup functions', async () => {
        const mockCleanupSignals = vi.fn().mockResolvedValue(createSignalResult({ dryRun: true }));

        const mockCleanupMemory = vi.fn().mockResolvedValue(createMemoryResult({ dryRun: true }));

        const mockArchiveEvents = vi.fn().mockResolvedValue(createEventResult({ dryRun: true }));

        const result = await cleanupState(TEST_PROJECT_DIR, {
          dryRun: true,
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(mockCleanupSignals).toHaveBeenCalledWith(
          TEST_PROJECT_DIR,
          expect.objectContaining({ dryRun: true }),
        );
        expect(mockCleanupMemory).toHaveBeenCalledWith(
          TEST_PROJECT_DIR,
          expect.objectContaining({ dryRun: true }),
        );
        expect(mockArchiveEvents).toHaveBeenCalledWith(
          TEST_PROJECT_DIR,
          expect.objectContaining({ dryRun: true }),
        );
        expect(result.dryRun).toBe(true);
      });
    });

    describe('--signals-only flag', () => {
      it('should only execute signal cleanup when signalsOnly is true', async () => {
        const mockCleanupSignals = vi.fn().mockResolvedValue(
          createSignalResult({
            removedIds: ['sig-1'],
            retainedIds: ['sig-2'],
            bytesFreed: 100,
            compactionRatio: 0.5,
            breakdown: {
              ttlExpired: 1,
              unreadTtlExpired: 0,
              countLimitExceeded: 0,
              activeWuProtected: 0,
            },
          }),
        );

        const mockCleanupMemory = vi.fn();
        const mockArchiveEvents = vi.fn();

        const result = await cleanupState(TEST_PROJECT_DIR, {
          signalsOnly: true,
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(mockCleanupSignals).toHaveBeenCalled();
        expect(mockCleanupMemory).not.toHaveBeenCalled();
        expect(mockArchiveEvents).not.toHaveBeenCalled();
        expect(result.signals).toBeDefined();
        expect(result.memory).toBeUndefined();
        expect(result.events).toBeUndefined();
      });
    });

    describe('--memory-only flag', () => {
      it('should only execute memory cleanup when memoryOnly is true', async () => {
        const mockCleanupSignals = vi.fn();

        const mockCleanupMemory = vi.fn().mockResolvedValue(
          createMemoryResult({
            removedIds: ['mem-1'],
            retainedIds: ['mem-2'],
            bytesFreed: 200,
            compactionRatio: 0.3,
            breakdown: {
              ephemeral: 1,
              session: 0,
              wu: 0,
              sensitive: 0,
              ttlExpired: 0,
              activeSessionProtected: 0,
            },
          }),
        );

        const mockArchiveEvents = vi.fn();

        const result = await cleanupState(TEST_PROJECT_DIR, {
          memoryOnly: true,
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(mockCleanupSignals).not.toHaveBeenCalled();
        expect(mockCleanupMemory).toHaveBeenCalled();
        expect(mockArchiveEvents).not.toHaveBeenCalled();
        expect(result.signals).toBeUndefined();
        expect(result.memory).toBeDefined();
        expect(result.events).toBeUndefined();
      });
    });

    describe('--events-only flag', () => {
      it('should only execute event archival when eventsOnly is true', async () => {
        const mockCleanupSignals = vi.fn();
        const mockCleanupMemory = vi.fn();

        const mockArchiveEvents = vi.fn().mockResolvedValue(
          createEventResult({
            archivedWuIds: ['WU-1'],
            retainedWuIds: ['WU-2'],
            archivedEventCount: 5,
            retainedEventCount: 10,
            bytesArchived: 500,
            breakdown: {
              archivedOlderThanThreshold: 1,
              retainedActiveWu: 1,
              retainedWithinThreshold: 0,
            },
          }),
        );

        const result = await cleanupState(TEST_PROJECT_DIR, {
          eventsOnly: true,
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(mockCleanupSignals).not.toHaveBeenCalled();
        expect(mockCleanupMemory).not.toHaveBeenCalled();
        expect(mockArchiveEvents).toHaveBeenCalled();
        expect(result.signals).toBeUndefined();
        expect(result.memory).toBeUndefined();
        expect(result.events).toBeDefined();
      });
    });

    describe('non-fatal error handling', () => {
      it('should continue with other cleanups when signal cleanup fails', async () => {
        const mockCleanupSignals = vi.fn().mockRejectedValue(new Error('Signal cleanup failed'));

        const mockCleanupMemory = vi.fn().mockResolvedValue(
          createMemoryResult({
            removedIds: ['mem-1'],
            bytesFreed: 100,
            compactionRatio: 1,
            breakdown: {
              ephemeral: 1,
              session: 0,
              wu: 0,
              sensitive: 0,
              ttlExpired: 0,
              activeSessionProtected: 0,
            },
          }),
        );

        const mockArchiveEvents = vi.fn().mockResolvedValue(createEventResult());

        const result = await cleanupState(TEST_PROJECT_DIR, {
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].type).toBe('signals');
        expect(result.errors[0].message).toBe('Signal cleanup failed');
        expect(result.memory).toBeDefined();
        expect(result.events).toBeDefined();
      });

      it('should continue with event archival when memory cleanup fails', async () => {
        const mockCleanupSignals = vi.fn().mockResolvedValue(createSignalResult());

        const mockCleanupMemory = vi.fn().mockRejectedValue(new Error('Memory cleanup failed'));

        const mockArchiveEvents = vi.fn().mockResolvedValue(
          createEventResult({
            archivedWuIds: ['WU-1'],
            archivedEventCount: 3,
            retainedEventCount: 5,
            bytesArchived: 300,
            breakdown: {
              archivedOlderThanThreshold: 1,
              retainedActiveWu: 0,
              retainedWithinThreshold: 0,
            },
          }),
        );

        const result = await cleanupState(TEST_PROJECT_DIR, {
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].type).toBe('memory');
        expect(result.signals).toBeDefined();
        expect(result.events).toBeDefined();
      });

      it('should accumulate all errors when multiple cleanups fail', async () => {
        const mockCleanupSignals = vi.fn().mockRejectedValue(new Error('Signal error'));
        const mockCleanupMemory = vi.fn().mockRejectedValue(new Error('Memory error'));
        const mockArchiveEvents = vi.fn().mockRejectedValue(new Error('Event error'));

        const result = await cleanupState(TEST_PROJECT_DIR, {
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(3);

        const errorTypes = result.errors.map(extractErrorType);
        expect(errorTypes).toEqual(['signals', 'memory', 'events']);
      });
    });

    describe('summary output', () => {
      it('should aggregate removed/retained counts for each type', async () => {
        const mockCleanupSignals = vi.fn().mockResolvedValue(
          createSignalResult({
            removedIds: ['sig-1', 'sig-2'],
            retainedIds: ['sig-3', 'sig-4', 'sig-5'],
            bytesFreed: 200,
            compactionRatio: 0.4,
            breakdown: {
              ttlExpired: 1,
              unreadTtlExpired: 1,
              countLimitExceeded: 0,
              activeWuProtected: 2,
            },
          }),
        );

        const mockCleanupMemory = vi.fn().mockResolvedValue(
          createMemoryResult({
            removedIds: ['mem-1'],
            retainedIds: ['mem-2', 'mem-3'],
            bytesFreed: 100,
            compactionRatio: 0.33,
            breakdown: {
              ephemeral: 1,
              session: 0,
              wu: 0,
              sensitive: 1,
              ttlExpired: 0,
              activeSessionProtected: 0,
            },
          }),
        );

        const mockArchiveEvents = vi.fn().mockResolvedValue(
          createEventResult({
            archivedWuIds: ['WU-1', 'WU-2', 'WU-3'],
            retainedWuIds: ['WU-4'],
            archivedEventCount: 15,
            retainedEventCount: 5,
            bytesArchived: 1500,
            breakdown: {
              archivedOlderThanThreshold: 3,
              retainedActiveWu: 1,
              retainedWithinThreshold: 0,
            },
          }),
        );

        const result = await cleanupState(TEST_PROJECT_DIR, {
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: mockCleanupMemory,
          archiveEvents: mockArchiveEvents,
        });

        expect(result.success).toBe(true);

        // Signals summary
        expect(result.signals?.removedCount).toBe(2);
        expect(result.signals?.retainedCount).toBe(3);
        expect(result.signals?.bytesFreed).toBe(200);

        // Memory summary
        expect(result.memory?.removedCount).toBe(1);
        expect(result.memory?.retainedCount).toBe(2);
        expect(result.memory?.bytesFreed).toBe(100);

        // Events summary
        expect(result.events?.archivedWuCount).toBe(3);
        expect(result.events?.retainedWuCount).toBe(1);
        expect(result.events?.archivedEventCount).toBe(15);
        expect(result.events?.bytesArchived).toBe(1500);

        // Total summary
        const expectedTotal = 200 + 100 + 1500;
        expect(result.summary.totalBytesFreed).toBe(expectedTotal);
      });

      it('should report correct summary when some cleanups are skipped', async () => {
        const mockCleanupSignals = vi.fn().mockResolvedValue(
          createSignalResult({
            removedIds: ['sig-1'],
            retainedIds: ['sig-2'],
            bytesFreed: 100,
            compactionRatio: 0.5,
            breakdown: {
              ttlExpired: 1,
              unreadTtlExpired: 0,
              countLimitExceeded: 0,
              activeWuProtected: 0,
            },
          }),
        );

        const result = await cleanupState(TEST_PROJECT_DIR, {
          signalsOnly: true,
          cleanupSignals: mockCleanupSignals,
          cleanupMemory: vi.fn(),
          archiveEvents: vi.fn(),
        });

        expect(result.summary.totalBytesFreed).toBe(100);
        expect(result.summary.typesExecuted).toEqual(['signals']);
        expect(result.summary.typesSkipped).toEqual(['memory', 'events']);
      });
    });
  });
});
