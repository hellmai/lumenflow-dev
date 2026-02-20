import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TEMP_ROOT_PREFIX = 'lumenflow-workspace-create-';
const LOCAL_ORIGIN = 'http://localhost:3000';
const JSON_CONTENT_TYPE = 'application/json';
const WORKSPACE_FILE_NAME = 'workspace.yaml';

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

describe('POST /api/workspace/create', () => {
  it('creates workspace.yaml under allowed root', async () => {
    const allowedRoot = await mkdtemp(path.join(tmpdir(), TEMP_ROOT_PREFIX));
    createdRoots.push(allowedRoot);
    process.env.LUMENFLOW_WEB_WORKSPACE_ROOT = allowedRoot;

    const workspaceRoot = path.join(allowedRoot, 'workspace-a');
    const route = await import('../app/api/workspace/create/route');

    const response = await route.POST(
      new Request('http://localhost/api/workspace/create', {
        method: 'POST',
        headers: {
          Origin: LOCAL_ORIGIN,
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify({
          workspaceRoot,
          projectName: 'Workspace A',
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.created).toBe(true);

    const workspaceYaml = await readFile(path.join(workspaceRoot, WORKSPACE_FILE_NAME), 'utf-8');
    expect(workspaceYaml).toContain('name: Workspace A');
  });

  it('returns existing detection without overwriting existing workspace.yaml', async () => {
    const allowedRoot = await mkdtemp(path.join(tmpdir(), TEMP_ROOT_PREFIX));
    createdRoots.push(allowedRoot);
    process.env.LUMENFLOW_WEB_WORKSPACE_ROOT = allowedRoot;

    const workspaceRoot = path.join(allowedRoot, 'workspace-b');
    await mkdir(workspaceRoot, { recursive: true });
    const existingYaml = 'id: existing\nname: Existing Workspace\npacks: []\nlanes: []\n';
    await writeFile(path.join(workspaceRoot, WORKSPACE_FILE_NAME), existingYaml, 'utf-8');

    const route = await import('../app/api/workspace/create/route');

    const response = await route.POST(
      new Request('http://localhost/api/workspace/create', {
        method: 'POST',
        headers: {
          Origin: LOCAL_ORIGIN,
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify({
          workspaceRoot,
          projectName: 'Ignored Name',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.created).toBe(false);
    expect(body.existing).toBe(true);

    const workspaceYaml = await readFile(path.join(workspaceRoot, WORKSPACE_FILE_NAME), 'utf-8');
    expect(workspaceYaml).toBe(existingYaml);
  });

  it('rejects traversal when workspaceRoot escapes allowed root', async () => {
    const allowedRoot = await mkdtemp(path.join(tmpdir(), TEMP_ROOT_PREFIX));
    createdRoots.push(allowedRoot);
    process.env.LUMENFLOW_WEB_WORKSPACE_ROOT = allowedRoot;

    const route = await import('../app/api/workspace/create/route');
    const escapedRoot = path.resolve(allowedRoot, '..');

    const response = await route.POST(
      new Request('http://localhost/api/workspace/create', {
        method: 'POST',
        headers: {
          Origin: LOCAL_ORIGIN,
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify({
          workspaceRoot: escapedRoot,
          projectName: 'Unsafe Workspace',
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ERR_PATH_TRAVERSAL');
  });
});
