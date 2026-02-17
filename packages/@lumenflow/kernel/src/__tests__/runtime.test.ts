import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ExecutionContext, TaskSpec } from '../kernel.schemas.js';
import { EventStore } from '../event-store/index.js';
import { initializeKernelRuntime } from '../runtime/index.js';

const WORKSPACE_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};

function createTaskSpec(taskId: string): TaskSpec {
  return {
    id: taskId,
    workspace_id: 'workspace-kernel-runtime',
    lane_id: 'framework-core-lifecycle',
    domain: 'software-delivery',
    title: `Task ${taskId}`,
    description: `Task for ${taskId}`,
    acceptance: ['runtime behavior is verified'],
    declared_scopes: [WORKSPACE_SCOPE],
    risk: 'medium',
    type: 'feature',
    priority: 'P1',
    created: '2026-02-16',
  };
}

function createExecutionContext(taskId: string, runId: string): ExecutionContext {
  return {
    run_id: runId,
    task_id: taskId,
    session_id: 'session-runtime-tests',
    allowed_scopes: [WORKSPACE_SCOPE],
    metadata: {
      workspace_allowed_scopes: [WORKSPACE_SCOPE],
      lane_allowed_scopes: [WORKSPACE_SCOPE],
      task_declared_scopes: [WORKSPACE_SCOPE],
      workspace_config_hash: 'a'.repeat(64),
      runtime_version: '2.21.0',
    },
  };
}

async function writeWorkspaceFixture(root: string): Promise<void> {
  const packsRoot = join(root, 'packs');
  const packRoot = join(packsRoot, 'software-delivery');
  await mkdir(join(packRoot, 'tools'), { recursive: true });

  await writeFile(
    join(root, 'workspace.yaml'),
    [
      'id: workspace-kernel-runtime',
      'name: Kernel Runtime Workspace',
      'packs:',
      '  - id: software-delivery',
      '    version: 1.0.0',
      '    integrity: dev',
      '    source: local',
      'lanes:',
      '  - id: framework-core-lifecycle',
      '    title: Framework Core Lifecycle',
      '    allowed_scopes:',
      '      - type: path',
      '        pattern: "**"',
      '        access: read',
      'security:',
      '  allowed_scopes:',
      '    - type: path',
      '      pattern: "**"',
      '      access: read',
      '  network_default: off',
      '  deny_overlays: []',
      'memory_namespace: mem',
      'event_namespace: evt',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(packRoot, 'manifest.yaml'),
    [
      'id: software-delivery',
      'version: 1.0.0',
      'task_types:',
      '  - work-unit',
      'tools:',
      '  - name: pack:echo',
      '    entry: tools/echo.ts',
      'policies:',
      '  - id: runtime.completion.allow',
      '    trigger: on_completion',
      '    decision: allow',
      'state_aliases:',
      '  active: in_progress',
      'evidence_types: []',
      'lane_templates: []',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(packRoot, 'tools', 'echo.ts'),
    ['export const marker = true;', 'export default marker;'].join('\n'),
    'utf8',
  );
}

describe('kernel runtime facade', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-runtime-'));
    await writeWorkspaceFixture(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function createRuntime() {
    return initializeKernelRuntime({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, 'packs'),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
      toolCapabilityResolver: async ({ loadedPack, tool }) => ({
        name: tool.name,
        domain: loadedPack.manifest.id,
        version: loadedPack.manifest.version,
        input_schema: z.object({ message: z.string().min(1) }),
        output_schema: z.object({ echo: z.string().min(1) }),
        permission: 'read',
        required_scopes: [WORKSPACE_SCOPE],
        handler: {
          kind: 'in-process',
          fn: async (input) => ({
            success: true,
            data: {
              echo: (input as { message: string }).message,
            },
          }),
        },
        description: 'Echo tool from software delivery pack',
        pack: loadedPack.pin.id,
      }),
    });
  }

  it('loads workspace.yaml, resolves packs, and builds a runnable tool registry', async () => {
    const runtime = await createRuntime();

    const output = await runtime.executeTool(
      'pack:echo',
      { message: 'hello' },
      createExecutionContext('WU-1735-runtime-init', 'run-init-1'),
    );

    expect(output.success).toBe(true);
    expect(output.data).toMatchObject({ echo: 'hello' });
  });

  it('createTask writes immutable TaskSpec YAML and emits task_created', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1735-create');

    const created = await runtime.createTask(taskSpec);
    const yamlText = await readFile(created.task_spec_path, 'utf8');

    expect(yamlText).toContain('id: WU-1735-create');
    await expect(runtime.createTask(taskSpec)).rejects.toThrow('already exists');

    const inspection = await runtime.inspectTask(taskSpec.id);
    expect(inspection.state.status).toBe('ready');
    expect(inspection.events.some((event) => event.kind === 'task_created')).toBe(true);
  });

  it('claimTask and completeTask enforce transitions and emit lifecycle events', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1735-lifecycle');
    await runtime.createTask(taskSpec);

    const claimResult = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1735',
    });

    expect(claimResult.run.status).toBe('executing');

    await runtime.completeTask({
      task_id: taskSpec.id,
      evidence_refs: ['evidence://gate-report/1735'],
    });

    const inspection = await runtime.inspectTask(taskSpec.id);
    const eventKinds = inspection.events.map((event) => event.kind);

    expect(inspection.state.status).toBe('done');
    expect(inspection.run_history).toHaveLength(1);
    expect(inspection.run_history[0]?.status).toBe('succeeded');
    expect(eventKinds).toContain('task_claimed');
    expect(eventKinds).toContain('run_started');
    expect(eventKinds).toContain('run_succeeded');
    expect(eventKinds).toContain('task_completed');

    await expect(
      runtime.claimTask({
        task_id: taskSpec.id,
        by: 'tom@hellm.ai',
        session_id: 'session-1735-2',
      }),
    ).rejects.toThrow('Illegal state transition');
  });

  it('uses appendAll for atomic claim/complete event pairs', async () => {
    const appendSpy = vi.spyOn(EventStore.prototype, 'append');
    const appendAllSpy = vi.spyOn(EventStore.prototype, 'appendAll');

    try {
      const runtime = await createRuntime();
      const taskSpec = createTaskSpec('WU-1735-atomic-append');
      await runtime.createTask(taskSpec);

      appendSpy.mockClear();
      appendAllSpy.mockClear();

      await runtime.claimTask({
        task_id: taskSpec.id,
        by: 'tom@hellm.ai',
        session_id: 'session-1735-atomic',
      });
      await runtime.completeTask({
        task_id: taskSpec.id,
      });

      expect(appendAllSpy).toHaveBeenCalledTimes(2);
      expect(appendSpy).not.toHaveBeenCalled();
      expect(appendAllSpy.mock.calls[0]?.[0].map((event) => event.kind)).toEqual([
        'task_claimed',
        'run_started',
      ]);
      expect(appendAllSpy.mock.calls[1]?.[0].map((event) => event.kind)).toEqual([
        'run_succeeded',
        'task_completed',
      ]);
    } finally {
      appendSpy.mockRestore();
      appendAllSpy.mockRestore();
    }
  });

  it('completeTask runs on_completion policies and inspectTask includes policy decisions', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1735-policy-inspect');
    await runtime.createTask(taskSpec);

    const claimResult = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1735-policy',
    });

    await runtime.executeTool(
      'pack:echo',
      { message: 'policy-receipts' },
      createExecutionContext(taskSpec.id, claimResult.run.run_id),
    );

    const completion = await runtime.completeTask({
      task_id: taskSpec.id,
    });

    expect(completion.policy.decision).toBe('allow');

    const inspection = await runtime.inspectTask(taskSpec.id);
    expect(inspection.receipts.length).toBeGreaterThan(0);
    expect(
      inspection.policy_decisions.some(
        (decision) => decision.policy_id === 'runtime.completion.allow',
      ),
    ).toBe(true);
  });
});
