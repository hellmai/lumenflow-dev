import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonical_json, canonicalStringify } from '../canonical-json.js';
import { EvidenceStore } from '../evidence/index.js';
import type { ToolTraceEntry } from '../kernel.schemas.js';

describe('evidence store', () => {
  let tempDir: string;
  let evidenceRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-evidence-'));
    evidenceRoot = join(tempDir, 'evidence');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeStartedEntry(receiptId: string): ToolTraceEntry {
    return {
      schema_version: 1,
      kind: 'tool_call_started',
      receipt_id: receiptId,
      run_id: 'run-1729',
      task_id: 'WU-1729',
      session_id: 'session-1729',
      timestamp: '2026-02-16T23:00:00.000Z',
      tool_name: 'fs:write',
      execution_mode: 'in-process',
      scope_requested: [{ type: 'path', pattern: 'packages/**', access: 'write' }],
      scope_allowed: [{ type: 'path', pattern: 'packages/@lumenflow/kernel/**', access: 'write' }],
      scope_enforced: [{ type: 'path', pattern: 'packages/@lumenflow/kernel/**', access: 'write' }],
      input_hash: 'a'.repeat(64),
      input_ref: `${evidenceRoot}/inputs/${'a'.repeat(64)}`,
      tool_version: '1.0.0',
      pack_id: 'software-delivery',
      pack_version: '1.0.0',
      pack_integrity: `sha256:${'b'.repeat(64)}`,
      workspace_config_hash: 'c'.repeat(64),
      runtime_version: '2.21.0',
    };
  }

  it('appends and replays JSONL trace entries', async () => {
    const store = new EvidenceStore({ evidenceRoot });
    const started = makeStartedEntry('receipt-1');
    const finished: ToolTraceEntry = {
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: 'receipt-1',
      timestamp: '2026-02-16T23:00:01.000Z',
      result: 'success',
      duration_ms: 120,
      scope_enforcement_note: 'Allowed by scope intersection',
      policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
      artifacts_written: ['packages/@lumenflow/kernel/src/example.ts'],
    };

    await store.appendTrace(started);
    await store.appendTrace(finished);

    const traces = await store.readTraces();
    expect(traces).toHaveLength(2);
    expect(traces[0]?.kind).toBe('tool_call_started');
    expect(traces[1]?.kind).toBe('tool_call_finished');
  });

  it('stores CAS inputs by SHA-256 hash and reuses stable refs', async () => {
    const store = new EvidenceStore({ evidenceRoot });
    const input = {
      tool: 'fs:write',
      path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
      content: 'hello world',
    };

    const first = await store.persistInput(input);
    const second = await store.persistInput(input);
    const canonical = canonicalStringify(input);

    expect(first.inputHash).toHaveLength(64);
    expect(first.inputHash).toBe(canonical_json(input));
    expect(first.inputRef).toBe(second.inputRef);
    expect(first.inputHash).toBe(second.inputHash);
    await expect(stat(first.inputRef)).resolves.toBeTruthy();
    await expect(readFile(first.inputRef, 'utf8')).resolves.toBe(canonical);
  });

  it('respects trace lock files when appending traces', async () => {
    const store = new EvidenceStore({
      evidenceRoot,
      lockRetryDelayMs: 1,
      lockMaxRetries: 1,
    });
    const lockPath = join(evidenceRoot, 'traces', 'tool-traces.lock');
    await mkdir(join(evidenceRoot, 'traces'), { recursive: true });
    await writeFile(lockPath, 'busy', 'utf8');

    await expect(store.appendTrace(makeStartedEntry('receipt-locked'))).rejects.toThrow(
      /acquire evidence-store lock/i,
    );
  });

  it('reconciles orphaned started entries with synthetic crashed finished entries', async () => {
    const store = new EvidenceStore({ evidenceRoot });
    const orphanReceipt = 'receipt-orphan';
    await store.appendTrace(makeStartedEntry(orphanReceipt));
    await store.appendTrace(makeStartedEntry('receipt-complete'));
    await store.appendTrace({
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: 'receipt-complete',
      timestamp: '2026-02-16T23:00:05.000Z',
      result: 'success',
      duration_ms: 10,
      policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
    });

    const reconciled = await store.reconcileOrphanedStarts();
    expect(reconciled).toBe(1);

    const traces = await store.readTraces();
    const orphanFinished = traces.find(
      (trace) => trace.kind === 'tool_call_finished' && trace.receipt_id === orphanReceipt,
    );
    expect(orphanFinished).toBeDefined();
    expect(orphanFinished?.kind).toBe('tool_call_finished');
    if (orphanFinished?.kind === 'tool_call_finished') {
      expect(orphanFinished.result).toBe('crashed');
    }
  });
});
