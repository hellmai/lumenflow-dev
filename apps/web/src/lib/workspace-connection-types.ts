/**
 * Types for workspace connection flow (WU-1822).
 *
 * These types represent the client-side state for connecting to a
 * LumenFlow workspace and displaying connection status.
 */

/** Information about a connected workspace derived from the kernel runtime. */
export interface WorkspaceInfo {
  readonly workspaceName: string;
  readonly workspaceId: string;
  readonly packCount: number;
  readonly laneCount: number;
  readonly workspaceRoot: string;
}

/** Connection status discriminant. */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** The complete workspace connection state. */
export interface WorkspaceConnectionState {
  readonly status: ConnectionStatus;
  readonly workspaceInfo: WorkspaceInfo | null;
  readonly error: string | null;
}
