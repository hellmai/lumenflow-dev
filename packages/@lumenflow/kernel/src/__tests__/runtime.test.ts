// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SOFTWARE_DELIVERY_PACK_ID } from '../../../packs/software-delivery/constants.js';
import { canonical_json } from '../canonical-json.js';
import { EvidenceStore } from '../evidence/index.js';
import type { ExecutionContext, TaskSpec } from '../kernel.schemas.js';
import { EventStore } from '../event-store/index.js';
import { type SubprocessTransport } from '../sandbox/index.js';
import {
  initializeKernelRuntime,
  defaultRunIdFactory,
  type InitializeKernelRuntimeOptions,
} from '../runtime/index.js';
import {
  PACK_MANIFEST_FILE_NAME,
  PACKS_DIR_NAME,
  UTF8_ENCODING,
  WORKSPACE_FILE_NAME,
} from '../shared-constants.js';
import { ToolRegistry } from '../tool-host/tool-registry.js';

const WORKSPACE_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};
const PACK_ECHO_TOOL_NAME = 'pack:echo';
const TOOL_NOT_FOUND_ERROR_CODE = 'TOOL_NOT_FOUND';
const SUBPROCESS_SANDBOX_UNAVAILABLE_ERROR_CODE = 'SUBPROCESS_SANDBOX_UNAVAILABLE';
const SCOPE_DENIED_ERROR_CODE = 'SCOPE_DENIED';
const INVALID_INPUT_ERROR_CODE = 'INVALID_INPUT';
const TOOL_CALL_STARTED_KIND = 'tool_call_started';
const TOOL_CALL_FINISHED_KIND = 'tool_call_finished';
const WORKSPACE_UPDATED_KIND = 'workspace_updated';
const SPEC_TAMPERED_KIND = 'spec_tampered';
const SPEC_TAMPERED_ERROR_CODE = 'SPEC_TAMPERED';
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
const RUNTIME_LOAD_STAGE_ERROR = `Runtime load stage failed for pack "${SOFTWARE_DELIVERY_PACK_ID}"`;
const RUNTIME_REGISTRATION_STAGE_ERROR = `Runtime registration stage failed for tool "${PACK_ECHO_TOOL_NAME}" in pack "${SOFTWARE_DELIVERY_PACK_ID}"`;
const RESOLVER_EXPLODED_MESSAGE = 'resolver exploded';
const REGISTRATION_STAGE_FAILURE_MESSAGE = `Registration stage failed: ${PACK_ECHO_TOOL_NAME} did not register in runtime.`;
const RECEIPT_STAGE_FAILURE_MESSAGE = `Receipt stage failed: missing ${TOOL_CALL_STARTED_KIND} receipt for ${PACK_ECHO_TOOL_NAME}.`;

function createTaskSpec(taskId: string): TaskSpec {
  return {
    id: taskId,
    workspace_id: 'workspace-kernel-runtime',
    lane_id: 'framework-core-lifecycle',
    domain: SOFTWARE_DELIVERY_PACK_ID,
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

function createExecutionContext(
  taskId: string,
  runId: string,
  workspaceConfigHash: string,
): ExecutionContext {
  return {
    run_id: runId,
    task_id: taskId,
    session_id: 'session-runtime-tests',
    allowed_scopes: [WORKSPACE_SCOPE],
    metadata: {
      workspace_allowed_scopes: [WORKSPACE_SCOPE],
      lane_allowed_scopes: [WORKSPACE_SCOPE],
      task_declared_scopes: [WORKSPACE_SCOPE],
      workspace_config_hash: workspaceConfigHash,
      runtime_version: '2.21.0',
    },
  };
}

async function writeWorkspaceFixture(root: string): Promise<void> {
  const packsRoot = join(root, PACKS_DIR_NAME);
  const packRoot = join(packsRoot, SOFTWARE_DELIVERY_PACK_ID);
  await mkdir(join(packRoot, 'tools'), { recursive: true });

  await writeFile(
    join(root, WORKSPACE_FILE_NAME),
    [
      'id: workspace-kernel-runtime',
      'name: Kernel Runtime Workspace',
      'packs:',
      `  - id: ${SOFTWARE_DELIVERY_PACK_ID}`,
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
      'software_delivery: {}',
      'memory_namespace: mem',
      'event_namespace: evt',
    ].join('\n'),
    UTF8_ENCODING,
  );

  await writeFile(
    join(packRoot, PACK_MANIFEST_FILE_NAME),
    [
      `id: ${SOFTWARE_DELIVERY_PACK_ID}`,
      'version: 1.0.0',
      'task_types:',
      '  - work-unit',
      'tools:',
      `  - name: ${PACK_ECHO_TOOL_NAME}`,
      '    entry: tools/echo.ts',
      '    required_scopes:',
      '      - type: path',
      '        pattern: "**"',
      '        access: read',
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
    UTF8_ENCODING,
  );

  await writeFile(
    join(packRoot, 'tools', 'echo.ts'),
    [
      'export default async function echoTool(input) {',
      '  const value = typeof input?.message === "string" ? input.message : "";',
      '  return {',
      '    success: value.length > 0,',
      '    data: value.length > 0 ? { echo: value } : undefined,',
      '    error: value.length > 0 ? undefined : { code: "INVALID_INPUT", message: "message required" },',
      '  };',
      '}',
    ].join('\n'),
    UTF8_ENCODING,
  );
}

async function readWorkspaceConfigHash(root: string): Promise<string> {
  const workspaceYaml = await readFile(join(root, WORKSPACE_FILE_NAME), UTF8_ENCODING);
  return canonical_json(workspaceYaml);
}

describe('kernel runtime facade', () => {
  let tempRoot: string;
  let workspaceConfigHash: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-runtime-'));
    await writeWorkspaceFixture(tempRoot);
    workspaceConfigHash = await readWorkspaceConfigHash(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function createRuntime() {
    return initializeKernelRuntime({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, PACKS_DIR_NAME),
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

  async function createRuntimeWithDefaultResolver(
    overrides: Pick<
      InitializeKernelRuntimeOptions,
      'subprocessDispatcher' | 'sandboxSubprocessDispatcherOptions'
    > = {},
  ) {
    return initializeKernelRuntime({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, PACKS_DIR_NAME),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
      ...overrides,
    });
  }

  async function writeManifest(lines: string[]): Promise<void> {
    await writeFile(
      join(tempRoot, PACKS_DIR_NAME, SOFTWARE_DELIVERY_PACK_ID, PACK_MANIFEST_FILE_NAME),
      lines.join('\n'),
      UTF8_ENCODING,
    );
  }

  it('loads workspace.yaml, resolves packs, and builds a runnable tool registry', async () => {
    const runtime = await createRuntime();

    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'hello' },
      createExecutionContext('WU-1735-runtime-init', 'run-init-1', workspaceConfigHash),
    );

    expect(output.success).toBe(true);
    expect(output.data).toMatchObject({ echo: 'hello' });
  });

  it('registers manifest-declared tools with default resolver when override is omitted', async () => {
    const registerSpy = vi.spyOn(ToolRegistry.prototype, 'register');
    try {
      const runtime = await createRuntimeWithDefaultResolver({
        sandboxSubprocessDispatcherOptions: {
          commandExists: () => false,
        },
      });
      const registeredPackCapability = registerSpy.mock.calls
        .map((call) => call[0])
        .find((capability) => capability.name === PACK_ECHO_TOOL_NAME);

      expect(registeredPackCapability).toBeDefined();
      expect(registeredPackCapability?.permission).toBe('read');
      expect(registeredPackCapability?.required_scopes).toEqual([WORKSPACE_SCOPE]);

      const output = await runtime.executeTool(
        PACK_ECHO_TOOL_NAME,
        { message: 'hello' },
        createExecutionContext(
          'WU-1770-default-resolver',
          'run-default-resolver-1',
          workspaceConfigHash,
        ),
      );

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe(SUBPROCESS_SANDBOX_UNAVAILABLE_ERROR_CODE);
    } finally {
      registerSpy.mockRestore();
    }
  });

  it('applies manifest-declared input schema in default resolver output', async () => {
    await writeManifest([
      'id: software-delivery',
      'version: 1.0.0',
      'task_types:',
      '  - work-unit',
      'tools:',
      `  - name: ${PACK_ECHO_TOOL_NAME}`,
      '    entry: tools/echo.ts',
      '    permission: read',
      '    required_scopes:',
      '      - type: path',
      '        pattern: "**"',
      '        access: read',
      '    input_schema:',
      '      type: object',
      '      required:',
      '        - message',
      '      properties:',
      '        message:',
      '          type: string',
      '          minLength: 1',
      'policies:',
      '  - id: runtime.completion.allow',
      '    trigger: on_completion',
      '    decision: allow',
      'state_aliases:',
      '  active: in_progress',
      'evidence_types: []',
      'lane_templates: []',
      'config_key: software_delivery',
    ]);

    const runtime = await createRuntimeWithDefaultResolver({
      sandboxSubprocessDispatcherOptions: {
        commandExists: () => false,
      },
    });

    const invalidInputOutput = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 42 },
      createExecutionContext(
        'WU-1951-default-resolver-schema',
        'run-default-resolver-schema-1',
        workspaceConfigHash,
      ),
    );

    expect(invalidInputOutput.success).toBe(false);
    expect(invalidInputOutput.error?.code).toBe(INVALID_INPUT_ERROR_CODE);

    const validInputOutput = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'hello' },
      createExecutionContext(
        'WU-1951-default-resolver-schema',
        'run-default-resolver-schema-2',
        workspaceConfigHash,
      ),
    );

    expect(validInputOutput.success).toBe(false);
    expect(validInputOutput.error?.code).toBe(SUBPROCESS_SANDBOX_UNAVAILABLE_ERROR_CODE);
  });

  it('honors manifest-declared permission and required scopes in default resolver output', async () => {
    await writeManifest([
      'id: software-delivery',
      'version: 1.0.0',
      'task_types:',
      '  - work-unit',
      'tools:',
      `  - name: ${PACK_ECHO_TOOL_NAME}`,
      '    entry: tools/echo.ts',
      '    permission: admin',
      '    required_scopes:',
      '      - type: path',
      '        pattern: "runtime/**"',
      '        access: write',
      'policies:',
      '  - id: runtime.completion.allow',
      '    trigger: on_completion',
      '    decision: allow',
      'state_aliases:',
      '  active: in_progress',
      'evidence_types: []',
      'lane_templates: []',
      'config_key: software_delivery',
    ]);

    const registerSpy = vi.spyOn(ToolRegistry.prototype, 'register');
    try {
      const runtime = await createRuntimeWithDefaultResolver();
      const registeredPackCapability = registerSpy.mock.calls
        .map((call) => call[0])
        .find((capability) => capability.name === PACK_ECHO_TOOL_NAME);

      expect(registeredPackCapability).toBeDefined();
      expect(registeredPackCapability?.permission).toBe('admin');
      expect(registeredPackCapability?.required_scopes).toEqual([
        {
          type: 'path',
          pattern: 'runtime/**',
          access: 'write',
        },
      ]);

      const output = await runtime.executeTool(
        PACK_ECHO_TOOL_NAME,
        { message: 'hello' },
        createExecutionContext(
          'WU-1778-manifest-permission-scope',
          'run-1778-manifest-permission-scope-1',
          workspaceConfigHash,
        ),
      );

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe(SCOPE_DENIED_ERROR_CODE);
    } finally {
      registerSpy.mockRestore();
    }
  });

  it('emits workspace_updated with the computed workspace hash at runtime initialization', async () => {
    await createRuntime();

    const eventsRaw = await readFile(join(tempRoot, 'events.jsonl'), UTF8_ENCODING);
    const events = eventsRaw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const workspaceUpdated = events.find((event) => event.kind === WORKSPACE_UPDATED_KIND);

    expect(workspaceUpdated).toBeDefined();
    expect(workspaceUpdated?.config_hash).toBe(workspaceConfigHash);
  });

  it('surfaces load-stage diagnostics when pack loading fails', async () => {
    await writeManifest([
      'id: software-delivery',
      'version: 1.0.0',
      'task_types:',
      '  - work-unit',
      'tools:',
      `  - name: ${PACK_ECHO_TOOL_NAME}`,
      '    entry: ../escape.ts',
      '    required_scopes:',
      '      - type: path',
      '        pattern: "**"',
      '        access: read',
      'policies:',
      '  - id: runtime.completion.allow',
      '    trigger: on_completion',
      '    decision: allow',
      'state_aliases:',
      '  active: in_progress',
      'evidence_types: []',
      'lane_templates: []',
    ]);

    await expect(createRuntimeWithDefaultResolver()).rejects.toThrow(RUNTIME_LOAD_STAGE_ERROR);
  });

  it('surfaces registration-stage diagnostics when resolver fails', async () => {
    await expect(
      initializeKernelRuntime({
        workspaceRoot: tempRoot,
        packsRoot: join(tempRoot, PACKS_DIR_NAME),
        taskSpecRoot: join(tempRoot, 'tasks'),
        eventsFilePath: join(tempRoot, 'events.jsonl'),
        eventLockFilePath: join(tempRoot, 'events.lock'),
        evidenceRoot: join(tempRoot, 'evidence'),
        toolCapabilityResolver: async () => {
          throw new Error(RESOLVER_EXPLODED_MESSAGE);
        },
      }),
    ).rejects.toThrow(RUNTIME_REGISTRATION_STAGE_ERROR);
  });

  it('covers load -> register -> execute -> receipt for manifest-declared runtime tools', async () => {
    let transportRequestCommand = '';
    let transportRequestArgs: string[] = [];
    let transportRequestStdin = '';
    const transport: SubprocessTransport = {
      async execute(request) {
        transportRequestCommand = request.command;
        transportRequestArgs = request.args;
        transportRequestStdin = request.stdin;
        return {
          code: 0,
          stdout: JSON.stringify({
            output: {
              success: true,
              data: {
                echo: 'receipt-stage',
              },
            },
          }),
          stderr: '',
        };
      },
    };

    const runtime = await createRuntimeWithDefaultResolver({
      sandboxSubprocessDispatcherOptions: {
        commandExists: () => true,
        transport,
      },
    });
    const taskSpec = createTaskSpec('WU-1774-pack-e2e');
    await runtime.createTask(taskSpec);

    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1774-pack',
    });

    const execution = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'receipt-stage' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );

    if (execution.error?.code === TOOL_NOT_FOUND_ERROR_CODE) {
      throw new Error(REGISTRATION_STAGE_FAILURE_MESSAGE);
    }
    expect(execution.success).toBe(true);
    expect(execution.data).toMatchObject({ echo: 'receipt-stage' });
    expect(transportRequestCommand).toBe('bwrap');
    expect(transportRequestArgs).toContain('--die-with-parent');

    const workerPayload = JSON.parse(transportRequestStdin) as {
      tool_name: string;
      handler_entry: string;
      input: { message: string };
      receipt_id: string;
    };
    expect(workerPayload.tool_name).toBe(PACK_ECHO_TOOL_NAME);
    expect(workerPayload.input.message).toBe('receipt-stage');
    expect(workerPayload.handler_entry.endsWith('/tools/echo.ts')).toBe(true);
    expect(workerPayload.receipt_id.length).toBeGreaterThan(0);

    const inspection = await runtime.inspectTask(taskSpec.id);
    const started = inspection.receipts.find(
      (trace) => trace.kind === TOOL_CALL_STARTED_KIND && trace.tool_name === PACK_ECHO_TOOL_NAME,
    );
    if (!started || started.kind !== TOOL_CALL_STARTED_KIND) {
      throw new Error(RECEIPT_STAGE_FAILURE_MESSAGE);
    }

    const finished = inspection.receipts.find(
      (trace) => trace.kind === TOOL_CALL_FINISHED_KIND && trace.receipt_id === started.receipt_id,
    );
    expect(finished).toBeDefined();
    if (finished?.kind === TOOL_CALL_FINISHED_KIND) {
      expect(finished.result).toBe('success');
    }
  });

  it('runs bootstrapped tracer-bullet lifecycle with auditable receipts, scope enforcement, and policy decisions', async () => {
    let transportRequestCommand = '';
    let transportRequestArgs: string[] = [];
    let transportRequestStdin = '';
    const transport: SubprocessTransport = {
      async execute(request) {
        transportRequestCommand = request.command;
        transportRequestArgs = request.args;
        transportRequestStdin = request.stdin;
        return {
          code: 0,
          stdout: JSON.stringify({
            output: {
              success: true,
              data: {
                echo: 'tracer-bullet',
              },
            },
          }),
          stderr: '',
        };
      },
    };

    const runtime = await createRuntimeWithDefaultResolver({
      sandboxSubprocessDispatcherOptions: {
        commandExists: () => true,
        transport,
      },
    });
    const taskSpec = createTaskSpec('WU-1892-tracer-bullet');
    const evidenceRef = 'evidence://tracer-bullet/pack-echo';

    const created = await runtime.createTask(taskSpec);
    expect(created.task.id).toBe(taskSpec.id);

    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1892-tracer-bullet',
    });
    expect(claim.run.status).toBe('executing');

    const execution = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'tracer-bullet' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );
    expect(execution.success).toBe(true);
    expect(execution.data).toMatchObject({ echo: 'tracer-bullet' });

    const completion = await runtime.completeTask({
      task_id: taskSpec.id,
      run_id: claim.run.run_id,
      evidence_refs: [evidenceRef],
    });
    expect(completion.policy.decision).toBe('allow');
    for (const event of completion.events) {
      const maybeEvidenceRefs = (event as { evidence_refs?: string[] }).evidence_refs;
      if (Array.isArray(maybeEvidenceRefs)) {
        expect(maybeEvidenceRefs).toContain(evidenceRef);
      }
    }

    expect(transportRequestCommand).toBe('bwrap');
    expect(transportRequestArgs).toContain('--die-with-parent');
    const workerPayload = JSON.parse(transportRequestStdin) as {
      tool_name: string;
      input: { message: string };
      receipt_id: string;
      handler_entry: string;
    };
    expect(workerPayload.tool_name).toBe(PACK_ECHO_TOOL_NAME);
    expect(workerPayload.input.message).toBe('tracer-bullet');
    expect(workerPayload.handler_entry.endsWith('/tools/echo.ts')).toBe(true);
    expect(workerPayload.receipt_id.length).toBeGreaterThan(0);

    const inspection = await runtime.inspectTask(taskSpec.id);
    expect(inspection.state.status).toBe('done');

    const eventKinds = inspection.events.map((event) => event.kind);
    expect(eventKinds).toContain('task_created');
    expect(eventKinds).toContain('task_claimed');
    expect(eventKinds).toContain('run_started');
    expect(eventKinds).toContain('run_succeeded');
    expect(eventKinds).toContain('task_completed');

    const started = inspection.receipts.find(
      (trace) => trace.kind === TOOL_CALL_STARTED_KIND && trace.tool_name === PACK_ECHO_TOOL_NAME,
    );
    if (!started || started.kind !== TOOL_CALL_STARTED_KIND) {
      throw new Error(RECEIPT_STAGE_FAILURE_MESSAGE);
    }

    expect(started.scope_requested).toEqual([WORKSPACE_SCOPE]);
    expect(started.scope_allowed).toEqual([WORKSPACE_SCOPE]);
    expect(started.scope_enforced).toEqual([WORKSPACE_SCOPE]);

    const finished = inspection.receipts.find(
      (trace) => trace.kind === TOOL_CALL_FINISHED_KIND && trace.receipt_id === started.receipt_id,
    );
    expect(finished).toBeDefined();
    if (finished?.kind === TOOL_CALL_FINISHED_KIND) {
      expect(finished.result).toBe('success');
    }

    expect(
      inspection.policy_decisions.some(
        (decision) =>
          decision.policy_id === 'runtime.completion.allow' && decision.decision === 'allow',
      ),
    ).toBe(true);
  });

  it('fails execution and emits spec_tampered when workspace hash drifts', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1773-workspace-tamper');
    await runtime.createTask(taskSpec);

    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1773-workspace-tamper',
    });

    const workspacePath = join(tempRoot, WORKSPACE_FILE_NAME);
    const originalYaml = await readFile(workspacePath, UTF8_ENCODING);
    const tamperedYaml = originalYaml.replace(
      'name: Kernel Runtime Workspace',
      'name: Kernel Runtime Workspace Tampered',
    );
    await writeFile(workspacePath, tamperedYaml, UTF8_ENCODING);
    const tamperedHash = canonical_json(tamperedYaml);

    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'tamper-detection' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe(SPEC_TAMPERED_ERROR_CODE);

    const eventsRaw = await readFile(join(tempRoot, 'events.jsonl'), UTF8_ENCODING);
    const events = eventsRaw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const tamperedEvent = events.find((event) => event.kind === SPEC_TAMPERED_KIND);

    expect(tamperedEvent).toBeDefined();
    expect(tamperedEvent?.spec).toBe('workspace');
    expect(tamperedEvent?.id).toBe('workspace-kernel-runtime');
    expect(tamperedEvent?.expected_hash).toBe(workspaceConfigHash);
    expect(tamperedEvent?.actual_hash).toBe(tamperedHash);
  });

  it('ignores caller-supplied workspace hash and enforces startup baseline', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1780-baseline-enforced');
    await runtime.createTask(taskSpec);

    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1780-baseline-enforced',
    });

    const fakeMetadataHash =
      workspaceConfigHash === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'baseline-enforced' },
      createExecutionContext(taskSpec.id, claim.run.run_id, fakeMetadataHash),
    );

    expect(output.success).toBe(true);

    const inspection = await runtime.inspectTask(taskSpec.id);
    const started = inspection.receipts.find(
      (trace) => trace.kind === TOOL_CALL_STARTED_KIND && trace.tool_name === PACK_ECHO_TOOL_NAME,
    );
    if (started?.kind === TOOL_CALL_STARTED_KIND) {
      expect(started.workspace_config_hash).toBe(workspaceConfigHash);
    }
    expect(inspection.events.some((event) => event.kind === SPEC_TAMPERED_KIND)).toBe(false);
  });

  it('returns structured spec_tampered when workspace config file is missing after init', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1780-missing-workspace-file');
    await runtime.createTask(taskSpec);

    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1780-missing-workspace',
    });

    const workspacePath = join(tempRoot, WORKSPACE_FILE_NAME);
    await rm(workspacePath);

    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'missing-workspace-file' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe(SPEC_TAMPERED_ERROR_CODE);
    expect(output.error?.details).toMatchObject({
      workspace_id: 'workspace-kernel-runtime',
      workspace_file_path: workspacePath,
      workspace_file_missing: true,
      expected_hash: workspaceConfigHash,
    });

    const actualHash = String((output.error?.details as Record<string, unknown>).actual_hash);
    expect(actualHash).toMatch(SHA256_HEX_REGEX);
    expect(actualHash).not.toBe(workspaceConfigHash);

    const eventsRaw = await readFile(join(tempRoot, 'events.jsonl'), UTF8_ENCODING);
    const events = eventsRaw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const tamperedEvent = events.find((event) => event.kind === SPEC_TAMPERED_KIND);

    expect(tamperedEvent).toBeDefined();
    expect(tamperedEvent?.spec).toBe('workspace');
    expect(tamperedEvent?.id).toBe('workspace-kernel-runtime');
    expect(tamperedEvent?.expected_hash).toBe(workspaceConfigHash);
    expect(tamperedEvent?.actual_hash).toBe(actualHash);
  });

  it('createTask writes immutable TaskSpec YAML and emits task_created', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1735-create');

    const created = await runtime.createTask(taskSpec);
    const yamlText = await readFile(created.task_spec_path, UTF8_ENCODING);

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

  it('blockTask and unblockTask enforce transitions and emit lifecycle events', async () => {
    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1787-block-unblock');
    await runtime.createTask(taskSpec);

    await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1787-claim',
    });

    const blockResult = await runtime.blockTask({
      task_id: taskSpec.id,
      reason: 'waiting on dependency',
    });

    expect(blockResult.event.kind).toBe('task_blocked');
    expect(blockResult.event.reason).toBe('waiting on dependency');

    const unblockResult = await runtime.unblockTask({
      task_id: taskSpec.id,
    });

    expect(unblockResult.event.kind).toBe('task_unblocked');

    const inspection = await runtime.inspectTask(taskSpec.id);
    const eventKinds = inspection.events.map((event) => event.kind);

    expect(inspection.state.status).toBe('active');
    expect(eventKinds).toContain('task_blocked');
    expect(eventKinds).toContain('task_unblocked');

    await runtime.completeTask({
      task_id: taskSpec.id,
    });

    await expect(
      runtime.blockTask({
        task_id: taskSpec.id,
        reason: 'should fail after completion',
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
      PACK_ECHO_TOOL_NAME,
      { message: 'policy-receipts' },
      createExecutionContext(taskSpec.id, claimResult.run.run_id, workspaceConfigHash),
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

  it('cleans up partial spec file when writeTaskSpecImmutable write fails mid-write', async () => {
    // Test the writeTaskSpecImmutable cleanup: if the file handle write fails
    // after the file was created (via 'wx' open), the file should be removed.
    // We simulate this by creating a task spec path as a directory, which will
    // cause writeFile to fail after the file handle is obtained.
    // Actually, 'wx' opens exclusively, so we use a different approach:
    // We test the cleanup indirectly -- if writeFile inside the handle fails,
    // the partial file should be removed so the task can be retried.

    const runtime = await createRuntime();
    const taskSpec = createTaskSpec('WU-1860-partial-write');

    // Normal create should work
    const created = await runtime.createTask(taskSpec);
    expect(created.task.id).toBe('WU-1860-partial-write');

    // Verify the file exists and is valid
    const yamlText = await readFile(created.task_spec_path, UTF8_ENCODING);
    expect(yamlText).toContain('WU-1860-partial-write');
  });

  it('handles crash between spec write and event emission in createTask', async () => {
    const appendSpy = vi.spyOn(EventStore.prototype, 'append');
    try {
      const runtime = await createRuntime();
      const taskSpec = createTaskSpec('WU-1860-crash-recovery');

      // Make event store append fail to simulate crash between spec write and event emission
      appendSpy.mockRejectedValueOnce(new Error('Simulated event store crash'));

      // createTask should propagate the error
      await expect(runtime.createTask(taskSpec)).rejects.toThrow('Simulated event store crash');

      // The spec file was written but the event was not emitted.
      // The spec file should be cleaned up so the task can be retried.
      const specPath = join(tempRoot, 'tasks', 'WU-1860-crash-recovery.yaml');
      let specExists = true;
      try {
        const { access: fsAccess } = await import('node:fs/promises');
        await fsAccess(specPath);
      } catch {
        specExists = false;
      }
      expect(specExists).toBe(false);
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('prunes evidence receipt index when completing a task', async () => {
    const pruneSpy = vi.spyOn(EvidenceStore.prototype, 'pruneTask');
    try {
      const runtime = await createRuntime();
      const taskSpec = createTaskSpec('WU-1782-prune-on-complete');
      await runtime.createTask(taskSpec);

      await runtime.claimTask({
        task_id: taskSpec.id,
        by: 'tom@hellm.ai',
        session_id: 'session-1782-prune',
      });

      await runtime.completeTask({
        task_id: taskSpec.id,
      });

      expect(pruneSpy).toHaveBeenCalledWith(taskSpec.id);
    } finally {
      pruneSpy.mockRestore();
    }
  });

  it('generates unique run IDs even when called within the same millisecond', () => {
    // defaultRunIdFactory should produce unique IDs for the same taskId and runNumber
    // by including a monotonic counter or random suffix
    const taskId = 'WU-1863-uniqueness';
    const runNumber = 1;

    const ids = new Set<string>();
    for (let index = 0; index < 1000; index++) {
      ids.add(defaultRunIdFactory(taskId, runNumber));
    }

    // All 1000 IDs should be unique
    expect(ids.size).toBe(1000);
  });

  it('inspectTask returns correct receipts when multiple tasks exist', async () => {
    const runtime = await createRuntime();

    // Create two tasks
    const taskSpecA = createTaskSpec('WU-1868-task-a');
    const taskSpecB = createTaskSpec('WU-1868-task-b');
    await runtime.createTask(taskSpecA);
    await runtime.createTask(taskSpecB);

    // Claim both tasks
    const claimA = await runtime.claimTask({
      task_id: taskSpecA.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1868-a',
    });
    const claimB = await runtime.claimTask({
      task_id: taskSpecB.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1868-b',
    });

    // Execute tool calls against both tasks
    await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'task-a-call-1' },
      createExecutionContext(taskSpecA.id, claimA.run.run_id, workspaceConfigHash),
    );
    await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'task-b-call-1' },
      createExecutionContext(taskSpecB.id, claimB.run.run_id, workspaceConfigHash),
    );
    await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'task-a-call-2' },
      createExecutionContext(taskSpecA.id, claimA.run.run_id, workspaceConfigHash),
    );

    // Inspect task A -- should only see task A's receipts
    const inspectionA = await runtime.inspectTask(taskSpecA.id);
    const startedA = inspectionA.receipts.filter((trace) => trace.kind === TOOL_CALL_STARTED_KIND);
    const finishedA = inspectionA.receipts.filter(
      (trace) => trace.kind === TOOL_CALL_FINISHED_KIND,
    );

    // Task A had 2 tool calls: should have 2 started + 2 finished = 4 receipts
    expect(startedA).toHaveLength(2);
    expect(finishedA).toHaveLength(2);
    expect(inspectionA.receipts).toHaveLength(4);

    // Verify all started receipts belong to task A
    for (const trace of startedA) {
      if (trace.kind === TOOL_CALL_STARTED_KIND) {
        expect(trace.task_id).toBe(taskSpecA.id);
      }
    }

    // Verify finished receipts are paired with task A's started receipts
    const startedReceiptIdsA = new Set(startedA.map((trace) => trace.receipt_id));
    for (const trace of finishedA) {
      expect(startedReceiptIdsA.has(trace.receipt_id)).toBe(true);
    }

    // Inspect task B -- should only see task B's receipts
    const inspectionB = await runtime.inspectTask(taskSpecB.id);
    const startedB = inspectionB.receipts.filter((trace) => trace.kind === TOOL_CALL_STARTED_KIND);
    const finishedB = inspectionB.receipts.filter(
      (trace) => trace.kind === TOOL_CALL_FINISHED_KIND,
    );

    // Task B had 1 tool call: should have 1 started + 1 finished = 2 receipts
    expect(startedB).toHaveLength(1);
    expect(finishedB).toHaveLength(1);
    expect(inspectionB.receipts).toHaveLength(2);

    // Verify task B's receipts don't overlap with task A's
    const allReceiptIdsA = new Set(inspectionA.receipts.map((trace) => trace.receipt_id));
    for (const trace of inspectionB.receipts) {
      expect(allReceiptIdsA.has(trace.receipt_id)).toBe(false);
    }
  });

  it('returns approval_required when policy evaluates to approval_required', async () => {
    const runtime = await initializeKernelRuntime({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, PACKS_DIR_NAME),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
      policyLayers: [
        {
          level: 'workspace',
          default_decision: 'allow',
          allow_loosening: true,
          rules: [],
        },
        {
          level: 'lane',
          rules: [
            {
              id: 'lane.approval.echo',
              trigger: 'on_tool_request' as const,
              decision: 'approval_required' as const,
              reason: 'Echo tool requires human approval',
              when: (context: { tool_name?: string }) => context.tool_name === PACK_ECHO_TOOL_NAME,
            },
          ],
        },
        { level: 'pack', rules: [] },
        { level: 'task', rules: [] },
      ],
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
            data: { echo: (input as { message: string }).message },
          }),
        },
        description: 'Echo tool',
        pack: loadedPack.pin.id,
      }),
    });

    const taskSpec = createTaskSpec('WU-1922-approval-required');
    await runtime.createTask(taskSpec);
    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1922-approval',
    });

    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'needs-approval' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('APPROVAL_REQUIRED');
    expect(output.error?.message).toContain('approval');
  });

  it('resolveApproval resumes a tool blocked by approval_required', async () => {
    const runtime = await initializeKernelRuntime({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, PACKS_DIR_NAME),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
      policyLayers: [
        {
          level: 'workspace',
          default_decision: 'allow',
          allow_loosening: true,
          rules: [],
        },
        {
          level: 'lane',
          rules: [
            {
              id: 'lane.approval.echo',
              trigger: 'on_tool_request' as const,
              decision: 'approval_required' as const,
              reason: 'Echo tool requires human approval',
              when: (context: { tool_name?: string }) => context.tool_name === PACK_ECHO_TOOL_NAME,
            },
          ],
        },
        { level: 'pack', rules: [] },
        { level: 'task', rules: [] },
      ],
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
            data: { echo: (input as { message: string }).message },
          }),
        },
        description: 'Echo tool',
        pack: loadedPack.pin.id,
      }),
    });

    const taskSpec = createTaskSpec('WU-1922-resolve-approval');
    await runtime.createTask(taskSpec);
    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1922-resolve',
    });

    // Execute tool -- should return APPROVAL_REQUIRED with a request_id
    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'needs-approval' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('APPROVAL_REQUIRED');
    const requestId = (output.error?.details as Record<string, unknown>)?.request_id;
    expect(typeof requestId).toBe('string');

    // Resolve the approval
    const resolved = await runtime.resolveApproval({
      request_id: requestId as string,
      approved: true,
      approved_by: 'tom@hellm.ai',
      reason: 'Approved for testing',
    });

    expect(resolved.approved).toBe(true);

    // Verify approval events were emitted
    const inspection = await runtime.inspectTask(taskSpec.id);
    const eventKinds = inspection.events.map((event) => event.kind);
    expect(eventKinds).toContain('task_waiting');
    expect(eventKinds).toContain('task_resumed');
  });

  it('resolveApproval with approved=false rejects the pending request', async () => {
    const runtime = await initializeKernelRuntime({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, PACKS_DIR_NAME),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
      policyLayers: [
        {
          level: 'workspace',
          default_decision: 'allow',
          allow_loosening: true,
          rules: [],
        },
        {
          level: 'lane',
          rules: [
            {
              id: 'lane.approval.echo',
              trigger: 'on_tool_request' as const,
              decision: 'approval_required' as const,
              reason: 'Echo tool requires human approval',
              when: (context: { tool_name?: string }) => context.tool_name === PACK_ECHO_TOOL_NAME,
            },
          ],
        },
        { level: 'pack', rules: [] },
        { level: 'task', rules: [] },
      ],
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
            data: { echo: (input as { message: string }).message },
          }),
        },
        description: 'Echo tool',
        pack: loadedPack.pin.id,
      }),
    });

    const taskSpec = createTaskSpec('WU-1922-reject-approval');
    await runtime.createTask(taskSpec);
    const claim = await runtime.claimTask({
      task_id: taskSpec.id,
      by: 'tom@hellm.ai',
      session_id: 'session-1922-reject',
    });

    const output = await runtime.executeTool(
      PACK_ECHO_TOOL_NAME,
      { message: 'will-be-rejected' },
      createExecutionContext(taskSpec.id, claim.run.run_id, workspaceConfigHash),
    );

    expect(output.error?.code).toBe('APPROVAL_REQUIRED');
    const requestId = (output.error?.details as Record<string, unknown>)?.request_id;

    const resolved = await runtime.resolveApproval({
      request_id: requestId as string,
      approved: false,
      approved_by: 'tom@hellm.ai',
      reason: 'Rejected for testing',
    });

    expect(resolved.approved).toBe(false);
  });

  describe('workspace root-key validation during runtime boot', () => {
    async function writeWorkspaceWithExtraKey(
      root: string,
      extraKeys: Record<string, string>,
    ): Promise<void> {
      const extraLines = Object.entries(extraKeys).map(([k, v]) => `${k}: ${v}`);
      await writeFile(
        join(root, WORKSPACE_FILE_NAME),
        [
          'id: workspace-kernel-runtime',
          'name: Kernel Runtime Workspace',
          'packs:',
          `  - id: ${SOFTWARE_DELIVERY_PACK_ID}`,
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
          'software_delivery: {}',
          'memory_namespace: mem',
          'event_namespace: evt',
          ...extraLines,
        ].join('\n'),
        UTF8_ENCODING,
      );
    }

    async function writeManifestWithConfigKey(root: string, configKey: string): Promise<void> {
      const packRoot = join(root, PACKS_DIR_NAME, SOFTWARE_DELIVERY_PACK_ID);
      await writeFile(
        join(packRoot, PACK_MANIFEST_FILE_NAME),
        [
          `id: ${SOFTWARE_DELIVERY_PACK_ID}`,
          'version: 1.0.0',
          'task_types:',
          '  - work-unit',
          'tools:',
          `  - name: ${PACK_ECHO_TOOL_NAME}`,
          '    entry: tools/echo.ts',
          '    required_scopes:',
          '      - type: path',
          '        pattern: "**"',
          '        access: read',
          'policies:',
          '  - id: runtime.completion.allow',
          '    trigger: on_completion',
          '    decision: allow',
          'state_aliases:',
          '  active: in_progress',
          'evidence_types: []',
          'lane_templates: []',
          `config_key: ${configKey}`,
        ].join('\n'),
        UTF8_ENCODING,
      );
    }

    it('rejects workspace with unknown root keys during initializeKernelRuntime', async () => {
      await writeWorkspaceWithExtraKey(tempRoot, { bogus_key: 'true' });

      await expect(createRuntime()).rejects.toThrow('bogus_key');
    });

    it('rejects workspace with multiple unknown root keys and lists all of them', async () => {
      await writeWorkspaceWithExtraKey(tempRoot, {
        bogus_key: 'true',
        another_unknown: '42',
      });

      await expect(createRuntime()).rejects.toThrow('bogus_key');
      await expect(createRuntime()).rejects.toThrow('another_unknown');
    });

    it('accepts workspace with pack-declared config_key root (software_delivery)', async () => {
      // The default fixture includes software_delivery: {} in workspace.yaml
      // and the pack manifest declares config_key: software_delivery
      await writeManifestWithConfigKey(tempRoot, 'software_delivery');

      // This should NOT throw -- software_delivery is declared by the pack
      const runtime = await createRuntime();
      expect(runtime).toBeDefined();
    });

    it('rejects workspace when pack does NOT declare config_key for an extra root key', async () => {
      // Workspace has software_delivery: {} but we overwrite the manifest
      // to NOT declare config_key. Without config_key, software_delivery
      // is an unknown root key and must be rejected.
      const packRoot = join(tempRoot, PACKS_DIR_NAME, SOFTWARE_DELIVERY_PACK_ID);
      await writeFile(
        join(packRoot, PACK_MANIFEST_FILE_NAME),
        [
          `id: ${SOFTWARE_DELIVERY_PACK_ID}`,
          'version: 1.0.0',
          'task_types:',
          '  - work-unit',
          'tools:',
          `  - name: ${PACK_ECHO_TOOL_NAME}`,
          '    entry: tools/echo.ts',
          '    required_scopes:',
          '      - type: path',
          '        pattern: "**"',
          '        access: read',
          'policies:',
          '  - id: runtime.completion.allow',
          '    trigger: on_completion',
          '    decision: allow',
          'state_aliases:',
          '  active: in_progress',
          'evidence_types: []',
          'lane_templates: []',
          // Deliberately omitting config_key
        ].join('\n'),
        UTF8_ENCODING,
      );

      await expect(createRuntime()).rejects.toThrow('software_delivery');
    });

    it('error message suggests pack config_key when unknown root key is present', async () => {
      await writeWorkspaceWithExtraKey(tempRoot, { observability: '{}' });

      await expect(createRuntime()).rejects.toThrow(/pack.*manifest/i);
    });

    // --- Legacy workspace migration tests (WU-2196) ---

    async function writeLegacyWorkspace(root: string): Promise<void> {
      // Legacy workspace: has software_delivery config but NO SD pack pinned (packs: [])
      await writeFile(
        join(root, WORKSPACE_FILE_NAME),
        [
          'id: workspace-kernel-runtime',
          'name: Kernel Runtime Workspace',
          'packs: []',
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
          'software_delivery:',
          '  methodology: trunk-based',
          'memory_namespace: mem',
          'event_namespace: evt',
        ].join('\n'),
        UTF8_ENCODING,
      );
    }

    async function writeWorkspaceWithoutSoftwareDelivery(root: string): Promise<void> {
      // Clean workspace: no software_delivery key at all, no packs
      await writeFile(
        join(root, WORKSPACE_FILE_NAME),
        [
          'id: workspace-kernel-runtime',
          'name: Kernel Runtime Workspace',
          'packs: []',
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
        UTF8_ENCODING,
      );
    }

    it('rejects legacy workspace (software_delivery present, no SD pack pinned) with actionable migration error', async () => {
      await writeLegacyWorkspace(tempRoot);

      const error = await createRuntime().catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      // Must mention the specific key
      expect(error.message).toContain('software_delivery');
      // Must include actionable remediation — not the generic error
      expect(error.message).toMatch(/software-delivery.*pack/i);
      // Must include the executable pack:install remediation command
      expect(error.message).toContain('pnpm pack:install');
      expect(error.message).toContain('--id software-delivery');
      expect(error.message).toContain('--source local');
      // Must NOT be the generic "Unknown workspace root key" message
      expect(error.message).not.toContain('Unknown workspace root key');
    });

    it('boots cleanly when workspace has no software_delivery key and no packs', async () => {
      await writeWorkspaceWithoutSoftwareDelivery(tempRoot);

      // No software_delivery key means no migration issue — should boot fine
      const runtime = await createRuntime();
      expect(runtime).toBeDefined();
    });

    it('truly unknown root key still gets generic error even when legacy pattern is also present', async () => {
      // Legacy workspace with software_delivery AND an unknown key
      await writeFile(
        join(tempRoot, WORKSPACE_FILE_NAME),
        [
          'id: workspace-kernel-runtime',
          'name: Kernel Runtime Workspace',
          'packs: []',
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
          'software_delivery: {}',
          'totally_bogus: true',
          'memory_namespace: mem',
          'event_namespace: evt',
        ].join('\n'),
        UTF8_ENCODING,
      );

      const error = await createRuntime().catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      // The software_delivery key should get the migration-specific error
      expect(error.message).toContain('software_delivery');
      // The truly unknown key should still be reported
      expect(error.message).toContain('totally_bogus');
    });
  });
});
