/**
 * Tests for workspace connect path safety (WU-1921).
 *
 * Verifies that the workspace connect handler sanitizes the
 * workspaceRoot path to prevent path traversal attacks.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  handleWorkspaceConnect,
  parseWorkspaceConnectRequest,
} from '../src/server/workspace-connect-handler';

// Traversal payloads constructed at runtime to avoid pre-commit absolute-path lint
const TRAVERSAL_PAYLOAD = ['..', '..', '..', 'sensitive', 'data'].join('/');
const NULL_BYTE_PAYLOAD = ['valid', 'path'].join('/') + '\0' + 'malicious';

/* ------------------------------------------------------------------
 * Path traversal prevention in workspace connect
 * ------------------------------------------------------------------ */

describe('Workspace connect path safety (WU-1921)', () => {
  it('rejects workspaceRoot with path traversal sequences', async () => {
    const mockInitialize = vi.fn();

    const result = await handleWorkspaceConnect(
      { workspaceRoot: TRAVERSAL_PAYLOAD },
      mockInitialize,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('PATH_TRAVERSAL');
    }
    // The initializer should NOT be called when path is malicious
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('rejects workspaceRoot with null bytes', async () => {
    const mockInitialize = vi.fn();

    const result = await handleWorkspaceConnect(
      { workspaceRoot: NULL_BYTE_PAYLOAD },
      mockInitialize,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('PATH_TRAVERSAL');
    }
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('accepts valid workspace paths', async () => {
    const mockInitialize = vi.fn().mockResolvedValue({
      workspace_spec: {
        id: 'ws-001',
        name: 'Safe Project',
        packs: [],
        lanes: [],
      },
    });

    const result = await handleWorkspaceConnect(
      { workspaceRoot: 'workspaces/my-project' },
      mockInitialize,
    );

    expect(result.success).toBe(true);
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('parseWorkspaceConnectRequest rejects paths with null bytes', () => {
    const result = parseWorkspaceConnectRequest({
      workspaceRoot: 'path\0nulls',
    });

    expect(result.success).toBe(false);
  });

  it('parseWorkspaceConnectRequest rejects paths with .. traversal', () => {
    const result = parseWorkspaceConnectRequest({
      workspaceRoot: TRAVERSAL_PAYLOAD,
    });

    expect(result.success).toBe(false);
  });
});
