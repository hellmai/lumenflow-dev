/**
 * Tests for workspace connection pure functions (WU-1822).
 *
 * AC1: Workspace root path prompt on first load
 * AC2: KernelRuntime initializes from selected workspace
 * AC3: Connection status shown (workspace name, pack count)
 * AC4: Preference persisted in localStorage
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type {
  WorkspaceConnectionState,
  WorkspaceInfo,
} from '../src/lib/workspace-connection-types';
import {
  INITIAL_CONNECTION_STATE,
  WORKSPACE_LOCAL_STORAGE_KEY,
  loadPersistedWorkspacePath,
  persistWorkspacePath,
  clearPersistedWorkspacePath,
  buildConnectionState,
} from '../src/lib/workspace-connection';

/* ------------------------------------------------------------------
 * AC4: Preference persisted in localStorage
 * ------------------------------------------------------------------ */

describe('localStorage persistence (AC4)', () => {
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    mockStorage = new Map();
  });

  function createMockStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    return {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mockStorage.set(key, value);
      },
      removeItem: (key: string) => {
        mockStorage.delete(key);
      },
    };
  }

  it('persists workspace path to localStorage', () => {
    const storage = createMockStorage();
    const testPath = 'workspaces/my-workspace';

    persistWorkspacePath(testPath, storage);

    expect(mockStorage.get(WORKSPACE_LOCAL_STORAGE_KEY)).toBe(testPath);
  });

  it('loads persisted workspace path from localStorage', () => {
    const storage = createMockStorage();
    const testPath = 'workspaces/my-workspace';
    mockStorage.set(WORKSPACE_LOCAL_STORAGE_KEY, testPath);

    const loaded = loadPersistedWorkspacePath(storage);

    expect(loaded).toBe(testPath);
  });

  it('returns null when no workspace path is persisted', () => {
    const storage = createMockStorage();

    const loaded = loadPersistedWorkspacePath(storage);

    expect(loaded).toBeNull();
  });

  it('clears persisted workspace path from localStorage', () => {
    const storage = createMockStorage();
    mockStorage.set(WORKSPACE_LOCAL_STORAGE_KEY, 'workspaces/other');

    clearPersistedWorkspacePath(storage);

    expect(mockStorage.has(WORKSPACE_LOCAL_STORAGE_KEY)).toBe(false);
  });

  it('handles empty string path as null', () => {
    const storage = createMockStorage();
    mockStorage.set(WORKSPACE_LOCAL_STORAGE_KEY, '');

    const loaded = loadPersistedWorkspacePath(storage);

    expect(loaded).toBeNull();
  });
});

/* ------------------------------------------------------------------
 * AC1 / AC3: Connection state building
 * ------------------------------------------------------------------ */

describe('buildConnectionState (AC1, AC3)', () => {
  it('returns disconnected state when no workspace info is provided', () => {
    const state = buildConnectionState(null);

    expect(state.status).toBe('disconnected');
    expect(state.workspaceInfo).toBeNull();
    expect(state.error).toBeNull();
  });

  it('returns connected state with workspace info', () => {
    const info: WorkspaceInfo = {
      workspaceName: 'my-project',
      workspaceId: 'ws-123',
      packCount: 3,
      laneCount: 5,
      workspaceRoot: 'workspaces/project',
    };

    const state = buildConnectionState(info);

    expect(state.status).toBe('connected');
    expect(state.workspaceInfo).toEqual(info);
    expect(state.error).toBeNull();
  });

  it('returns error state when error is provided', () => {
    const state = buildConnectionState(null, 'Failed to connect');

    expect(state.status).toBe('error');
    expect(state.workspaceInfo).toBeNull();
    expect(state.error).toBe('Failed to connect');
  });
});

/* ------------------------------------------------------------------
 * Initial state
 * ------------------------------------------------------------------ */

describe('INITIAL_CONNECTION_STATE', () => {
  it('starts as disconnected with no workspace info', () => {
    expect(INITIAL_CONNECTION_STATE.status).toBe('disconnected');
    expect(INITIAL_CONNECTION_STATE.workspaceInfo).toBeNull();
    expect(INITIAL_CONNECTION_STATE.error).toBeNull();
  });
});
