// @vitest-environment jsdom
/**
 * Tests for workspace connector UI components (WU-1822).
 *
 * AC1: Workspace root path prompt on first load
 * AC2: KernelRuntime initializes from selected workspace
 * AC3: Connection status shown (workspace name, pack count)
 * AC4: Preference persisted in localStorage
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type {
  WorkspaceConnectionState,
  WorkspaceInfo,
} from '../src/lib/workspace-connection-types';

/* ------------------------------------------------------------------
 * AC1: Workspace root path prompt on first load
 * ------------------------------------------------------------------ */

describe('WorkspacePathPrompt (AC1)', () => {
  it('renders a path input and connect button', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={false} />);

    expect(screen.getByTestId('workspace-path-input')).toBeDefined();
    expect(screen.getByTestId('workspace-connect-button')).toBeDefined();
  });

  it('calls onConnect with the entered path when connect is clicked', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={false} />);

    const input = screen.getByTestId('workspace-path-input') as HTMLInputElement;
    const button = screen.getByTestId('workspace-connect-button');

    fireEvent.change(input, { target: { value: 'workspaces/project' } });
    fireEvent.click(button);

    expect(onConnect).toHaveBeenCalledWith('workspaces/project');
  });

  it('disables the button when isConnecting is true', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={true} />);

    const button = screen.getByTestId('workspace-connect-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('does not call onConnect when input is empty', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={false} />);

    const button = screen.getByTestId('workspace-connect-button');
    fireEvent.click(button);

    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows connecting indicator when isConnecting is true', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={true} />);

    expect(screen.getByTestId('workspace-connecting-indicator')).toBeDefined();
  });

  it('creates a workspace from wizard and auto-connects when created', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          created: true,
          existing: false,
          workspaceRoot: 'workspaces/new-project',
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={false} />);

    fireEvent.change(screen.getByTestId('workspace-path-input'), {
      target: { value: 'workspaces/new-project' },
    });
    fireEvent.click(screen.getByTestId('workspace-create-toggle'));
    fireEvent.change(screen.getByTestId('workspace-project-name-input'), {
      target: { value: 'New Project' },
    });
    fireEvent.click(screen.getByTestId('workspace-create-button'));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith('workspaces/new-project');
    });

    fetchMock.mockRestore();
  });

  it('shows existing-workspace detection message without overwriting', async () => {
    const { WorkspacePathPrompt } = await import('../src/components/workspace-connector');

    const onConnect = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          created: false,
          existing: true,
          workspaceRoot: 'workspaces/existing-project',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(<WorkspacePathPrompt onConnect={onConnect} isConnecting={false} />);

    fireEvent.change(screen.getByTestId('workspace-path-input'), {
      target: { value: 'workspaces/existing-project' },
    });
    fireEvent.click(screen.getByTestId('workspace-create-toggle'));
    fireEvent.change(screen.getByTestId('workspace-project-name-input'), {
      target: { value: 'Existing Project' },
    });
    fireEvent.click(screen.getByTestId('workspace-create-button'));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-create-info').textContent).toContain(
        'already exists',
      );
    });
    expect(onConnect).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });
});

/* ------------------------------------------------------------------
 * AC3: Connection status shown (workspace name, pack count)
 * ------------------------------------------------------------------ */

describe('WorkspaceConnectionStatus (AC3)', () => {
  const connectedInfo: WorkspaceInfo = {
    workspaceName: 'my-project',
    workspaceId: 'ws-123',
    packCount: 3,
    laneCount: 5,
    workspaceRoot: 'workspaces/project',
  };

  it('shows workspace name when connected', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'connected',
      workspaceInfo: connectedInfo,
      error: null,
    };

    render(<WorkspaceConnectionStatus state={state} onDisconnect={vi.fn()} />);

    expect(screen.getByTestId('workspace-name')).toBeDefined();
    expect(screen.getByTestId('workspace-name').textContent).toContain('my-project');
  });

  it('shows pack count when connected', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'connected',
      workspaceInfo: connectedInfo,
      error: null,
    };

    render(<WorkspaceConnectionStatus state={state} onDisconnect={vi.fn()} />);

    expect(screen.getByTestId('workspace-pack-count')).toBeDefined();
    expect(screen.getByTestId('workspace-pack-count').textContent).toContain('3');
  });

  it('shows lane count when connected', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'connected',
      workspaceInfo: connectedInfo,
      error: null,
    };

    render(<WorkspaceConnectionStatus state={state} onDisconnect={vi.fn()} />);

    expect(screen.getByTestId('workspace-lane-count')).toBeDefined();
    expect(screen.getByTestId('workspace-lane-count').textContent).toContain('5');
  });

  it('shows connection status indicator', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'connected',
      workspaceInfo: connectedInfo,
      error: null,
    };

    render(<WorkspaceConnectionStatus state={state} onDisconnect={vi.fn()} />);

    const indicator = screen.getByTestId('workspace-status-indicator');
    expect(indicator).toBeDefined();
    expect(indicator.getAttribute('data-status')).toBe('connected');
  });

  it('shows disconnect button when connected', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'connected',
      workspaceInfo: connectedInfo,
      error: null,
    };

    const onDisconnect = vi.fn();
    render(<WorkspaceConnectionStatus state={state} onDisconnect={onDisconnect} />);

    const button = screen.getByTestId('workspace-disconnect-button');
    fireEvent.click(button);

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('shows error message in error state', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'error',
      workspaceInfo: null,
      error: 'Connection failed',
    };

    render(<WorkspaceConnectionStatus state={state} onDisconnect={vi.fn()} />);

    expect(screen.getByTestId('workspace-error')).toBeDefined();
    expect(screen.getByTestId('workspace-error').textContent).toContain('Connection failed');
  });

  it('shows disconnected state when not connected', async () => {
    const { WorkspaceConnectionStatus } = await import('../src/components/workspace-connector');

    const state: WorkspaceConnectionState = {
      status: 'disconnected',
      workspaceInfo: null,
      error: null,
    };

    render(<WorkspaceConnectionStatus state={state} onDisconnect={vi.fn()} />);

    const indicator = screen.getByTestId('workspace-status-indicator');
    expect(indicator.getAttribute('data-status')).toBe('disconnected');
  });
});
