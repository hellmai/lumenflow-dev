import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TEMP_ROOT_PREFIX = 'lumenflow-pack-author-route-';
const LOCAL_ORIGIN = 'http://localhost:3000';
const JSON_CONTENT_TYPE = 'application/json';

const VALID_REQUEST = {
  pack_id: 'customer-ops',
  version: '1.0.0',
  task_types: ['task'],
  templates: [
    {
      template_id: 'file.read_text',
      tool_name: 'file:read-customer-notes',
      scope_pattern: 'notes/**/*.md',
      max_bytes: 8192,
    },
  ],
};

const createdRoots: string[] = [];

afterEach(async () => {
  vi.resetModules();
  delete process.env.LUMENFLOW_WEB_WORKSPACE_ROOT;

  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (!root) {
      continue;
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('POST /api/packs/author', () => {
  it('creates pack output inside allowed root and returns create summary', async () => {
    const allowedRoot = await mkdtemp(path.join(tmpdir(), TEMP_ROOT_PREFIX));
    createdRoots.push(allowedRoot);
    process.env.LUMENFLOW_WEB_WORKSPACE_ROOT = allowedRoot;

    const route = await import('../app/api/packs/author/route');

    const response = await route.POST(
      new Request('http://localhost/api/packs/author', {
        method: 'POST',
        headers: {
          Origin: LOCAL_ORIGIN,
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify({
          workspaceRoot: allowedRoot,
          outputDir: 'packs',
          request: VALID_REQUEST,
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.packId).toBe('customer-ops');
    expect(body.toolCount).toBe(1);
    expect(body.filesCreated.length).toBeGreaterThan(0);

    const manifestPath = path.join(allowedRoot, 'packs', 'customer-ops', 'manifest.yaml');
    const manifestText = await readFile(manifestPath, 'utf8');
    expect(manifestText).toContain('id: customer-ops');
    expect(manifestText).toContain('file:read-customer-notes');
  });

  it('rejects traversal when workspaceRoot escapes allowed root', async () => {
    const allowedRoot = await mkdtemp(path.join(tmpdir(), TEMP_ROOT_PREFIX));
    createdRoots.push(allowedRoot);
    process.env.LUMENFLOW_WEB_WORKSPACE_ROOT = allowedRoot;

    const route = await import('../app/api/packs/author/route');
    const escapedRoot = path.resolve(allowedRoot, '..');

    const response = await route.POST(
      new Request('http://localhost/api/packs/author', {
        method: 'POST',
        headers: {
          Origin: LOCAL_ORIGIN,
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify({
          workspaceRoot: escapedRoot,
          outputDir: 'packs',
          request: VALID_REQUEST,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ERR_PATH_TRAVERSAL');
  });

  it('rejects traversal payloads in outputDir', async () => {
    const allowedRoot = await mkdtemp(path.join(tmpdir(), TEMP_ROOT_PREFIX));
    createdRoots.push(allowedRoot);
    process.env.LUMENFLOW_WEB_WORKSPACE_ROOT = allowedRoot;

    const route = await import('../app/api/packs/author/route');

    const response = await route.POST(
      new Request('http://localhost/api/packs/author', {
        method: 'POST',
        headers: {
          Origin: LOCAL_ORIGIN,
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify({
          workspaceRoot: allowedRoot,
          outputDir: '../outside',
          request: VALID_REQUEST,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ERR_PATH_TRAVERSAL');
  });
});
