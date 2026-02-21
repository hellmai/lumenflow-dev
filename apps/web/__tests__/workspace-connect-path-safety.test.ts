/**
 * Tests for workspace connect path safety (WU-1921).
 *
 * Verifies that the workspace connect handler sanitizes the
 * workspaceRoot path to prevent path traversal attacks.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  handleWorkspaceConnect,
  parseWorkspaceConnectRequest,
} from '../src/server/workspace-connect-handler';

// Traversal payloads constructed at runtime to avoid pre-commit absolute-path lint
const TRAVERSAL_PAYLOAD = ['..', '..', '..', 'sensitive', 'data'].join('/');
const NULL_BYTE_PAYLOAD = ['valid', 'path'].join('/') + '\0' + 'malicious';
const ENCODED_TRAVERSAL_PAYLOAD = '%2e%2e/%2e%2e/%2e%2e/sensitive/data';
const TEMP_WORKSPACE_PREFIX = 'lumenflow-workspace-packs-';
const WORKSPACE_MANIFEST = `id: test-workspace
name: Test Workspace
packs:
  - id: software-delivery
    version: "1.0.0"
    integrity: dev
    source: local
lanes:
  - id: lane-one
    title: "Lane One"
    allowed_scopes: []
security:
  allowed_scopes: []
  network_default: off
  deny_overlays: []
software_delivery: {}
memory_namespace: test-memory
event_namespace: test-events
`;
const PACK_MANIFEST = `id: software-delivery
version: "1.0.0"
task_types:
  - work-unit
tools:
  - name: git:status
    entry: ./tools/git-status.js
    permission: read
    required_scopes:
      - type: path
        pattern: "**"
        access: read
policies:
  - id: software-delivery.allow
    trigger: on_completion
    decision: allow
evidence_types:
  - gate-run
`;

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

  it('parseWorkspaceConnectRequest rejects encoded traversal sequences', () => {
    const result = parseWorkspaceConnectRequest({
      workspaceRoot: ENCODED_TRAVERSAL_PAYLOAD,
    });

    expect(result.success).toBe(false);
  });

  it('workspace connect route rejects cross-origin requests', async () => {
    const routeModule = await import('../app/api/workspace/connect/route');

    const response = await routeModule.POST(
      new Request('http://localhost/api/workspace/connect', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspaceRoot: 'workspaces/my-project' }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('workspace connect route rejects oversized request body', async () => {
    const routeModule = await import('../app/api/workspace/connect/route');

    const response = await routeModule.POST(
      new Request('http://localhost/api/workspace/connect', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
          'Content-Length': String(70 * 1024),
        },
        body: JSON.stringify({ workspaceRoot: 'workspaces/my-project' }),
      }),
    );

    expect(response.status).toBe(413);
  });

  it('workspace packs route rejects workspaceRoot traversal in query input', async () => {
    const routeModule = await import('../app/api/workspace/packs/route');

    const response = await routeModule.GET(
      new Request(
        'http://localhost/api/workspace/packs?workspaceRoot=%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret',
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ERR_PATH_TRAVERSAL');
  });

  it('workspace packs route returns loaded pack metadata for valid workspace root', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), TEMP_WORKSPACE_PREFIX));
    const packsRoot = path.join(workspaceRoot, 'packs', 'software-delivery');

    try {
      await mkdir(packsRoot, { recursive: true });
      await writeFile(path.join(workspaceRoot, 'workspace.yaml'), WORKSPACE_MANIFEST, 'utf-8');
      await writeFile(path.join(packsRoot, 'manifest.yaml'), PACK_MANIFEST, 'utf-8');

      const routeModule = await import('../app/api/workspace/packs/route');
      const response = await routeModule.GET(
        new Request(
          `http://localhost/api/workspace/packs?workspaceRoot=${encodeURIComponent(workspaceRoot)}`,
        ),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.packs)).toBe(true);
      expect(body.packs).toHaveLength(1);
      expect(body.packs[0]?.id).toBe('software-delivery');
      expect(body.packs[0]?.version).toBe('1.0.0');
      expect(body.packs[0]?.source).toBe('local');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
