/**
 * Pure functions for workspace connection management (WU-1822).
 *
 * Handles localStorage persistence and connection state derivation.
 * All functions are side-effect-free when given a storage adapter.
 */

import type { WorkspaceConnectionState, WorkspaceInfo } from './workspace-connection-types';

/** localStorage key for persisting the workspace root path. */
export const WORKSPACE_LOCAL_STORAGE_KEY = 'lumenflow:workspace-root';

/** Initial connection state before any workspace is selected. */
export const INITIAL_CONNECTION_STATE: WorkspaceConnectionState = {
  status: 'disconnected',
  workspaceInfo: null,
  error: null,
} as const;

/** Minimal storage interface for dependency injection (testable without real localStorage). */
interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Persists workspace root path to storage.
 */
export function persistWorkspacePath(workspacePath: string, storage: StorageAdapter): void {
  storage.setItem(WORKSPACE_LOCAL_STORAGE_KEY, workspacePath);
}

/**
 * Loads persisted workspace root path from storage.
 * Returns null if no path is stored or the stored value is empty.
 */
export function loadPersistedWorkspacePath(storage: StorageAdapter): string | null {
  const stored = storage.getItem(WORKSPACE_LOCAL_STORAGE_KEY);
  if (stored === null || stored.length === 0) {
    return null;
  }
  return stored;
}

/**
 * Clears the persisted workspace root path from storage.
 */
export function clearPersistedWorkspacePath(storage: StorageAdapter): void {
  storage.removeItem(WORKSPACE_LOCAL_STORAGE_KEY);
}

/**
 * Builds a WorkspaceConnectionState from workspace info and optional error.
 *
 * - If error is provided, returns error state.
 * - If workspaceInfo is provided (and no error), returns connected state.
 * - Otherwise, returns disconnected state.
 */
export function buildConnectionState(
  workspaceInfo: WorkspaceInfo | null,
  error?: string | null,
): WorkspaceConnectionState {
  if (error) {
    return {
      status: 'error',
      workspaceInfo: null,
      error,
    };
  }

  if (workspaceInfo) {
    return {
      status: 'connected',
      workspaceInfo,
      error: null,
    };
  }

  return INITIAL_CONNECTION_STATE;
}
