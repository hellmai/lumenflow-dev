'use client';

import { useState } from 'react';
import type { WorkspaceConnectionState } from '../lib/workspace-connection-types';

const PATH_INPUT_PLACEHOLDER = 'Enter workspace root path';
const CONNECT_BUTTON_LABEL = 'Connect';
const CONNECTING_BUTTON_LABEL = 'Connecting...';
const CREATE_WORKSPACE_TOGGLE_LABEL = 'Create workspace';
const CREATE_WORKSPACE_BUTTON_LABEL = 'Create';
const CREATING_WORKSPACE_BUTTON_LABEL = 'Creating...';
const PROJECT_NAME_PLACEHOLDER = 'Project name';
const CREATE_ROUTE_PATH = '/api/workspace/create';
const ERROR_CREATE_WORKSPACE_PREFIX = 'Failed to create workspace';
const EXISTING_WORKSPACE_MESSAGE = 'Workspace already exists. Connect to proceed without overwrite.';
const WORKSPACE_CREATED_MESSAGE = 'Workspace created. Connecting...';
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

interface CreateWorkspaceSuccessResponse {
  readonly success: true;
  readonly created: boolean;
  readonly existing: boolean;
  readonly workspaceRoot: string;
}

interface CreateWorkspaceErrorResponse {
  readonly success: false;
  readonly error?: string;
}

type CreateWorkspaceResponse = CreateWorkspaceSuccessResponse | CreateWorkspaceErrorResponse;

function getCreateWorkspaceError(responseBody: unknown): string {
  if (
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'error' in responseBody &&
    typeof (responseBody as CreateWorkspaceErrorResponse).error === 'string'
  ) {
    return (responseBody as CreateWorkspaceErrorResponse).error as string;
  }

  return ERROR_CREATE_WORKSPACE_PREFIX;
}

export function WorkspacePathPrompt({ onConnect, isConnecting }: WorkspacePathPromptProps) {
  const [inputValue, setInputValue] = useState('');
  const [isCreateWorkspaceVisible, setIsCreateWorkspaceVisible] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [createWorkspaceInfo, setCreateWorkspaceInfo] = useState<string | null>(null);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);

  function handleConnect() {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) {
      return;
    }
    onConnect(trimmed);
  }

  async function handleCreateWorkspace() {
    const workspaceRoot = inputValue.trim();
    const trimmedProjectName = projectName.trim();

    if (workspaceRoot.length === 0) {
      setCreateWorkspaceError('Workspace path is required');
      return;
    }

    if (trimmedProjectName.length === 0) {
      setCreateWorkspaceError('Project name is required');
      return;
    }

    setCreateWorkspaceError(null);
    setCreateWorkspaceInfo(null);
    setIsCreatingWorkspace(true);

    try {
      const response = await fetch(CREATE_ROUTE_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceRoot,
          projectName: trimmedProjectName,
        }),
      });

      const body = (await response.json()) as CreateWorkspaceResponse;

      if (!response.ok || !body.success) {
        setCreateWorkspaceError(getCreateWorkspaceError(body));
        return;
      }

      if (body.existing) {
        setCreateWorkspaceInfo(EXISTING_WORKSPACE_MESSAGE);
        return;
      }

      setCreateWorkspaceInfo(WORKSPACE_CREATED_MESSAGE);
      onConnect(body.workspaceRoot);
    } catch (error) {
      setCreateWorkspaceError(error instanceof Error ? error.message : ERROR_CREATE_WORKSPACE_PREFIX);
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      handleConnect();
    }
  }

  function toggleCreateWorkspace() {
    setCreateWorkspaceInfo(null);
    setCreateWorkspaceError(null);
    setIsCreateWorkspaceVisible((current) => !current);
  }

  const controlsDisabled = isConnecting || isCreatingWorkspace;

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
          disabled={controlsDisabled}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          data-testid="workspace-connect-button"
          type="button"
          onClick={handleConnect}
          disabled={controlsDisabled}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isConnecting ? CONNECTING_BUTTON_LABEL : CONNECT_BUTTON_LABEL}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          data-testid="workspace-create-toggle"
          type="button"
          onClick={toggleCreateWorkspace}
          disabled={controlsDisabled}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {CREATE_WORKSPACE_TOGGLE_LABEL}
        </button>
      </div>
      {isCreateWorkspaceVisible && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Project name
          </label>
          <input
            data-testid="workspace-project-name-input"
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder={PROJECT_NAME_PLACEHOLDER}
            disabled={controlsDisabled}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              data-testid="workspace-create-button"
              type="button"
              onClick={() => {
                void handleCreateWorkspace();
              }}
              disabled={controlsDisabled}
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {isCreatingWorkspace ? CREATING_WORKSPACE_BUTTON_LABEL : CREATE_WORKSPACE_BUTTON_LABEL}
            </button>
            {createWorkspaceInfo && (
              <span data-testid="workspace-create-info" className="text-xs text-slate-600">
                {createWorkspaceInfo}
              </span>
            )}
            {createWorkspaceError && (
              <span className="text-xs text-red-600">{createWorkspaceError}</span>
            )}
          </div>
        </div>
      )}
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
