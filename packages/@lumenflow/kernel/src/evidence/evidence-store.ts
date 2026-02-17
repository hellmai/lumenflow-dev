// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalStringify } from '../canonical-json.js';
import { TOOL_TRACE_KINDS } from '../event-kinds.js';
import {
  ToolTraceEntrySchema,
  type PolicyDecision,
  type ToolTraceEntry,
} from '../kernel.schemas.js';
import { SHA256_ALGORITHM, UTF8_ENCODING } from '../shared-constants.js';

const DEFAULT_LOCK_RETRY_DELAY_MS = 20;
const DEFAULT_LOCK_MAX_RETRIES = 250;

export interface EvidenceStoreOptions {
  evidenceRoot: string;
  lockRetryDelayMs?: number;
  lockMaxRetries?: number;
}

export interface PersistInputResult {
  inputHash: string;
  inputRef: string;
}

function sha256Hex(content: string): string {
  return createHash(SHA256_ALGORITHM).update(content).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class EvidenceStore {
  private readonly tracesDir: string;
  private readonly tracesFilePath: string;
  private readonly tracesLockFilePath: string;
  private readonly inputsDir: string;
  private readonly lockRetryDelayMs: number;
  private readonly lockMaxRetries: number;
  private tracesHydrated = false;
  private orderedTraces: ToolTraceEntry[] = [];
  private tracesByTaskId = new Map<string, ToolTraceEntry[]>();
  private taskIdByReceiptId = new Map<string, string>();

  constructor(options: EvidenceStoreOptions) {
    this.tracesDir = join(options.evidenceRoot, 'traces');
    this.tracesFilePath = join(this.tracesDir, 'tool-traces.jsonl');
    this.tracesLockFilePath = join(this.tracesDir, 'tool-traces.lock');
    this.inputsDir = join(options.evidenceRoot, 'inputs');
    this.lockRetryDelayMs = options.lockRetryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
    this.lockMaxRetries = options.lockMaxRetries ?? DEFAULT_LOCK_MAX_RETRIES;
  }

  async appendTrace(entry: ToolTraceEntry): Promise<void> {
    const validated = ToolTraceEntrySchema.parse(entry);
    await this.withFileLock(async () => {
      await mkdir(this.tracesDir, { recursive: true });
      await appendFile(this.tracesFilePath, `${JSON.stringify(validated)}\n`, UTF8_ENCODING);
    });

    if (this.tracesHydrated) {
      this.applyTraceToIndexes(validated);
    }
  }

  async readTraces(): Promise<ToolTraceEntry[]> {
    await this.hydrateIndexesIfNeeded();
    return [...this.orderedTraces];
  }

  async readTracesByTaskId(taskId: string): Promise<ToolTraceEntry[]> {
    await this.hydrateIndexesIfNeeded();
    return [...(this.tracesByTaskId.get(taskId) ?? [])];
  }

  async pruneTask(taskId: string): Promise<number> {
    await this.hydrateIndexesIfNeeded();

    const receiptIdsToDelete: string[] = [];
    for (const [receiptId, indexedTaskId] of this.taskIdByReceiptId.entries()) {
      if (indexedTaskId === taskId) {
        receiptIdsToDelete.push(receiptId);
      }
    }

    for (const receiptId of receiptIdsToDelete) {
      this.taskIdByReceiptId.delete(receiptId);
    }
    this.tracesByTaskId.delete(taskId);

    return receiptIdsToDelete.length;
  }

  async getReceiptIndexSize(): Promise<number> {
    await this.hydrateIndexesIfNeeded();
    return this.taskIdByReceiptId.size;
  }

  private async hydrateIndexesIfNeeded(): Promise<void> {
    if (this.tracesHydrated) {
      return;
    }

    let content: string;
    try {
      content = await readFile(this.tracesFilePath, UTF8_ENCODING);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        this.resetIndexes();
        this.tracesHydrated = true;
        return;
      }
      throw error;
    }

    this.resetIndexes();
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }
      const parsed: unknown = (() => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(`Malformed evidence trace JSON at line ${index + 1}`, { cause: error });
        }
      })();
      this.applyTraceToIndexes(ToolTraceEntrySchema.parse(parsed));
    }
    this.tracesHydrated = true;
  }

  private resetIndexes(): void {
    this.orderedTraces = [];
    this.tracesByTaskId = new Map<string, ToolTraceEntry[]>();
    this.taskIdByReceiptId = new Map<string, string>();
  }

  private applyTraceToIndexes(entry: ToolTraceEntry): void {
    this.orderedTraces.push(entry);

    if (entry.kind === TOOL_TRACE_KINDS.TOOL_CALL_STARTED) {
      this.taskIdByReceiptId.set(entry.receipt_id, entry.task_id);
      const bucket = this.tracesByTaskId.get(entry.task_id) ?? [];
      bucket.push(entry);
      this.tracesByTaskId.set(entry.task_id, bucket);
      return;
    }

    const taskId = this.taskIdByReceiptId.get(entry.receipt_id);
    if (!taskId) {
      return;
    }

    const bucket = this.tracesByTaskId.get(taskId) ?? [];
    bucket.push(entry);
    this.tracesByTaskId.set(taskId, bucket);
  }

  async persistInput(input: unknown): Promise<PersistInputResult> {
    const serialized = canonicalStringify(input);
    const inputHash = sha256Hex(serialized);
    const inputRef = join(this.inputsDir, inputHash);
    await mkdir(this.inputsDir, { recursive: true });

    try {
      const handle = await open(inputRef, 'wx');
      try {
        await handle.writeFile(serialized, UTF8_ENCODING);
      } finally {
        await handle.close();
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST') {
        throw error;
      }
    }

    return {
      inputHash,
      inputRef,
    };
  }

  async reconcileOrphanedStarts(): Promise<number> {
    const traces = await this.readTraces();
    const started = new Map<string, ToolTraceEntry>();
    const finished = new Set<string>();

    for (const trace of traces) {
      if (trace.kind === TOOL_TRACE_KINDS.TOOL_CALL_STARTED) {
        started.set(trace.receipt_id, trace);
      } else {
        finished.add(trace.receipt_id);
      }
    }

    let reconciled = 0;
    for (const [receiptId] of started) {
      if (finished.has(receiptId)) {
        continue;
      }
      const policyDecisions: PolicyDecision[] = [
        {
          policy_id: 'kernel.reconciliation',
          decision: 'deny',
          reason: 'Orphaned started trace without matching finished trace',
        },
      ];
      await this.appendTrace({
        schema_version: 1,
        kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
        receipt_id: receiptId,
        timestamp: new Date().toISOString(),
        result: 'crashed',
        duration_ms: 0,
        scope_enforcement_note: 'Synthetic crashed finish generated by orphan reconciliation.',
        policy_decisions: policyDecisions,
        artifacts_written: [],
      });
      reconciled += 1;
    }

    return reconciled;
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.tracesDir, { recursive: true });

    for (let attempt = 0; attempt <= this.lockMaxRetries; attempt += 1) {
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        handle = await open(this.tracesLockFilePath, 'wx');
        const result = await operation();
        await handle.close();
        await rm(this.tracesLockFilePath, { force: true });
        return result;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (handle) {
          await handle.close();
        }
        if (nodeError.code === 'EEXIST' && attempt < this.lockMaxRetries) {
          await sleep(this.lockRetryDelayMs);
          continue;
        }
        break;
      }
    }

    throw new Error(`Failed to acquire evidence-store lock at ${this.tracesLockFilePath}`);
  }
}
