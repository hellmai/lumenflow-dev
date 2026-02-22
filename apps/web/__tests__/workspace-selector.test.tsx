// @vitest-environment jsdom
/**
 * Tests for workspace selector with recent-workspaces history (WU-1873).
 *
 * AC1: Workspace selector dropdown shows up to 5 recent workspaces sorted by lastUsed
 * AC2: Selecting a workspace from dropdown triggers onConnect with that path
 * AC3: Add workspace option opens text input for new workspace path
 * AC4: Recent workspaces persisted in localStorage, capped at 5 entries
 * AC5: Backward compatible: first-time users see Add workspace flow
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const STORAGE_KEY = 'lumenflow:recent-workspaces';

interface RecentWorkspace {
  readonly path: string;
  readonly name: string;
  readonly lastUsed: string;
}

function makeWorkspace(overrides: Partial<RecentWorkspace> & { path: string }): RecentWorkspace {
  return {
    name: overrides.path.split('/').pop() ?? overrides.path,
    lastUsed: new Date().toISOString(),
    ...overrides,
  };
}

function seedLocalStorage(workspaces: RecentWorkspace[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
}

/* ------------------------------------------------------------------
 * AC5: Backward compatible — first-time users see Add workspace flow
 * ------------------------------------------------------------------ */

describe('WorkspaceSelector — first-time user (AC5)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the text input immediately when no recent workspaces exist', async () => {
    const { WorkspaceSelector } = await import('../src/components/workspace-selector');

    render(<WorkspaceSelector onConnect={vi.fn()} isConnecting={false} />);

    expect(screen.getByTestId('workspace-path-input')).toBeDefined();
    expect(screen.getByTestId('workspace-connect-button')).toBeDefined();
  });
});

/* ------------------------------------------------------------------
 * AC1: Dropdown shows up to 5 recent workspaces sorted by lastUsed
 * ------------------------------------------------------------------ */

describe('WorkspaceSelector — recent workspaces dropdown (AC1)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows a dropdown with recent workspaces when they exist in localStorage', async () => {
    const workspaces: RecentWorkspace[] = [
      makeWorkspace({
        path: '/home/user/project-a',
        name: 'project-a',
        lastUsed: '2026-02-18T01:00:00Z',
      }),
      makeWorkspace({
        path: '/home/user/project-b',
        name: 'project-b',
        lastUsed: '2026-02-18T02:00:00Z',
      }),
    ];
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    render(<WorkspaceSelector onConnect={vi.fn()} isConnecting={false} />);

    expect(screen.getByTestId('workspace-selector-dropdown')).toBeDefined();
  });

  it('shows workspaces sorted by lastUsed descending (most recent first)', async () => {
    const workspaces: RecentWorkspace[] = [
      makeWorkspace({
        path: '/home/user/oldest',
        name: 'oldest',
        lastUsed: '2026-02-18T01:00:00Z',
      }),
      makeWorkspace({
        path: '/home/user/newest',
        name: 'newest',
        lastUsed: '2026-02-18T03:00:00Z',
      }),
      makeWorkspace({
        path: '/home/user/middle',
        name: 'middle',
        lastUsed: '2026-02-18T02:00:00Z',
      }),
    ];
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    render(<WorkspaceSelector onConnect={vi.fn()} isConnecting={false} />);

    const options = screen.getAllByTestId('workspace-option');
    expect(options[0].textContent).toContain('newest');
    expect(options[1].textContent).toContain('middle');
    expect(options[2].textContent).toContain('oldest');
  });

  it('shows at most 5 recent workspaces even when more exist', async () => {
    const workspaces: RecentWorkspace[] = Array.from({ length: 7 }, (_, i) =>
      makeWorkspace({
        path: `/home/user/project-${i}`,
        name: `project-${i}`,
        lastUsed: new Date(2026, 1, 18, i).toISOString(),
      }),
    );
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    render(<WorkspaceSelector onConnect={vi.fn()} isConnecting={false} />);

    const options = screen.getAllByTestId('workspace-option');
    expect(options.length).toBe(5);
  });
});

/* ------------------------------------------------------------------
 * AC2: Selecting a workspace triggers onConnect with that path
 * ------------------------------------------------------------------ */

describe('WorkspaceSelector — select workspace (AC2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('calls onConnect with the selected workspace path', async () => {
    const workspaces: RecentWorkspace[] = [
      makeWorkspace({
        path: '/home/user/project-a',
        name: 'project-a',
        lastUsed: '2026-02-18T02:00:00Z',
      }),
      makeWorkspace({
        path: '/home/user/project-b',
        name: 'project-b',
        lastUsed: '2026-02-18T01:00:00Z',
      }),
    ];
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    const onConnect = vi.fn();
    render(<WorkspaceSelector onConnect={onConnect} isConnecting={false} />);

    const options = screen.getAllByTestId('workspace-option');
    fireEvent.click(options[0]);

    expect(onConnect).toHaveBeenCalledWith('/home/user/project-a');
  });
});

/* ------------------------------------------------------------------
 * AC3: Add workspace option opens text input for new workspace path
 * ------------------------------------------------------------------ */

describe('WorkspaceSelector — add workspace (AC3)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows an "Add workspace" option in the dropdown', async () => {
    const workspaces: RecentWorkspace[] = [
      makeWorkspace({
        path: '/home/user/project-a',
        name: 'project-a',
        lastUsed: '2026-02-18T01:00:00Z',
      }),
    ];
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    render(<WorkspaceSelector onConnect={vi.fn()} isConnecting={false} />);

    expect(screen.getByTestId('workspace-add-option')).toBeDefined();
  });

  it('switches to text input when "Add workspace" is clicked', async () => {
    const workspaces: RecentWorkspace[] = [
      makeWorkspace({
        path: '/home/user/project-a',
        name: 'project-a',
        lastUsed: '2026-02-18T01:00:00Z',
      }),
    ];
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    render(<WorkspaceSelector onConnect={vi.fn()} isConnecting={false} />);

    const addButton = screen.getByTestId('workspace-add-option');
    fireEvent.click(addButton);

    expect(screen.getByTestId('workspace-path-input')).toBeDefined();
    expect(screen.getByTestId('workspace-connect-button')).toBeDefined();
  });
});

/* ------------------------------------------------------------------
 * AC4: Recent workspaces persisted in localStorage, capped at 5
 * ------------------------------------------------------------------ */

describe('WorkspaceSelector — localStorage persistence (AC4)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves a new workspace to localStorage when onConnect is called via text input', async () => {
    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    const onConnect = vi.fn();
    render(<WorkspaceSelector onConnect={onConnect} isConnecting={false} />);

    // First-time user sees text input directly
    const input = screen.getByTestId('workspace-path-input') as HTMLInputElement;
    const button = screen.getByTestId('workspace-connect-button');

    fireEvent.change(input, { target: { value: '/home/user/new-project' } });
    fireEvent.click(button);

    expect(onConnect).toHaveBeenCalledWith('/home/user/new-project');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as RecentWorkspace[];
    expect(stored.length).toBe(1);
    expect(stored[0].path).toBe('/home/user/new-project');
  });

  it('updates lastUsed for an existing workspace when selected again', async () => {
    const workspaces: RecentWorkspace[] = [
      makeWorkspace({
        path: '/home/user/project-a',
        name: 'project-a',
        lastUsed: '2026-02-18T01:00:00Z',
      }),
      makeWorkspace({
        path: '/home/user/project-b',
        name: 'project-b',
        lastUsed: '2026-02-18T02:00:00Z',
      }),
    ];
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    const onConnect = vi.fn();
    render(<WorkspaceSelector onConnect={onConnect} isConnecting={false} />);

    // project-a is second (older), click it
    const options = screen.getAllByTestId('workspace-option');
    // project-b is first (newer), project-a is second
    fireEvent.click(options[1]);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as RecentWorkspace[];
    const projectA = stored.find((w) => w.path === '/home/user/project-a');
    expect(projectA).toBeDefined();
    // lastUsed should be updated to after the original time
    expect(new Date(projectA!.lastUsed).getTime()).toBeGreaterThan(
      new Date('2026-02-18T01:00:00Z').getTime(),
    );
  });

  it('caps stored workspaces at 5 entries, evicting the oldest', async () => {
    const workspaces: RecentWorkspace[] = Array.from({ length: 5 }, (_, i) =>
      makeWorkspace({
        path: `/home/user/project-${i}`,
        name: `project-${i}`,
        lastUsed: new Date(2026, 1, 18, i).toISOString(),
      }),
    );
    seedLocalStorage(workspaces);

    const { WorkspaceSelector } = await import('../src/components/workspace-selector');
    const onConnect = vi.fn();
    render(<WorkspaceSelector onConnect={onConnect} isConnecting={false} />);

    // Switch to add mode and add a 6th workspace
    const addButton = screen.getByTestId('workspace-add-option');
    fireEvent.click(addButton);

    const input = screen.getByTestId('workspace-path-input') as HTMLInputElement;
    const button = screen.getByTestId('workspace-connect-button');

    fireEvent.change(input, { target: { value: '/home/user/project-new' } });
    fireEvent.click(button);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as RecentWorkspace[];
    expect(stored.length).toBe(5);
    // The oldest (project-0, hour=0) should be evicted
    expect(stored.find((w) => w.path === '/home/user/project-0')).toBeUndefined();
    expect(stored.find((w) => w.path === '/home/user/project-new')).toBeDefined();
  });
});
