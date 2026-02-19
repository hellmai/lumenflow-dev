// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { appendFile, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalStringify } from '../canonical-json.js';
import { TOOL_TRACE_KINDS } from '../event-kinds.js';
import {
  ToolTraceEntrySchema,
  type PolicyDecision,
  type ToolTraceEntry,
} from '../kernel.schemas.js';
import { KERNEL_POLICY_IDS, SHA256_ALGORITHM, UTF8_ENCODING } from '../shared-constants.js';
import { readFileOrEmpty, statOrNull } from './fs-helpers.js';

const DEFAULT_LOCK_RETRY_DELAY_MS = 20;
const DEFAULT_LOCK_MAX_RETRIES = 250;
const DEFAULT_COMPACTION_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MiB
const ACTIVE_TRACE_FILE_NAME = 'tool-traces.jsonl';
const SEGMENT_FILE_PATTERN = /^tool-traces\.(\d+)\.jsonl$/;

export interface EvidenceStoreOptions {
  evidenceRoot: string;
  lockRetryDelayMs?: number;
  lockMaxRetries?: number;
  /** Byte size threshold for the active JSONL file before rotation. Default: 10 MiB. */
  compactionThresholdBytes?: number;
}

export interface PersistDataResult {
  dataHash: string;
  dataRef: string;
}

/** @deprecated Use PersistDataResult instead */
export type PersistInputResult = PersistDataResult;

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
  private readonly compactionThresholdBytes: number;
  private tracesHydrated = false;
  private orderedTraces: ToolTraceEntry[] = [];
  private tracesByTaskId = new Map<string, ToolTraceEntry[]>();
  private taskIdByReceiptId = new Map<string, string>();
  /** Dedup guard: tracks `receipt_id:kind` keys already indexed (WU-1881). */
  private seenTraceKeys = new Set<string>();

  /** Byte offset cursor into the active trace file for incremental reads. */
  private activeFileCursor = 0;
  /** Number of compacted segment files at last hydration. */
  private hydratedSegmentCount = 0;

  constructor(options: EvidenceStoreOptions) {
    this.tracesDir = join(options.evidenceRoot, 'traces');
    this.tracesFilePath = join(this.tracesDir, ACTIVE_TRACE_FILE_NAME);
    this.tracesLockFilePath = join(this.tracesDir, 'tool-traces.lock');
    this.inputsDir = join(options.evidenceRoot, 'inputs');
    this.lockRetryDelayMs = options.lockRetryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
    this.lockMaxRetries = options.lockMaxRetries ?? DEFAULT_LOCK_MAX_RETRIES;
    this.compactionThresholdBytes =
      options.compactionThresholdBytes ?? DEFAULT_COMPACTION_THRESHOLD_BYTES;
  }

  async appendTrace(entry: ToolTraceEntry): Promise<void> {
    const validated = ToolTraceEntrySchema.parse(entry);
    let compacted = false;
    await this.withFileLock(async () => {
      await mkdir(this.tracesDir, { recursive: true });
      const serialized = `${JSON.stringify(validated)}\n`;
      await appendFile(this.tracesFilePath, serialized, UTF8_ENCODING);
      compacted = await this.compactIfNeeded();
    });

    if (this.tracesHydrated) {
      this.applyTraceToIndexes(validated);
      if (compacted) {
        // The active file was rotated; cursor resets to 0 because the new
        // active file is now empty (or will be created fresh on next append).
        this.hydratedSegmentCount += 1;
        this.activeFileCursor = 0;
      } else {
        // Advance cursor past the bytes we just wrote so incremental hydrate
        // does not re-read them.
        const fileStat = await statOrNull(this.tracesFilePath);
        this.activeFileCursor = fileStat?.size ?? 0;
      }
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
    if (!this.tracesHydrated) {
      return this.fullHydrate();
    }

    // Incremental: check for new segments and new bytes in active file
    await this.incrementalHydrate();
  }

  /**
   * Full hydration: reads all segment files (sorted ascending) then the active file.
   * Sets cursor to end of active file for subsequent incremental reads.
   */
  private async fullHydrate(): Promise<void> {
    this.resetIndexes();

    const dirStat = await statOrNull(this.tracesDir);
    if (!dirStat) {
      this.tracesHydrated = true;
      this.activeFileCursor = 0;
      this.hydratedSegmentCount = 0;
      return;
    }

    // Read compacted segments in order
    const segments = await this.listSegmentFiles();
    for (const segmentFile of segments) {
      const segmentPath = join(this.tracesDir, segmentFile);
      await this.hydrateFromFile(segmentPath);
    }
    this.hydratedSegmentCount = segments.length;

    // Read active file
    const activeContent = await readFileOrEmpty(this.tracesFilePath);

    if (activeContent.length > 0) {
      this.parseAndApplyLines(activeContent);
    }
    this.activeFileCursor = Buffer.byteLength(activeContent, UTF8_ENCODING);
    this.tracesHydrated = true;
  }

  /**
   * Incremental hydration: only reads new segments (from compaction since last
   * hydration) and new bytes appended to the active file since the cursor.
   * This provides O(1) amortized reads for the hot path.
   */
  private async incrementalHydrate(): Promise<void> {
    // Check if compaction created new segments since last hydration
    const currentSegments = await this.listSegmentFiles();
    if (currentSegments.length > this.hydratedSegmentCount) {
      // Read unseen segments in order. This is required for multi-instance
      // writers where another process may rotate active traces into segments
      // that this instance has never indexed.
      const unseenSegments = currentSegments.slice(this.hydratedSegmentCount);
      for (const segmentFile of unseenSegments) {
        const segmentPath = join(this.tracesDir, segmentFile);
        await this.hydrateFromFile(segmentPath);
      }
      this.hydratedSegmentCount = currentSegments.length;

      // The active file was rotated, so the cursor resets.
      // Read whatever is now in the new active file from the start.
      this.activeFileCursor = 0;
    }

    // Read only new bytes from the active file
    const activeFileStat = await statOrNull(this.tracesFilePath);
    const activeSize = activeFileStat?.size ?? 0;

    if (activeSize <= this.activeFileCursor) {
      return; // No new data
    }

    // Read only the delta
    const handle = await open(this.tracesFilePath, 'r');
    try {
      const deltaSize = activeSize - this.activeFileCursor;
      const buffer = Buffer.alloc(deltaSize);
      await handle.read(buffer, 0, deltaSize, this.activeFileCursor);
      const deltaContent = buffer.toString(UTF8_ENCODING);
      if (deltaContent.trim().length > 0) {
        this.parseAndApplyLines(deltaContent);
      }
      this.activeFileCursor = activeSize;
    } finally {
      await handle.close();
    }
  }

  /**
   * Lists compacted segment files sorted in ascending order.
   * Segment files follow the pattern: tool-traces.NNNN.jsonl
   */
  private async listSegmentFiles(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.tracesDir);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    return files
      .filter((f) => SEGMENT_FILE_PATTERN.test(f))
      .sort((a, b) => {
        const matchA = a.match(SEGMENT_FILE_PATTERN);
        const matchB = b.match(SEGMENT_FILE_PATTERN);
        const numA = matchA ? parseInt(matchA[1] ?? '0', 10) : 0;
        const numB = matchB ? parseInt(matchB[1] ?? '0', 10) : 0;
        return numA - numB;
      });
  }

  /**
   * Reads an entire file and applies all trace lines to the indexes.
   */
  private async hydrateFromFile(filePath: string): Promise<void> {
    const content = await readFileOrEmpty(filePath);
    if (content.trim().length > 0) {
      this.parseAndApplyLines(content);
    }
  }

  /**
   * Parses newline-delimited JSON lines and applies each to the indexes.
   */
  private parseAndApplyLines(content: string): void {
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
  }

  /**
   * Rotates the active JSONL file to a numbered segment if it exceeds the
   * compaction threshold. Called within the file lock after each append.
   * @returns true if compaction (rotation) occurred.
   */
  private async compactIfNeeded(): Promise<boolean> {
    const fileStat = await statOrNull(this.tracesFilePath);
    if (!fileStat) {
      return false;
    }

    if (fileStat.size < this.compactionThresholdBytes) {
      return false;
    }

    // Determine the next segment number
    const segments = await this.listSegmentFiles();
    let nextNumber = 1;
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      if (lastSegment) {
        const match = lastSegment.match(SEGMENT_FILE_PATTERN);
        if (match) {
          nextNumber = parseInt(match[1] ?? '0', 10) + 1;
        }
      }
    }

    const segmentName = `tool-traces.${String(nextNumber).padStart(8, '0')}.jsonl`;
    const segmentPath = join(this.tracesDir, segmentName);

    // Atomic rename: active file becomes the new segment
    await rename(this.tracesFilePath, segmentPath);
    return true;
  }

  private resetIndexes(): void {
    this.orderedTraces = [];
    this.tracesByTaskId = new Map<string, ToolTraceEntry[]>();
    this.taskIdByReceiptId = new Map<string, string>();
    this.seenTraceKeys = new Set<string>();
  }

  private applyTraceToIndexes(entry: ToolTraceEntry): void {
    const traceKey = `${entry.receipt_id}:${entry.kind}`;
    if (this.seenTraceKeys.has(traceKey)) {
      return; // Dedup: already indexed (WU-1881)
    }
    this.seenTraceKeys.add(traceKey);

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

  async persistData(data: unknown): Promise<PersistDataResult> {
    const serialized = canonicalStringify(data);
    const dataHash = sha256Hex(serialized);
    const dataRef = join(this.inputsDir, dataHash);
    await mkdir(this.inputsDir, { recursive: true });

    try {
      const handle = await open(dataRef, 'wx');
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
      dataHash,
      dataRef,
    };
  }

  /** @deprecated Use persistData instead */
  async persistInput(input: unknown): Promise<PersistDataResult> {
    return this.persistData(input);
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
          policy_id: KERNEL_POLICY_IDS.RECONCILIATION,
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
          try {
            await handle.close();
          } catch {
            // Best-effort cleanup; preserve the original operation error.
          }
          try {
            await rm(this.tracesLockFilePath, { force: true });
          } catch {
            // Best-effort cleanup; preserve the original operation error.
          }
        }

        if (nodeError.code === 'EEXIST') {
          if (attempt < this.lockMaxRetries) {
            await sleep(this.lockRetryDelayMs);
            continue;
          }
          break;
        }

        // Non-lock failures from the operation itself must surface directly.
        throw error;
      }
    }

    throw new Error(`Failed to acquire evidence-store lock at ${this.tracesLockFilePath}`);
  }
}
