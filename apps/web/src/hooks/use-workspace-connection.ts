'use client';

import { useCallback, useState } from 'react';
import type { WorkspaceConnectionState, WorkspaceInfo } from '../lib/workspace-connection-types';
import {
  INITIAL_CONNECTION_STATE,
  buildConnectionState,
  clearPersistedWorkspacePath,
  persistWorkspacePath,
} from '../lib/workspace-connection';

const WORKSPACE_CONNECT_API_PATH = '/api/workspace/connect';
const FETCH_ERROR_PREFIX = 'Failed to connect to workspace';

interface ConnectApiResponse {
  readonly success: boolean;
  readonly workspace?: WorkspaceInfo;
  readonly error?: string;
}

export interface UseWorkspaceConnectionResult {
  readonly state: WorkspaceConnectionState;
  readonly connect: (workspacePath: string) => Promise<void>;
  readonly disconnect: () => void;
  readonly isConnecting: boolean;
}

async function fetchWorkspaceInfo(workspacePath: string): Promise<ConnectApiResponse> {
  const response = await fetch(WORKSPACE_CONNECT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceRoot: workspacePath }),
  });

  const body: ConnectApiResponse = await response.json();

  if (!response.ok || !body.success) {
    return {
      success: false,
      error: body.error ?? `${FETCH_ERROR_PREFIX}: ${response.statusText}`,
    };
  }

  return body;
}

/**
 * React hook for managing workspace connection state.
 *
 * Handles:
 * - Connecting to a workspace via the API
 * - Persisting workspace path in localStorage
 * - Disconnecting and clearing state
 */
export function useWorkspaceConnection(): UseWorkspaceConnectionResult {
  const [state, setState] = useState<WorkspaceConnectionState>(INITIAL_CONNECTION_STATE);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async (workspacePath: string) => {
    setIsConnecting(true);
    setState({
      status: 'connecting',
      workspaceInfo: null,
      error: null,
    });

    try {
      const result = await fetchWorkspaceInfo(workspacePath);

      if (result.success && result.workspace) {
        setState(buildConnectionState(result.workspace));
        persistWorkspacePath(workspacePath, localStorage);
      } else {
        setState(buildConnectionState(null, result.error ?? FETCH_ERROR_PREFIX));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : FETCH_ERROR_PREFIX;
      setState(buildConnectionState(null, message));
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setState(INITIAL_CONNECTION_STATE);
    clearPersistedWorkspacePath(localStorage);
  }, []);

  return {
    state,
    connect,
    disconnect,
    isConnecting,
  };
}
