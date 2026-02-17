// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolScope } from '../kernel.schemas.js';
import {
  executeToolRunnerInvocation,
  runToolRunnerWorkerFromStreams,
  type ToolRunnerWorkerInvocation,
} from '../sandbox/tool-runner-worker.js';

function captureStream(stream: PassThrough): { buffer: () => string } {
  let output = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    output += chunk;
  });
  return {
    buffer: () => output,
  };
}

describe('tool-runner-worker', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-worker-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads adapter from handler.entry and executes serialized invocation payload', async () => {
    const adapterPath = join(tempDir, 'adapter-success.mjs');
    await writeFile(
      adapterPath,
      [
        'export default async function adapter(input, context) {',
        '  return { success: true, data: { echoed: input.value, receipt: context.receipt_id } };',
        '}',
      ].join('\n'),
      'utf8',
    );

    const scopeEnforced: ToolScope[] = [{ type: 'path', pattern: 'docs/**', access: 'read' }];
    const output = await executeToolRunnerInvocation({
      tool_name: 'echo',
      handler_entry: adapterPath,
      input: { value: 'ok' },
      scope_enforced: scopeEnforced,
      receipt_id: 'receipt-1730',
    });

    expect(output.success).toBe(true);
    expect(output.data).toEqual({
      echoed: 'ok',
      receipt: 'receipt-1730',
    });
    expect(output.metadata?.scope_enforcement_note).toContain('read confinement best-effort');
  });

  it('returns structured load failures when adapter export is invalid', async () => {
    const adapterPath = join(tempDir, 'adapter-invalid.mjs');
    await writeFile(adapterPath, 'export const invalid = true;\n', 'utf8');

    const output = await executeToolRunnerInvocation({
      tool_name: 'invalid-adapter',
      handler_entry: adapterPath,
      input: {},
      scope_enforced: [],
      receipt_id: 'receipt-invalid',
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('ADAPTER_LOAD_FAILED');
  });

  it('processes stdin/stdout worker protocol for IPC transport', async () => {
    const adapterPath = join(tempDir, 'adapter-protocol.mjs');
    await writeFile(
      adapterPath,
      [
        'export default async function adapter(input) {',
        '  return { success: true, data: { command: input.command } };',
        '}',
      ].join('\n'),
      'utf8',
    );

    const invocation: ToolRunnerWorkerInvocation = {
      tool_name: 'proc:exec',
      handler_entry: adapterPath,
      input: { command: 'echo protocol' },
      scope_enforced: [{ type: 'path', pattern: 'packages/**', access: 'write' }],
      receipt_id: 'receipt-protocol',
    };

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutCapture = captureStream(stdout);
    const stderrCapture = captureStream(stderr);

    const runPromise = runToolRunnerWorkerFromStreams({ stdin, stdout, stderr });
    stdin.end(JSON.stringify(invocation));
    await runPromise;

    const protocolOutput = JSON.parse(stdoutCapture.buffer()) as { output: { success: boolean } };
    expect(protocolOutput.output.success).toBe(true);
    expect(stderrCapture.buffer()).toBe('');
  });

  it('returns structured protocol error for invalid stdin payloads', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutCapture = captureStream(stdout);
    const stderrCapture = captureStream(stderr);

    const runPromise = runToolRunnerWorkerFromStreams({ stdin, stdout, stderr });
    stdin.end('{broken-json');
    await runPromise;

    const protocolOutput = JSON.parse(stdoutCapture.buffer()) as {
      output: { success: boolean; error?: { code: string } };
    };
    expect(protocolOutput.output.success).toBe(false);
    expect(protocolOutput.output.error?.code).toBe('INVALID_INVOCATION_PAYLOAD');
    expect(stderrCapture.buffer()).toBe('');
  });
});
