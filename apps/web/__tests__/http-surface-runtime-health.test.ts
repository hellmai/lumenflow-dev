import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENVIRONMENT_KEY = {
  ENABLE_RUNTIME: 'LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME',
  WORKSPACE_ROOT: 'LUMENFLOW_WEB_WORKSPACE_ROOT',
} as const;

beforeEach(() => {
  vi.resetModules();
  delete process.env.LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME;
  delete process.env.LUMENFLOW_WEB_WORKSPACE_ROOT;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME;
  delete process.env.LUMENFLOW_WEB_WORKSPACE_ROOT;
});

describe('http-surface runtime diagnostics', () => {
  it('preview runtime errors include actionable environment setup guidance', async () => {
    const runtimeModule = await import('../src/server/http-surface-runtime');
    const runtime = await runtimeModule.getKernelRuntimeForWeb();

    await expect(runtime.createTask({} as never)).rejects.toThrow(
      /LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME/,
    );
    await expect(runtime.createTask({} as never)).rejects.toThrow(/LUMENFLOW_WEB_WORKSPACE_ROOT/);
    await expect(runtime.createTask({} as never)).rejects.toThrow(/\.env\.local/);
  });

  it('GET /api/health reports preview mode runtime availability state', async () => {
    const workspaceRoot = path.join(process.cwd(), 'tmp-workspace-health');
    process.env[ENVIRONMENT_KEY.WORKSPACE_ROOT] = workspaceRoot;

    const routeModule = await import('../app/api/health/route');
    const response = await routeModule.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runtime.mode).toBe('preview');
    expect(body.runtime.available).toBe(false);
    expect(body.runtime.enabled).toBe(false);
    expect(body.runtime.workspaceRoot).toBe(workspaceRoot);
    expect(body.runtime.message).toContain('LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME');
  });
});
