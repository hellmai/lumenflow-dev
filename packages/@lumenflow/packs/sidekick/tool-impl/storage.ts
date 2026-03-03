// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSidekickRuntimeContext, runWithSidekickRuntimeContext } from './runtime-context.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UTF8_ENCODING = 'utf8';
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INTERVAL_MS = 25;
const STALE_LOCK_MS = 30_000;
const RANDOM_BYTES_LENGTH = 4;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'pending' | 'done';
export type MemoryType = 'fact' | 'preference' | 'note';

export interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  due_at?: string;
  note?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ChannelRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ChannelMessageRecord {
  id: string;
  channel_id: string;
  sender: string;
  content: string;
  created_at: string;
}

export interface RoutineStepRecord {
  tool: string;
  input: Record<string, unknown>;
}

export interface RoutineRecord {
  id: string;
  name: string;
  steps: RoutineStepRecord[];
  created_at: string;
  updated_at: string;
}

export interface SidekickStores {
  tasks: TaskRecord[];
  memories: MemoryRecord[];
  channels: ChannelRecord[];
  messages: ChannelMessageRecord[];
  routines: RoutineRecord[];
}

export type StoreName = keyof SidekickStores;

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  ts: string;
  tool: string;
  op: 'create' | 'read' | 'update' | 'delete' | 'execute' | 'export';
  actor?: string;
  ids?: string[];
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// StoragePort (hexagonal port)
// ---------------------------------------------------------------------------

export interface StoragePort {
  getRootDir(): string;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  readStore<K extends StoreName>(store: K): Promise<SidekickStores[K]>;
  writeStore<K extends StoreName>(store: K, data: SidekickStores[K]): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  readAuditEvents(): Promise<AuditEvent[]>;
}

// ---------------------------------------------------------------------------
// File-path mapping
// ---------------------------------------------------------------------------

const STORE_FILE_PATHS: Record<StoreName, string> = {
  tasks: 'tasks/tasks.json',
  memories: 'memory/memories.json',
  channels: 'channels/channels.json',
  messages: 'channels/messages.json',
  routines: 'routines/routines.json',
};

const STORE_DEFAULTS: SidekickStores = {
  tasks: [],
  memories: [],
  channels: [],
  messages: [],
  routines: [],
};

const AUDIT_FILE_PATH = 'audit/events.jsonl';
const LOCK_FILE_PATH = '.lock';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloneStore<K extends StoreName>(store: K, value: SidekickStores[K]): SidekickStores[K] {
  if (Array.isArray(value)) {
    return value.map((entry) => ({ ...entry })) as SidekickStores[K];
  }
  return structuredClone(value) as SidekickStores[K];
}

function randomToken(): string {
  return randomBytes(RANDOM_BYTES_LENGTH).toString('hex');
}

function nowMs(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomToken()}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, UTF8_ENCODING);
  await rename(tmpPath, filePath);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, UTF8_ENCODING);
    return JSON.parse(raw) as T;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      await writeJsonAtomic(filePath, fallback);
      return fallback;
    }
    throw error;
  }
}

async function maybeRemoveStaleLock(lockPath: string): Promise<void> {
  try {
    const metadata = await stat(lockPath);
    const ageMs = nowMs() - metadata.mtimeMs;
    if (ageMs > STALE_LOCK_MS) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // Ignore races for lock cleanup.
  }
}

async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const deadline = nowMs() + DEFAULT_LOCK_TIMEOUT_MS;
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  while (nowMs() < deadline) {
    try {
      await ensureParentDir(lockPath);
      handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}:${nowMs()}`, UTF8_ENCODING);
      break;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST') {
        throw error;
      }
      await maybeRemoveStaleLock(lockPath);
      await sleep(LOCK_RETRY_INTERVAL_MS);
    }
  }

  if (!handle) {
    throw new Error(`Timed out waiting for sidekick storage lock at ${lockPath}.`);
  }

  try {
    return await fn();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

// ---------------------------------------------------------------------------
// FsStoragePort (filesystem adapter)
// ---------------------------------------------------------------------------

export class FsStoragePort implements StoragePort {
  private readonly rootDir: string;

  constructor(rootDir = path.resolve(process.cwd(), '.sidekick')) {
    this.rootDir = rootDir;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    return withFileLock(path.join(this.rootDir, LOCK_FILE_PATH), fn);
  }

  async readStore<K extends StoreName>(store: K): Promise<SidekickStores[K]> {
    const storePath = path.join(this.rootDir, STORE_FILE_PATHS[store]);
    const fallback = cloneStore(store, STORE_DEFAULTS[store]);
    const data = await readJsonFile(storePath, fallback);
    return cloneStore(store, data);
  }

  async writeStore<K extends StoreName>(store: K, data: SidekickStores[K]): Promise<void> {
    const storePath = path.join(this.rootDir, STORE_FILE_PATHS[store]);
    await writeJsonAtomic(storePath, data);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    const auditPath = path.join(this.rootDir, AUDIT_FILE_PATH);
    await ensureParentDir(auditPath);
    await appendFile(auditPath, `${JSON.stringify(event)}\n`, UTF8_ENCODING);
  }

  async readAuditEvents(): Promise<AuditEvent[]> {
    const auditPath = path.join(this.rootDir, AUDIT_FILE_PATH);
    let raw: string;
    try {
      raw = await readFile(auditPath, UTF8_ENCODING);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const events: AuditEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        events.push(JSON.parse(trimmed) as AuditEvent);
      } catch {
        // Skip malformed audit lines and keep the stream readable.
      }
    }
    return events;
  }
}

// ---------------------------------------------------------------------------
// Injection helpers (AsyncLocalStorage-based)
// ---------------------------------------------------------------------------

let defaultStoragePort: StoragePort = new FsStoragePort();

export function setDefaultStoragePort(port: StoragePort): void {
  defaultStoragePort = port;
}

export function getStoragePort(): StoragePort {
  return getSidekickRuntimeContext()?.storagePort ?? defaultStoragePort;
}

export async function runWithStoragePort<T>(port: StoragePort, fn: () => Promise<T>): Promise<T> {
  const existingContext = getSidekickRuntimeContext();
  return runWithSidekickRuntimeContext(
    {
      storagePort: port,
      channelTransports: existingContext?.channelTransports ?? new Map(),
    },
    fn,
  );
}
