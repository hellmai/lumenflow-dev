// @vitest-environment jsdom
/**
 * Tests for useWorkspaceConnection hook (WU-1822).
 *
 * AC1: Workspace root path prompt on first load
 * AC2: KernelRuntime initializes from selected workspace
 * AC3: Connection status shown (workspace name, pack count)
 * AC4: Preference persisted in localStorage
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { WorkspaceInfo } from '../src/lib/workspace-connection-types';
import { WORKSPACE_LOCAL_STORAGE_KEY } from '../src/lib/workspace-connection';

const MOCK_WORKSPACE_INFO: WorkspaceInfo = {
  workspaceName: 'test-project',
  workspaceId: 'ws-test-001',
  packCount: 2,
  laneCount: 4,
  workspaceRoot: 'workspaces/test-project',
};

/* ------------------------------------------------------------------
 * AC1: First load with no persisted path = disconnected
 * ------------------------------------------------------------------ */

describe('useWorkspaceConnection initial state (AC1)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts disconnected when no path is persisted', async () => {
    const { useWorkspaceConnection } = await import('../src/hooks/use-workspace-connection');

    const { result } = renderHook(() => useWorkspaceConnection());

    expect(result.current.state.status).toBe('disconnected');
    expect(result.current.state.workspaceInfo).toBeNull();
  });
});

/* ------------------------------------------------------------------
 * AC2: connect() triggers runtime initialization
 * ------------------------------------------------------------------ */

describe('useWorkspaceConnection connect flow (AC2)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('transitions to connecting then connected on successful connect', async () => {
    // Mock the fetch call
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          workspace: MOCK_WORKSPACE_INFO,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { useWorkspaceConnection } = await import('../src/hooks/use-workspace-connection');
    const { result } = renderHook(() => useWorkspaceConnection());

    await act(async () => {
      await result.current.connect('workspaces/test-project');
    });

    expect(result.current.state.status).toBe('connected');
    expect(result.current.state.workspaceInfo).toEqual(MOCK_WORKSPACE_INFO);

    fetchSpy.mockRestore();
  });

  it('transitions to error on failed connect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'Workspace not found',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { useWorkspaceConnection } = await import('../src/hooks/use-workspace-connection');
    const { result } = renderHook(() => useWorkspaceConnection());

    await act(async () => {
      await result.current.connect('invalid/path');
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Workspace not found');

    fetchSpy.mockRestore();
  });

  it('handles network errors gracefully', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'));

    const { useWorkspaceConnection } = await import('../src/hooks/use-workspace-connection');
    const { result } = renderHook(() => useWorkspaceConnection());

    await act(async () => {
      await result.current.connect('some/path');
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Network error');

    fetchSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------
 * AC4: Persistence
 * ------------------------------------------------------------------ */

describe('useWorkspaceConnection persistence (AC4)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists workspace path to localStorage on successful connect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          workspace: MOCK_WORKSPACE_INFO,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { useWorkspaceConnection } = await import('../src/hooks/use-workspace-connection');
    const { result } = renderHook(() => useWorkspaceConnection());

    await act(async () => {
      await result.current.connect('workspaces/test-project');
    });

    expect(localStorage.getItem(WORKSPACE_LOCAL_STORAGE_KEY)).toBe('workspaces/test-project');

    fetchSpy.mockRestore();
  });

  it('clears localStorage on disconnect', async () => {
    localStorage.setItem(WORKSPACE_LOCAL_STORAGE_KEY, 'workspaces/test-project');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          workspace: MOCK_WORKSPACE_INFO,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { useWorkspaceConnection } = await import('../src/hooks/use-workspace-connection');
    const { result } = renderHook(() => useWorkspaceConnection());

    // First connect
    await act(async () => {
      await result.current.connect('workspaces/test-project');
    });

    // Then disconnect
    act(() => {
      result.current.disconnect();
    });

    expect(result.current.state.status).toBe('disconnected');
    expect(localStorage.getItem(WORKSPACE_LOCAL_STORAGE_KEY)).toBeNull();

    fetchSpy.mockRestore();
  });
});
