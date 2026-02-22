'use client';

import { useState, useMemo } from 'react';

/* ------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------ */

export interface RecentWorkspace {
  readonly path: string;
  readonly name: string;
  readonly lastUsed: string;
}

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'lumenflow:recent-workspaces';
const MAX_RECENT_WORKSPACES = 5;

const ADD_WORKSPACE_LABEL = 'Add workspace';
const CONNECT_BUTTON_LABEL = 'Connect';
const CONNECTING_BUTTON_LABEL = 'Connecting...';
const PATH_INPUT_PLACEHOLDER = 'Enter workspace root path';
const SELECTOR_HEADING = 'Connect to Workspace';

/* ------------------------------------------------------------------
 * localStorage helpers
 * ------------------------------------------------------------------ */

function loadRecentWorkspaces(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentWorkspace[];
  } catch {
    return [];
  }
}

function saveRecentWorkspace(path: string): void {
  const existing = loadRecentWorkspaces();
  const now = new Date().toISOString();
  const name = path.split('/').pop() ?? path;

  // Remove existing entry for this path (if any) so we can re-add with fresh timestamp
  const filtered = existing.filter((w) => w.path !== path);

  const merged: RecentWorkspace[] = [{ path, name, lastUsed: now }, ...filtered];

  // Sort by lastUsed descending so eviction removes the oldest
  merged.sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());

  const updated = merged.slice(0, MAX_RECENT_WORKSPACES);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/* ------------------------------------------------------------------
 * WorkspaceSelector
 * ------------------------------------------------------------------ */

interface WorkspaceSelectorProps {
  readonly onConnect: (path: string) => void;
  readonly isConnecting: boolean;
}

export function WorkspaceSelector({ onConnect, isConnecting }: WorkspaceSelectorProps) {
  const recentWorkspaces = useMemo(() => {
    const workspaces = loadRecentWorkspaces();
    return workspaces
      .slice()
      .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
      .slice(0, MAX_RECENT_WORKSPACES);
  }, []);

  const hasRecent = recentWorkspaces.length > 0;

  // If no recent workspaces, show text input directly (AC5)
  const [showAddInput, setShowAddInput] = useState(!hasRecent);
  const [inputValue, setInputValue] = useState('');

  function handleSelectWorkspace(path: string) {
    saveRecentWorkspace(path);
    onConnect(path);
  }

  function handleAddWorkspace() {
    setShowAddInput(true);
  }

  function handleConnect() {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;
    saveRecentWorkspace(trimmed);
    onConnect(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      handleConnect();
    }
  }

  // Show text input mode (first-time user or after clicking "Add workspace")
  if (showAddInput) {
    return (
      <div
        data-testid="workspace-path-prompt"
        className="rounded-lg border border-slate-200 bg-white p-6"
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-800">{SELECTOR_HEADING}</h2>
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

  // Show dropdown of recent workspaces (AC1)
  return (
    <div
      data-testid="workspace-selector-dropdown"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2 className="mb-4 text-lg font-semibold text-slate-800">{SELECTOR_HEADING}</h2>
      <div className="flex flex-col gap-2">
        {recentWorkspaces.map((workspace) => (
          <button
            key={workspace.path}
            data-testid="workspace-option"
            type="button"
            onClick={() => handleSelectWorkspace(workspace.path)}
            disabled={isConnecting}
            className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <div>
              <span className="font-medium text-slate-800">{workspace.name}</span>
              <span className="ml-2 text-xs text-slate-400">{workspace.path}</span>
            </div>
          </button>
        ))}
        <button
          data-testid="workspace-add-option"
          type="button"
          onClick={handleAddWorkspace}
          disabled={isConnecting}
          className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 disabled:opacity-50"
        >
          + {ADD_WORKSPACE_LABEL}
        </button>
      </div>
    </div>
  );
}
