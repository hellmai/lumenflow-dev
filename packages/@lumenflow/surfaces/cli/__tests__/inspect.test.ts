// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonical_json } from '@lumenflow/kernel';
import { initializeTaskLifecycleCommands } from '../task-lifecycle.js';
import { createInspectCommands, createReplayCommands } from '../inspect.js';

const READ_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};

async function writeWorkspaceFixture(root: string): Promise<void> {
  const packsRoot = join(root, 'packs');
  const packRoot = join(packsRoot, 'software-delivery');
  await mkdir(join(packRoot, 'tools'), { recursive: true });

  await writeFile(
    join(root, 'workspace.yaml'),
    [
      'id: workspace-surfaces-cli-orchestration',
      'name: Surfaces CLI Orchestration Workspace',
      'packs:',
      '  - id: software-delivery',
      '    version: 1.0.0',
      '    integrity: dev',
      '    source: local',
      'lanes:',
      '  - id: framework-cli-orchestration',
      '    title: Framework CLI Orchestration',
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

  await writeFile(
    join(packRoot, 'tools', 'echo.ts'),
    ['export const marker = true;', 'export default marker;'].join('\n'),
    'utf8',
  );
}

async function readWorkspaceConfigHash(root: string): Promise<string> {
  const workspaceYaml = await readFile(join(root, 'workspace.yaml'), 'utf8');
  return canonical_json(workspaceYaml);
}

describe('surfaces/cli inspect + replay commands', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-surfaces-cli-inspect-'));
    await writeWorkspaceFixture(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('inspect shows state/run history/receipts/policy decisions/evidence and replay re-executes CAS input', async () => {
    const initialized = await initializeTaskLifecycleCommands({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, 'packs'),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
    });

    const taskSpec = {
      id: 'WU-1737-inspect-replay',
      workspace_id: 'workspace-surfaces-cli-orchestration',
      lane_id: 'framework-cli-orchestration',
      domain: 'software-delivery',
      title: 'Inspect replay tracer',
      description: 'Exercise inspect and replay commands',
      acceptance: ['inspect and replay work'],
      declared_scopes: [READ_SCOPE],
      risk: 'medium' as const,
      type: 'feature',
      priority: 'P1' as const,
      created: '2026-02-16',
    };

    await initialized.commands['task:create'](taskSpec);
    const claimResult = await initialized.commands['task:claim']({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1737-inspect',
    });

    const replayInputPath = join(tempRoot, 'replay-input.txt');
    await writeFile(replayInputPath, 'inspect + replay', 'utf8');
    const workspaceConfigHash = await readWorkspaceConfigHash(tempRoot);

    await initialized.runtime.executeTool(
      'fs:read',
      {
        path: replayInputPath,
        encoding: 'utf8',
      },
      {
        run_id: claimResult.run.run_id,
        task_id: taskSpec.id,
        session_id: 'session-1737-inspect',
        allowed_scopes: [READ_SCOPE],
        metadata: {
          workspace_allowed_scopes: [READ_SCOPE],
          lane_allowed_scopes: [READ_SCOPE],
          task_declared_scopes: [READ_SCOPE],
          workspace_config_hash: workspaceConfigHash,
          runtime_version: '2.21.0',
        },
      },
    );

    await initialized.commands['task:complete']({
      task_id: taskSpec.id,
      evidence_refs: ['evidence://summary/wu-1737'],
    });

    const inspectCommands = createInspectCommands(initialized.runtime);
    const replayCommands = createReplayCommands(initialized.runtime);

    const inspection = await inspectCommands['task:inspect'](taskSpec.id);
    expect(inspection.state.status).toBe('done');
    expect(inspection.run_history.length).toBeGreaterThan(0);
    expect(inspection.receipts.length).toBeGreaterThan(0);
    expect(
      inspection.policy_decisions.some(
        (decision) => decision.policy_id === 'runtime.completion.allow',
      ),
    ).toBe(true);
    expect(inspection.evidence).toContain('evidence://summary/wu-1737');

    const replayResult = await replayCommands['task:replay']({
      task_id: taskSpec.id,
      run_id: claimResult.run.run_id,
      session_id: 'session-1737-replay',
    });

    expect(replayResult.outputs.length).toBeGreaterThan(0);
    expect(replayResult.outputs[0]?.tool_name).toBe('fs:read');
  });
});
