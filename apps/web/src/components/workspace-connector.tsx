'use client';

import { useState } from 'react';
import type { WorkspaceConnectionState } from '../lib/workspace-connection-types';

const PATH_INPUT_PLACEHOLDER = 'Enter workspace root path';
const CONNECT_BUTTON_LABEL = 'Connect';
const CONNECTING_BUTTON_LABEL = 'Connecting...';
const DISCONNECT_BUTTON_LABEL = 'Disconnect';
const PACKS_LABEL = 'packs';
const LANES_LABEL = 'lanes';
const DISCONNECTED_LABEL = 'Not connected';
const CONNECTED_LABEL = 'Connected';

const STATUS_DOT_COLORS: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-slate-300',
  error: 'bg-red-500',
};

const DEFAULT_DOT_COLOR = 'bg-slate-300';

/* ------------------------------------------------------------------
 * WorkspacePathPrompt
 * ------------------------------------------------------------------ */

interface WorkspacePathPromptProps {
  readonly onConnect: (path: string) => void;
  readonly isConnecting: boolean;
}

export function WorkspacePathPrompt({ onConnect, isConnecting }: WorkspacePathPromptProps) {
  const [inputValue, setInputValue] = useState('');

  function handleConnect() {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) {
      return;
    }
    onConnect(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      handleConnect();
    }
  }

  return (
    <div
      data-testid="workspace-path-prompt"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2 className="mb-4 text-lg font-semibold text-slate-800">Connect to Workspace</h2>
      <div className="flex gap-3">
        <input
          data-testid="workspace-path-input"
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PATH_INPUT_PLACEHOLDER}
          disabled={isConnecting}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          data-testid="workspace-connect-button"
          type="button"
          onClick={handleConnect}
          disabled={isConnecting}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isConnecting ? CONNECTING_BUTTON_LABEL : CONNECT_BUTTON_LABEL}
        </button>
      </div>
      {isConnecting && (
        <div data-testid="workspace-connecting-indicator" className="mt-3 text-sm text-slate-400">
          Initializing kernel runtime...
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 * WorkspaceConnectionStatus
 * ------------------------------------------------------------------ */

interface WorkspaceConnectionStatusProps {
  readonly state: WorkspaceConnectionState;
  readonly onDisconnect: () => void;
}

export function WorkspaceConnectionStatus({ state, onDisconnect }: WorkspaceConnectionStatusProps) {
  const dotColor = STATUS_DOT_COLORS[state.status] ?? DEFAULT_DOT_COLOR;

  return (
    <div
      data-testid="workspace-connection-status"
      className="rounded-lg border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status indicator dot */}
          <div
            data-testid="workspace-status-indicator"
            data-status={state.status}
            className={`h-2.5 w-2.5 rounded-full ${dotColor}`}
          />

          {state.status === 'connected' && state.workspaceInfo ? (
            <div className="flex items-center gap-4">
              <span data-testid="workspace-name" className="text-sm font-medium text-slate-800">
                {state.workspaceInfo.workspaceName}
              </span>
              <span
                data-testid="workspace-pack-count"
                className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
              >
                {state.workspaceInfo.packCount} {PACKS_LABEL}
              </span>
              <span
                data-testid="workspace-lane-count"
                className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
              >
                {state.workspaceInfo.laneCount} {LANES_LABEL}
              </span>
            </div>
          ) : (
            <span className="text-sm text-slate-400">
              {state.status === 'connected' ? CONNECTED_LABEL : DISCONNECTED_LABEL}
            </span>
          )}
        </div>

        {/* Right side: disconnect button or error */}
        <div className="flex items-center gap-3">
          {state.status === 'error' && state.error && (
            <span data-testid="workspace-error" className="text-xs text-red-600">
              {state.error}
            </span>
          )}
          {state.status === 'connected' && (
            <button
              data-testid="workspace-disconnect-button"
              type="button"
              onClick={onDisconnect}
              className="rounded-md px-3 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              {DISCONNECT_BUTTON_LABEL}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
