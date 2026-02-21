import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENVIRONMENT_KEY = {
  ENABLE_RUNTIME: 'LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME',
  RUNTIME_WORKSPACE_ROOT: 'LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT',
  WORKSPACE_ROOT: 'LUMENFLOW_WEB_WORKSPACE_ROOT',
} as const;

const WORKSPACE_FILE_NAME = 'workspace.yaml';
const UTF8_ENCODING = 'utf8';
const CONTROL_PLANE_TEST_ENDPOINT = 'https://control-plane.example.com';
const CONTROL_PLANE_TEST_TOKEN_ENV = 'LUMENFLOW_CONTROL_PLANE_TOKEN_TEST';
const ENABLED_FLAG = '1';
const CONTROL_PLANE_TEST_TOKEN_VALUE = 'token-test-value';
const RUNTIME_MODE = {
  PREVIEW: 'preview',
  RUNTIME: 'runtime',
} as const;
const CONTROL_PLANE_STATE = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;
const DEFAULT_LANE_ID = 'default';
const DEFAULT_LANE_TITLE = 'Default';
const DEFAULT_NAMESPACE = 'default';
const NETWORK_DEFAULT = 'off';
const WORKSPACE_TEST_ID = 'ws-health';
const WORKSPACE_TEST_NAME = 'Health Test Workspace';
const CONTROL_PLANE_TEST_ORG_ID = 'org-health';
const CONTROL_PLANE_TEST_PROJECT_ID = 'project-health';
const CONTROL_PLANE_TEST_SYNC_INTERVAL = 60;
const CONTROL_PLANE_TEST_POLICY_MODE = 'tighten-only';
const RUNTIME_ENABLE_GUIDANCE = `${ENVIRONMENT_KEY.ENABLE_RUNTIME}=${ENABLED_FLAG}`;
const TEST_WORKSPACE_PREFIX = 'lumenflow-web-health-';
const TEMP_WORKSPACE_SUFFIX = {
  BOUNDARY_ROOT: 'boundary-root',
  RUNTIME_ROOT: 'runtime-root',
  WORKSPACE_HEALTH: 'workspace-health',
  MISSING_RUNTIME_ROOT: 'missing-runtime-root',
  CONTROL_PLANE_PREVIEW: 'control-plane-preview',
  CONTROL_PLANE_RUNTIME: 'control-plane-runtime',
} as const;

const tempWorkspaceRoots: string[] = [];

async function createTempWorkspaceRoot(
  suffix: (typeof TEMP_WORKSPACE_SUFFIX)[keyof typeof TEMP_WORKSPACE_SUFFIX],
): Promise<string> {
  const tempRootPrefix = path.join(os.tmpdir(), `${TEST_WORKSPACE_PREFIX}${suffix}-`);
  const workspaceRoot = await mkdtemp(tempRootPrefix);
  tempWorkspaceRoots.push(workspaceRoot);
  return workspaceRoot;
}

async function writeWorkspaceYamlWithControlPlane(workspaceRoot: string): Promise<void> {
  const yamlContent = `
id: ${WORKSPACE_TEST_ID}
name: ${WORKSPACE_TEST_NAME}
packs: []
lanes:
  - id: ${DEFAULT_LANE_ID}
    title: ${DEFAULT_LANE_TITLE}
    allowed_scopes: []
policies: {}
security:
  allowed_scopes: []
  network_default: ${NETWORK_DEFAULT}
  deny_overlays: []
software_delivery: {}
memory_namespace: ${DEFAULT_NAMESPACE}
event_namespace: ${DEFAULT_NAMESPACE}
control_plane:
  endpoint: ${CONTROL_PLANE_TEST_ENDPOINT}
  org_id: ${CONTROL_PLANE_TEST_ORG_ID}
  project_id: ${CONTROL_PLANE_TEST_PROJECT_ID}
  sync_interval: ${CONTROL_PLANE_TEST_SYNC_INTERVAL}
  policy_mode: ${CONTROL_PLANE_TEST_POLICY_MODE}
  auth:
    token_env: ${CONTROL_PLANE_TEST_TOKEN_ENV}
`.trim();

  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(workspaceRoot, WORKSPACE_FILE_NAME), yamlContent, UTF8_ENCODING);
}

beforeEach(() => {
  vi.resetModules();
  delete process.env.LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME;
  delete process.env.LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT;
  delete process.env.LUMENFLOW_WEB_WORKSPACE_ROOT;
  delete process.env.LUMENFLOW_CONTROL_PLANE_TOKEN_TEST;
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME;
  delete process.env.LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT;
  delete process.env.LUMENFLOW_WEB_WORKSPACE_ROOT;
  delete process.env.LUMENFLOW_CONTROL_PLANE_TOKEN_TEST;

  while (tempWorkspaceRoots.length > 0) {
    const workspaceRoot = tempWorkspaceRoots.pop();
    if (workspaceRoot === undefined) {
      continue;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

describe('http-surface runtime diagnostics', () => {
  it('preview runtime errors include actionable environment setup guidance', async () => {
    const runtimeModule = await import('../src/server/http-surface-runtime');
    const runtime = await runtimeModule.getKernelRuntimeForWeb();

    await expect(runtime.createTask({} as never)).rejects.toThrow(
      /LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME/,
    );
    await expect(runtime.createTask({} as never)).rejects.toThrow(
      /LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT/,
    );
    await expect(runtime.createTask({} as never)).rejects.toThrow(/LUMENFLOW_WEB_WORKSPACE_ROOT/);
    await expect(runtime.createTask({} as never)).rejects.toThrow(/\.env\.local/);
  });

  it('runtime workspace root gives precedence to runtime-specific env var', async () => {
    const workspaceRoot = await createTempWorkspaceRoot(TEMP_WORKSPACE_SUFFIX.BOUNDARY_ROOT);
    const runtimeWorkspaceRoot = await createTempWorkspaceRoot(TEMP_WORKSPACE_SUFFIX.RUNTIME_ROOT);
    process.env[ENVIRONMENT_KEY.WORKSPACE_ROOT] = workspaceRoot;
    process.env[ENVIRONMENT_KEY.RUNTIME_WORKSPACE_ROOT] = runtimeWorkspaceRoot;

    const routeModule = await import('../app/api/health/route');
    const response = await routeModule.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runtime.workspaceRoot).toBe(runtimeWorkspaceRoot);
  });

  it('GET /api/health reports preview mode runtime availability state', async () => {
    const workspaceRoot = await createTempWorkspaceRoot(TEMP_WORKSPACE_SUFFIX.WORKSPACE_HEALTH);
    process.env[ENVIRONMENT_KEY.WORKSPACE_ROOT] = workspaceRoot;

    const routeModule = await import('../app/api/health/route');
    const response = await routeModule.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runtime.mode).toBe(RUNTIME_MODE.PREVIEW);
    expect(body.runtime.available).toBe(false);
    expect(body.runtime.enabled).toBe(false);
    expect(body.runtime.workspaceRoot).toBe(workspaceRoot);
    expect(body.runtime.message).toContain('LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME');
  });

  it('GET /api/health includes initialization error when runtime init fails', async () => {
    const runtimeRoot = await createTempWorkspaceRoot(TEMP_WORKSPACE_SUFFIX.MISSING_RUNTIME_ROOT);
    process.env[ENVIRONMENT_KEY.ENABLE_RUNTIME] = ENABLED_FLAG;
    process.env[ENVIRONMENT_KEY.RUNTIME_WORKSPACE_ROOT] = runtimeRoot;

    vi.doMock('@lumenflow/kernel', async () => {
      const actual = await vi.importActual<typeof import('@lumenflow/kernel')>('@lumenflow/kernel');
      return {
        ...actual,
        initializeKernelRuntime: vi.fn(async () => {
          throw new Error('workspace.yaml not found for runtime init test');
        }),
      };
    });

    const routeModule = await import('../app/api/health/route');
    const response = await routeModule.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runtime.mode).toBe(RUNTIME_MODE.PREVIEW);
    expect(body.runtime.enabled).toBe(true);
    expect(body.runtime.available).toBe(false);
    expect(body.runtime.workspaceRoot).toBe(runtimeRoot);
    expect(body.runtime.initializationError).toContain('workspace.yaml not found');
  });

  it('GET /api/health reports disconnected cloud diagnostics with endpoint/token guidance in preview mode', async () => {
    const workspaceRoot = await createTempWorkspaceRoot(
      TEMP_WORKSPACE_SUFFIX.CONTROL_PLANE_PREVIEW,
    );
    await writeWorkspaceYamlWithControlPlane(workspaceRoot);
    process.env[ENVIRONMENT_KEY.WORKSPACE_ROOT] = workspaceRoot;

    const routeModule = await import('../app/api/health/route');
    const response = await routeModule.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runtime.controlPlane.state).toBe(CONTROL_PLANE_STATE.DISCONNECTED);
    expect(body.runtime.controlPlane.endpoint).toBe(CONTROL_PLANE_TEST_ENDPOINT);
    expect(body.runtime.controlPlane.tokenEnv).toBe(CONTROL_PLANE_TEST_TOKEN_ENV);
    expect(body.runtime.controlPlane.guidance.join(' ')).toContain(RUNTIME_ENABLE_GUIDANCE);
    expect(body.runtime.controlPlane.guidance.join(' ')).toContain(CONTROL_PLANE_TEST_TOKEN_ENV);
  });

  it('GET /api/health reports connected cloud diagnostics when runtime and token are available', async () => {
    const runtimeRoot = await createTempWorkspaceRoot(TEMP_WORKSPACE_SUFFIX.CONTROL_PLANE_RUNTIME);
    await writeWorkspaceYamlWithControlPlane(runtimeRoot);
    process.env[ENVIRONMENT_KEY.ENABLE_RUNTIME] = ENABLED_FLAG;
    process.env[ENVIRONMENT_KEY.RUNTIME_WORKSPACE_ROOT] = runtimeRoot;
    process.env[CONTROL_PLANE_TEST_TOKEN_ENV] = CONTROL_PLANE_TEST_TOKEN_VALUE;

    vi.doMock('@lumenflow/kernel', async () => {
      const actual = await vi.importActual<typeof import('@lumenflow/kernel')>('@lumenflow/kernel');
      return {
        ...actual,
        initializeKernelRuntime: vi.fn(async () => ({}) as never),
      };
    });

    const routeModule = await import('../app/api/health/route');
    const response = await routeModule.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runtime.mode).toBe(RUNTIME_MODE.RUNTIME);
    expect(body.runtime.available).toBe(true);
    expect(body.runtime.controlPlane.state).toBe(CONTROL_PLANE_STATE.CONNECTED);
    expect(body.runtime.controlPlane.endpoint).toBe(CONTROL_PLANE_TEST_ENDPOINT);
    expect(body.runtime.controlPlane.tokenEnv).toBe(CONTROL_PLANE_TEST_TOKEN_ENV);
    expect(body.runtime.controlPlane.guidance).toEqual([]);
  });
});
