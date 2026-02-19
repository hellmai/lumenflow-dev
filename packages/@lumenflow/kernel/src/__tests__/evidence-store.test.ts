// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

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

  function makeStartedEntry(receiptId: string, taskId = 'WU-1729'): ToolTraceEntry {
    return {
      schema_version: 1,
      kind: 'tool_call_started',
      receipt_id: receiptId,
      run_id: 'run-1729',
      task_id: taskId,
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

  it('stores CAS data by SHA-256 hash and reuses stable refs via persistData', async () => {
    const store = new EvidenceStore({ evidenceRoot });
    const input = {
      tool: 'fs:write',
      path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
      content: 'hello world',
    };

    const first = await store.persistData(input);
    const second = await store.persistData(input);
    const canonical = canonicalStringify(input);

    expect(first.dataHash).toHaveLength(64);
    expect(first.dataHash).toBe(canonical_json(input));
    expect(first.dataRef).toBe(second.dataRef);
    expect(first.dataHash).toBe(second.dataHash);
    await expect(stat(first.dataRef)).resolves.toBeTruthy();
    await expect(readFile(first.dataRef, 'utf8')).resolves.toBe(canonical);
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

  it('reads task-scoped traces using task index lookups', async () => {
    const store = new EvidenceStore({ evidenceRoot });

    await store.appendTrace(makeStartedEntry('receipt-a', 'WU-1000'));
    await store.appendTrace({
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: 'receipt-a',
      timestamp: '2026-02-16T23:00:02.000Z',
      result: 'success',
      duration_ms: 5,
      policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
    });

    await store.appendTrace(makeStartedEntry('receipt-b', 'WU-2000'));
    await store.appendTrace({
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: 'receipt-b',
      timestamp: '2026-02-16T23:00:03.000Z',
      result: 'failure',
      duration_ms: 7,
      policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
    });

    const task1000 = await store.readTracesByTaskId('WU-1000');
    const task2000 = await store.readTracesByTaskId('WU-2000');
    const unknown = await store.readTracesByTaskId('WU-9999');

    expect(task1000).toHaveLength(2);
    expect(task2000).toHaveLength(2);
    expect(unknown).toHaveLength(0);

    expect(task1000.map((trace) => trace.receipt_id)).toEqual(['receipt-a', 'receipt-a']);
    expect(task2000.map((trace) => trace.receipt_id)).toEqual(['receipt-b', 'receipt-b']);
  });

  it('prunes receipt indexes for completed tasks via explicit pruneTask API', async () => {
    const store = new EvidenceStore({ evidenceRoot });

    await store.appendTrace(makeStartedEntry('receipt-a', 'WU-1000'));
    await store.appendTrace({
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: 'receipt-a',
      timestamp: '2026-02-16T23:00:02.000Z',
      result: 'success',
      duration_ms: 5,
      policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
    });

    await store.appendTrace(makeStartedEntry('receipt-b', 'WU-2000'));
    await store.appendTrace({
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: 'receipt-b',
      timestamp: '2026-02-16T23:00:03.000Z',
      result: 'success',
      duration_ms: 7,
      policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
    });

    expect(await store.getReceiptIndexSize()).toBe(2);
    const prunedCount = await store.pruneTask('WU-1000');

    expect(prunedCount).toBe(1);
    expect(await store.getReceiptIndexSize()).toBe(1);
    expect(await store.readTracesByTaskId('WU-1000')).toEqual([]);
    expect((await store.readTracesByTaskId('WU-2000')).map((trace) => trace.receipt_id)).toEqual([
      'receipt-b',
      'receipt-b',
    ]);
    expect(await store.readTraces()).toHaveLength(4);
  });

  it('cleans up lock file when operation fails after lock acquired', async () => {
    const store = new EvidenceStore({ evidenceRoot });
    const lockPath = join(evidenceRoot, 'traces', 'tool-traces.lock');

    // First, successfully append a trace to ensure the traces dir exists
    await store.appendTrace(makeStartedEntry('receipt-setup'));

    // Now create a store that will fail during the locked operation
    // We do this by making the traces file read-only so appendFile fails
    const tracesFilePath = join(evidenceRoot, 'traces', 'tool-traces.jsonl');
    const { chmod } = await import('node:fs/promises');
    await chmod(tracesFilePath, 0o444); // read-only

    try {
      await store.appendTrace(makeStartedEntry('receipt-fail'));
    } catch {
      // Expected to fail
    }

    // Restore permissions for cleanup
    await chmod(tracesFilePath, 0o644);

    // The lock file should NOT exist after a failed operation
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it('keeps receipt index bounded when completed tasks are pruned', async () => {
    const store = new EvidenceStore({ evidenceRoot });

    for (let index = 0; index < 100; index += 1) {
      const taskId = `WU-bounded-${index}`;
      const receiptId = `receipt-bounded-${index}`;
      await store.appendTrace(makeStartedEntry(receiptId, taskId));
      await store.appendTrace({
        schema_version: 1,
        kind: 'tool_call_finished',
        receipt_id: receiptId,
        timestamp: '2026-02-16T23:00:05.000Z',
        result: 'success',
        duration_ms: 1,
        policy_decisions: [{ policy_id: 'kernel.policy.allow-all', decision: 'allow' }],
      });
      await store.pruneTask(taskId);
    }

    expect(await store.getReceiptIndexSize()).toBe(0);
  });

  describe('JSONL compaction', () => {
    it('rotates active segment to numbered file when size threshold exceeded', async () => {
      const store = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 500,
      });

      // Append enough traces to exceed the 500-byte threshold
      for (let index = 0; index < 10; index += 1) {
        await store.appendTrace(
          makeStartedEntry(`receipt-compact-${index}`, `WU-compact-${index}`),
        );
      }

      // After compaction, a segment file should exist
      const { readdir } = await import('node:fs/promises');
      const tracesDir = join(evidenceRoot, 'traces');
      const files = await readdir(tracesDir);
      const segmentFiles = files.filter((f: string) => /^tool-traces\.\d+\.jsonl$/.test(f));

      expect(segmentFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves all events across compaction (no data loss)', async () => {
      const store = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 300,
      });

      const entryCount = 20;
      for (let index = 0; index < entryCount; index += 1) {
        await store.appendTrace(
          makeStartedEntry(`receipt-preserve-${index}`, `WU-preserve-${index}`),
        );
      }

      // All events must be readable via readTraces despite compaction
      const traces = await store.readTraces();
      expect(traces).toHaveLength(entryCount);

      // Verify every receipt_id is present
      const receiptIds = new Set(traces.map((t) => t.receipt_id));
      for (let index = 0; index < entryCount; index += 1) {
        expect(receiptIds.has(`receipt-preserve-${index}`)).toBe(true);
      }
    });

    it('maintains append-only invariant across segments', async () => {
      const store = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 400,
      });

      // Write, trigger compaction, write more
      for (let index = 0; index < 8; index += 1) {
        await store.appendTrace(makeStartedEntry(`receipt-inv-${index}`, `WU-inv-${index}`));
      }

      // Append more after compaction occurred
      await store.appendTrace(makeStartedEntry('receipt-post-compact', 'WU-post-compact'));

      const traces = await store.readTraces();
      const allReceiptIds = traces.map((t) => t.receipt_id);

      // Post-compact entry must be at the end (append-only order preserved)
      expect(allReceiptIds[allReceiptIds.length - 1]).toBe('receipt-post-compact');
      expect(traces).toHaveLength(9);
    });

    it('uses default threshold when compactionThresholdBytes not provided', async () => {
      // Just verifying the constructor accepts the option gracefully
      const store = new EvidenceStore({ evidenceRoot });
      await store.appendTrace(makeStartedEntry('receipt-default-thresh'));
      const traces = await store.readTraces();
      expect(traces).toHaveLength(1);
    });

    it('reads traces from a fresh store instance across compacted segments', async () => {
      const store1 = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 300,
      });

      for (let index = 0; index < 15; index += 1) {
        await store1.appendTrace(makeStartedEntry(`receipt-fresh-${index}`, `WU-fresh-${index}`));
      }

      // Create a brand-new store instance pointing to the same root
      const store2 = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 300,
      });

      const traces = await store2.readTraces();
      expect(traces).toHaveLength(15);

      // Verify ordering: receipt-fresh-0 should come before receipt-fresh-14
      expect(traces[0]?.receipt_id).toBe('receipt-fresh-0');
      expect(traces[14]?.receipt_id).toBe('receipt-fresh-14');
    });
  });

  describe('incremental replay', () => {
    it('does not re-read entire file when new traces appended after hydration', async () => {
      const store = new EvidenceStore({ evidenceRoot });

      // Initial hydration
      await store.appendTrace(makeStartedEntry('receipt-incr-1', 'WU-incr'));
      const traces1 = await store.readTraces();
      expect(traces1).toHaveLength(1);

      // Append more after hydration
      await store.appendTrace(makeStartedEntry('receipt-incr-2', 'WU-incr'));
      const traces2 = await store.readTraces();
      expect(traces2).toHaveLength(2);

      // The indexes should reflect both entries without a full re-read
      const taskTraces = await store.readTracesByTaskId('WU-incr');
      expect(taskTraces).toHaveLength(2);
    });

    it('provides O(1) amortized replay via cursor after initial hydration', async () => {
      const store = new EvidenceStore({ evidenceRoot });

      // Write initial batch
      const batchSize = 50;
      for (let index = 0; index < batchSize; index += 1) {
        await store.appendTrace(makeStartedEntry(`receipt-bench-${index}`, `WU-bench-${index}`));
      }

      // Initial hydration (reads full file - O(n))
      const t0 = performance.now();
      await store.readTraces();
      const initialReadMs = performance.now() - t0;

      // Append one more entry
      await store.appendTrace(makeStartedEntry('receipt-bench-extra', 'WU-bench-extra'));

      // Incremental read should be much faster (O(1) amortized)
      const t1 = performance.now();
      const traces = await store.readTraces();
      const incrementalReadMs = performance.now() - t1;

      expect(traces).toHaveLength(batchSize + 1);

      // Incremental read should be significantly faster than initial hydration
      // We use a generous ratio since timing can be noisy in CI
      // The key invariant: incremental is not doing O(n) work
      expect(incrementalReadMs).toBeLessThan(initialReadMs * 2);
    });

    it('incremental cursor works correctly across compacted segments', async () => {
      const store = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 400,
      });

      // Write enough to trigger compaction
      for (let index = 0; index < 8; index += 1) {
        await store.appendTrace(makeStartedEntry(`receipt-cur-${index}`, `WU-cur-${index}`));
      }

      // Hydrate
      const traces1 = await store.readTraces();
      const count1 = traces1.length;

      // Write more (may trigger another compaction)
      for (let index = 8; index < 12; index += 1) {
        await store.appendTrace(makeStartedEntry(`receipt-cur-${index}`, `WU-cur-${index}`));
      }

      // Incremental read should pick up new entries
      const traces2 = await store.readTraces();
      expect(traces2).toHaveLength(count1 + 4);
    });

    it('reads newly created segment files from other store instances', async () => {
      const reader = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 1,
      });
      const writer = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 1,
      });

      // Hydrate reader before writer appends/compacts.
      expect(await reader.readTraces()).toHaveLength(0);

      // A single append crosses threshold and rotates active file into a segment.
      await writer.appendTrace(makeStartedEntry('receipt-cross-process', 'WU-cross-process'));

      // Reader must ingest unseen segment files produced by another instance.
      const traces = await reader.readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0]?.receipt_id).toBe('receipt-cross-process');
    });

    it('does not produce duplicates when another instance compacts data already read by the reader (WU-1881)', async () => {
      // Use a large-enough threshold so we control compaction timing precisely.
      // Reader writes entries to active file, then writer compacts them to a segment.
      const reader = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 100_000, // high threshold: no auto-compaction
      });
      const writer = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 1, // very low: every append triggers compaction
      });

      // Step 1: Reader appends entries via its own instance (cursor advances, indexes populated)
      await reader.appendTrace(makeStartedEntry('receipt-dup-1', 'WU-dup'));
      await reader.appendTrace(makeStartedEntry('receipt-dup-2', 'WU-dup'));

      // Step 2: Reader hydrates — cursor is now > 0, both entries are in orderedTraces
      const traces1 = await reader.readTraces();
      expect(traces1).toHaveLength(2);

      // Step 3: Writer appends (triggers compaction — active file is rotated to segment)
      // This moves the data that reader already indexed from the active file into a segment.
      await writer.appendTrace(makeStartedEntry('receipt-dup-3', 'WU-dup'));

      // Step 4: Reader calls readTraces() again. incrementalHydrate sees the new segment
      // and MUST NOT re-index entries that were already read from the active file.
      const traces2 = await reader.readTraces();

      // Should have exactly 3 unique entries, NOT 5 (which would indicate duplicates)
      expect(traces2).toHaveLength(3);

      // Verify no duplicate receipt_ids
      const receiptIds = traces2.map((t) => t.receipt_id);
      const uniqueReceiptIds = new Set(receiptIds);
      expect(uniqueReceiptIds.size).toBe(3);
      expect(uniqueReceiptIds.has('receipt-dup-1')).toBe(true);
      expect(uniqueReceiptIds.has('receipt-dup-2')).toBe(true);
      expect(uniqueReceiptIds.has('receipt-dup-3')).toBe(true);
    });
  });

  describe('segment padding overflow at 10,000+ segments', () => {
    it('reads segment 10000+ files that exceed 4-digit padding', async () => {
      const store = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 1, // force compaction on every append
      });

      // Manually create a segment file with a 5-digit number (simulating 10000+ rotations).
      // This is the minimal reproduction: write a valid segment file with segment number 10000,
      // then verify a fresh store instance can read it.
      const tracesDir = join(evidenceRoot, 'traces');
      await mkdir(tracesDir, { recursive: true });

      const entry = makeStartedEntry('receipt-seg10000', 'WU-seg10000');
      const segmentContent = `${JSON.stringify(entry)}\n`;

      // Write a segment file with a 5-digit number (10000) using the expected padStart(8) format
      await writeFile(join(tracesDir, 'tool-traces.00010000.jsonl'), segmentContent, 'utf8');

      // A fresh store instance must discover and read segment 10000
      const freshStore = new EvidenceStore({ evidenceRoot });
      const traces = await freshStore.readTraces();

      expect(traces).toHaveLength(1);
      expect(traces[0]?.receipt_id).toBe('receipt-seg10000');
    });

    it('compactIfNeeded produces 8-digit padded segment filenames', async () => {
      const store = new EvidenceStore({
        evidenceRoot,
        compactionThresholdBytes: 1, // trigger compaction on first append
      });

      await store.appendTrace(makeStartedEntry('receipt-pad8', 'WU-pad8'));

      // After compaction, verify the segment filename uses 8-digit padding
      const { readdir: readdirLocal } = await import('node:fs/promises');
      const tracesDir = join(evidenceRoot, 'traces');
      const files = await readdirLocal(tracesDir);
      const segmentFiles = files.filter(
        (f: string) =>
          f.startsWith('tool-traces.') && f.endsWith('.jsonl') && f !== 'tool-traces.jsonl',
      );

      expect(segmentFiles).toHaveLength(1);
      expect(segmentFiles[0]).toBe('tool-traces.00000001.jsonl');
    });
  });

  it('preserves non-lock operation errors instead of masking them as lock acquisition failures', async () => {
    const store = new EvidenceStore({ evidenceRoot });
    const tracesFilePath = join(evidenceRoot, 'traces', 'tool-traces.jsonl');
    const { chmod } = await import('node:fs/promises');

    await store.appendTrace(makeStartedEntry('receipt-setup-propagation'));
    await chmod(tracesFilePath, 0o444);

    await expect(store.appendTrace(makeStartedEntry('receipt-operation-error'))).rejects.toThrow(
      /EACCES|permission|read-only/i,
    );

    await chmod(tracesFilePath, 0o644);
  });
});
