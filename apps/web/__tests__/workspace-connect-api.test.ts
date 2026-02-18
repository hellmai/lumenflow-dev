/**
 * Tests for workspace connect API handler (WU-1822).
 *
 * AC2: KernelRuntime initializes from selected workspace
 * AC3: Connection status shown (workspace name, pack count)
 *
 * Tests the pure handler function, not the Next.js route directly.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo } from '../src/lib/workspace-connection-types';
import {
  handleWorkspaceConnect,
  parseWorkspaceConnectRequest,
  buildWorkspaceInfoFromSpec,
} from '../src/server/workspace-connect-handler';

/* ------------------------------------------------------------------
 * Request parsing
 * ------------------------------------------------------------------ */

describe('parseWorkspaceConnectRequest', () => {
  it('extracts workspaceRoot from valid request body', () => {
    const result = parseWorkspaceConnectRequest({ workspaceRoot: 'workspaces/project' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workspaceRoot).toBe('workspaces/project');
    }
  });

  it('rejects missing workspaceRoot', () => {
    const result = parseWorkspaceConnectRequest({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('workspaceRoot');
    }
  });

  it('rejects non-string workspaceRoot', () => {
    const result = parseWorkspaceConnectRequest({ workspaceRoot: 42 });

    expect(result.success).toBe(false);
  });

  it('rejects empty string workspaceRoot', () => {
    const result = parseWorkspaceConnectRequest({ workspaceRoot: '' });

    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------
 * Workspace info extraction from spec
 * ------------------------------------------------------------------ */

describe('buildWorkspaceInfoFromSpec', () => {
  it('extracts workspace info from a workspace spec object', () => {
    const spec = {
      id: 'ws-001',
      name: 'My Project',
      packs: [{ id: 'pack-a' }, { id: 'pack-b' }],
      lanes: [{ id: 'lane-1' }, { id: 'lane-2' }, { id: 'lane-3' }],
    };

    const info = buildWorkspaceInfoFromSpec(spec, 'workspaces/project');

    expect(info).toEqual({
      workspaceName: 'My Project',
      workspaceId: 'ws-001',
      packCount: 2,
      laneCount: 3,
      workspaceRoot: 'workspaces/project',
    } satisfies WorkspaceInfo);
  });

  it('handles empty packs and lanes arrays', () => {
    const spec = {
      id: 'ws-empty',
      name: 'Empty',
      packs: [],
      lanes: [],
    };

    const info = buildWorkspaceInfoFromSpec(spec, 'workspaces/empty');

    expect(info.packCount).toBe(0);
    expect(info.laneCount).toBe(0);
  });
});

/* ------------------------------------------------------------------
 * Full handler
 * ------------------------------------------------------------------ */

describe('handleWorkspaceConnect', () => {
  it('returns workspace info on successful initialization', async () => {
    const mockInitialize = vi.fn().mockResolvedValue({
      workspace_spec: {
        id: 'ws-001',
        name: 'My Project',
        packs: [{ id: 'pack-a' }],
        lanes: [{ id: 'lane-1' }, { id: 'lane-2' }],
      },
    });

    const result = await handleWorkspaceConnect(
      { workspaceRoot: 'workspaces/project' },
      mockInitialize,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workspace.workspaceName).toBe('My Project');
      expect(result.workspace.packCount).toBe(1);
      expect(result.workspace.laneCount).toBe(2);
    }
  });

  it('returns error when initialization fails', async () => {
    const mockInitialize = vi.fn().mockRejectedValue(new Error('No workspace.yaml found'));

    const result = await handleWorkspaceConnect(
      { workspaceRoot: 'nonexistent/path' },
      mockInitialize,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No workspace.yaml found');
    }
  });

  it('returns error for invalid request body', async () => {
    const mockInitialize = vi.fn();

    const result = await handleWorkspaceConnect({}, mockInitialize);

    expect(result.success).toBe(false);
    expect(mockInitialize).not.toHaveBeenCalled();
  });
});
