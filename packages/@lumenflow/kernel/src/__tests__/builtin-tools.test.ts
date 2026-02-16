import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceStore } from '../evidence/evidence-store.js';
import type { ExecutionContext, ToolScope } from '../kernel.schemas.js';
import {
  createBuiltinPolicyHook,
  createBuiltinToolCapabilities,
  listAgentVisibleBuiltinTools,
  registerBuiltinToolCapabilities,
} from '../tool-host/builtins/index.js';
import type { SubprocessDispatchRequest, SubprocessDispatcher } from '../tool-host/index.js';
import { ToolHost, ToolRegistry } from '../tool-host/index.js';

interface StubDispatcherCall {
  request: SubprocessDispatchRequest;
}

class StubDispatcher implements SubprocessDispatcher {
  public readonly calls: StubDispatcherCall[] = [];

  async dispatch(request: SubprocessDispatchRequest) {
    this.calls.push({ request });
    if (request.capability.name === 'fs:write') {
      return {
        success: true,
        data: {
          queued: true,
          target: String((request.input as { path?: unknown }).path || ''),
        },
        metadata: {
          artifacts_written: ['sandbox/write-receipt.json'],
        },
      };
    }

    return {
      success: true,
      data: {
        exit_code: 0,
        stdout: '',
        stderr: '',
      },
    };
  }
}

function buildExecutionContext(scopes: ToolScope[]): ExecutionContext {
  return {
    run_id: 'run-1731',
    task_id: 'WU-1731',
    session_id: 'session-1731',
    allowed_scopes: scopes,
    metadata: {
      workspace_allowed_scopes: scopes,
      lane_allowed_scopes: scopes,
      task_declared_scopes: scopes,
      workspace_config_hash: 'b'.repeat(64),
      runtime_version: '2.21.0',
      pack_id: 'kernel',
      pack_version: '1.0.0',
      pack_integrity: `sha256:${'c'.repeat(64)}`,
    },
  };
}

describe('kernel built-in tools', () => {
  let tempDir: string;
  let evidenceRoot: string;
  let filePath: string;
  let writeTargetPath: string;
  let declaredScopes: ToolScope[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-builtin-tools-'));
    evidenceRoot = join(tempDir, 'evidence');
    filePath = join(tempDir, 'read-target.txt');
    writeTargetPath = join(tempDir, 'write-target.txt');
    await writeFile(filePath, 'builtin-read-content', 'utf8');
    declaredScopes = [
      { type: 'path', pattern: `${tempDir}/**`, access: 'read' },
      { type: 'path', pattern: `${tempDir}/**`, access: 'write' },
      { type: 'network', posture: 'off' },
    ];
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates fs:read, fs:write, and proc:exec capabilities with expected execution modes', () => {
    const capabilities = createBuiltinToolCapabilities({
      declaredScopes,
      includeInternalTools: true,
      subprocessEntries: {
        fsWrite: 'kernel/builtins/fs-write.worker.js',
        procExec: 'kernel/builtins/proc-exec.worker.js',
      },
    });

    const fsRead = capabilities.find((capability) => capability.name === 'fs:read');
    const fsWrite = capabilities.find((capability) => capability.name === 'fs:write');
    const procExec = capabilities.find((capability) => capability.name === 'proc:exec');

    expect(fsRead).toBeDefined();
    expect(fsRead?.permission).toBe('read');
    expect(fsRead?.handler.kind).toBe('in-process');

    expect(fsWrite).toBeDefined();
    expect(fsWrite?.permission).toBe('write');
    expect(fsWrite?.handler.kind).toBe('subprocess');
    expect(fsWrite?.required_scopes).toEqual(declaredScopes);

    expect(procExec).toBeDefined();
    expect(procExec?.permission).toBe('admin');
    expect(procExec?.handler.kind).toBe('subprocess');
  });

  it('keeps proc:exec internal-only by default and hidden from agent-visible tool lists', () => {
    const defaultCapabilities = createBuiltinToolCapabilities({
      declaredScopes,
    });
    const defaultNames = defaultCapabilities.map((capability) => capability.name);
    expect(defaultNames).toEqual(['fs:read', 'fs:write']);

    const fullCapabilities = createBuiltinToolCapabilities({
      declaredScopes,
      includeInternalTools: true,
    });
    expect(fullCapabilities.some((capability) => capability.name === 'proc:exec')).toBe(true);

    const visibleCapabilities = listAgentVisibleBuiltinTools(fullCapabilities);
    expect(visibleCapabilities.some((capability) => capability.name === 'proc:exec')).toBe(false);
  });

  it('registers built-ins in ToolRegistry and executes through ToolHost with receipts', async () => {
    const registry = new ToolRegistry();
    const registered = registerBuiltinToolCapabilities(registry, {
      declaredScopes,
      includeInternalTools: true,
    });
    expect(registered).toHaveLength(3);

    const evidenceStore = new EvidenceStore({
      evidenceRoot,
    });
    const subprocessDispatcher = new StubDispatcher();
    const host = new ToolHost({
      registry,
      evidenceStore,
      subprocessDispatcher,
      policyHook: createBuiltinPolicyHook(),
    });
    const context = buildExecutionContext(declaredScopes);

    const fsReadResult = await host.execute('fs:read', { path: filePath }, context);
    expect(fsReadResult.success).toBe(true);
    expect(fsReadResult.data).toEqual({
      path: filePath,
      content: 'builtin-read-content',
      bytes: Buffer.byteLength('builtin-read-content'),
    });

    const fsWriteResult = await host.execute(
      'fs:write',
      {
        path: writeTargetPath,
        content: 'queued write',
      },
      context,
    );
    expect(fsWriteResult.success).toBe(true);
    expect(fsWriteResult.data).toEqual({
      queued: true,
      target: writeTargetPath,
    });

    const procExecResult = await host.execute(
      'proc:exec',
      {
        command: 'echo',
        args: ['blocked'],
      },
      context,
    );
    expect(procExecResult.success).toBe(false);
    expect(procExecResult.error?.code).toBe('POLICY_DENIED');

    expect(subprocessDispatcher.calls).toHaveLength(1);
    expect(subprocessDispatcher.calls[0]?.request.capability.name).toBe('fs:write');

    const traces = await evidenceStore.readTraces();
    expect(traces).toHaveLength(6);
    const finishedEntries = traces.filter((trace) => trace.kind === 'tool_call_finished');
    expect(finishedEntries).toHaveLength(3);
    const deniedEntry = finishedEntries.find(
      (entry) => entry.kind === 'tool_call_finished' && entry.result === 'denied',
    );
    expect(deniedEntry).toBeDefined();

    const sourceFile = await readFile(filePath, 'utf8');
    expect(sourceFile).toBe('builtin-read-content');
  });
});
