// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClaimTaskResult,
  CompleteTaskResult,
  CreateTaskResult,
  KernelRuntime,
  TaskSpec,
  TaskInspection,
  ToolOutput,
} from '@lumenflow/kernel';
import { createTaskLifecycleCommands, initializeTaskLifecycleCommands } from '../task-lifecycle.js';

function createTaskSpec(taskId: string): TaskSpec {
  return {
    id: taskId,
    workspace_id: 'workspace-surfaces-cli',
    lane_id: 'framework-cli-wu-commands',
    domain: 'software-delivery',
    title: `Task ${taskId}`,
    description: `Task for ${taskId}`,
    acceptance: ['CLI lifecycle flow works'],
    declared_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
    risk: 'medium',
    type: 'feature',
    priority: 'P1',
    created: '2026-02-16',
  };
}

async function writeWorkspaceFixture(root: string): Promise<void> {
  const packsRoot = join(root, 'packs');
  const packRoot = join(packsRoot, 'software-delivery');
  await mkdir(packRoot, { recursive: true });

  await writeFile(
    join(root, 'workspace.yaml'),
    [
      'id: workspace-surfaces-cli',
      'name: Surfaces CLI Workspace',
      'packs:',
      '  - id: software-delivery',
      '    version: 1.0.0',
      '    integrity: dev',
      '    source: local',
      'lanes:',
      '  - id: framework-cli-wu-commands',
      '    title: Framework CLI WU Commands',
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
      'software_delivery: {}',
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
      'tools: []',
      'policies:',
      '  - id: runtime.completion.allow',
      '    trigger: on_completion',
      '    decision: allow',
      'state_aliases:',
      '  active: in_progress',
      'evidence_types: []',
      'lane_templates: []',
      'config_key: software_delivery',
    ].join('\n'),
    'utf8',
  );
}

describe('surfaces/cli task lifecycle tracer bullet', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-surfaces-cli-'));
    await writeWorkspaceFixture(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('routes task commands to KernelRuntime methods', async () => {
    const createTask = vi.fn<(task: TaskSpec) => Promise<CreateTaskResult>>();
    const claimTask =
      vi.fn<
        (input: { task_id: string; by: string; session_id: string }) => Promise<ClaimTaskResult>
      >();
    const inspectTask = vi.fn<(taskId: string) => Promise<TaskInspection>>();
    const completeTask = vi.fn<(input: { task_id: string }) => Promise<CompleteTaskResult>>();
    const executeTool = vi.fn<(name: string, input: unknown, ctx: never) => Promise<ToolOutput>>();

    const runtime = {
      createTask,
      claimTask,
      inspectTask,
      completeTask,
      executeTool,
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const commands = createTaskLifecycleCommands(runtime);
    const taskSpec = createTaskSpec('WU-1736-routing');

    await commands['task:create'](taskSpec);
    await commands['task:claim']({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-routing',
    });
    await commands['task:status'](taskSpec.id);
    await commands['task:complete']({ task_id: taskSpec.id });

    expect(createTask).toHaveBeenCalledWith(taskSpec);
    expect(claimTask).toHaveBeenCalledWith({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-routing',
    });
    expect(inspectTask).toHaveBeenCalledWith(taskSpec.id);
    expect(completeTask).toHaveBeenCalledWith({ task_id: taskSpec.id });
  });

  it('executes create -> claim -> status -> complete -> status through KernelRuntime', async () => {
    const initialized = await initializeTaskLifecycleCommands({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, 'packs'),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
    });

    const commands = initialized.commands;
    const taskSpec = createTaskSpec('WU-1736-e2e');

    await commands['task:create'](taskSpec);
    await commands['task:claim']({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-e2e',
    });

    const activeStatus = await commands['task:status'](taskSpec.id);
    expect(activeStatus.state.status).toBe('active');

    await commands['task:complete']({ task_id: taskSpec.id });

    const doneStatus = await commands['task:status'](taskSpec.id);
    expect(doneStatus.state.status).toBe('done');

    const eventKinds = doneStatus.events.map((event) => event.kind);
    expect(eventKinds).toEqual([
      'task_created',
      'task_claimed',
      'run_started',
      'run_succeeded',
      'task_completed',
    ]);
  });

  it('surface implementation avoids direct @lumenflow/core imports', async () => {
    const sourcePath = join(
      process.cwd(),
      'packages',
      '@lumenflow',
      'surfaces',
      'cli',
      'task-lifecycle.ts',
    );
    const source = await readFile(sourcePath, 'utf8');

    expect(source.includes('@lumenflow/core')).toBe(false);
    expect(source.includes('runtime.createTask')).toBe(true);
    expect(source.includes('runtime.claimTask')).toBe(true);
    expect(source.includes('runtime.inspectTask')).toBe(true);
    expect(source.includes('runtime.completeTask')).toBe(true);
  });
});
