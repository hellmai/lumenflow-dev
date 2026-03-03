// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearChannelTransports,
  getChannelTransport,
  registerChannelTransport,
  type ChannelTransport,
} from '../tool-impl/channel-transports.js';
import {
  type AuditEvent,
  type StoragePort,
  FsStoragePort,
  getStoragePort,
  runWithStoragePort,
  setDefaultStoragePort,
} from '../tool-impl/storage.js';

const TEST_ROOT = path.join(import.meta.dirname ?? __dirname, '.tmp-storage-test');

function makeTestPort(): FsStoragePort {
  return new FsStoragePort(TEST_ROOT);
}

function makeAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt-test-001',
    ts: new Date().toISOString(),
    tool: 'test-tool',
    op: 'create',
    ...overrides,
  };
}

function makeChannelTransport(provider: string): ChannelTransport {
  return {
    provider,
    async send() {
      return { success: true };
    },
    async receive() {
      return { success: true, records: [] };
    },
  };
}

describe('StoragePort interface', () => {
  let port: FsStoragePort;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    port = makeTestPort();
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // AC1: StoragePort interface is defined in sidekick tool-impl storage module
  it('FsStoragePort implements StoragePort interface', () => {
    const sp: StoragePort = port;
    expect(typeof sp.getRootDir).toBe('function');
    expect(typeof sp.withLock).toBe('function');
    expect(typeof sp.readStore).toBe('function');
    expect(typeof sp.writeStore).toBe('function');
    expect(typeof sp.appendAudit).toBe('function');
    expect(typeof sp.readAuditEvents).toBe('function');
  });

  it('getRootDir returns configured root', () => {
    expect(port.getRootDir()).toBe(TEST_ROOT);
  });
});

describe('FsStoragePort read/write', () => {
  let port: FsStoragePort;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    port = makeTestPort();
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // AC2: FsStoragePort implements read/write operations
  it('readStore returns empty array for missing store', async () => {
    const tasks = await port.readStore('tasks');
    expect(tasks).toEqual([]);
  });

  it('writeStore then readStore round-trips data', async () => {
    const taskData = [
      {
        id: 'task-1',
        title: 'Test task',
        priority: 'P1' as const,
        status: 'pending' as const,
        tags: ['test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    await port.writeStore('tasks', taskData);
    const result = await port.readStore('tasks');
    expect(result).toEqual(taskData);
  });

  it('readStore returns independent copies (no shared references)', async () => {
    const data = [
      {
        id: 'mem-1',
        type: 'fact' as const,
        content: 'test',
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    await port.writeStore('memories', data);
    const a = await port.readStore('memories');
    const b = await port.readStore('memories');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('writeStore performs atomic writes (no partial files)', async () => {
    await port.writeStore('tasks', []);
    const storePath = path.join(TEST_ROOT, 'tasks', 'tasks.json');
    const content = await readFile(storePath, 'utf8');
    // Should be valid JSON
    expect(() => JSON.parse(content)).not.toThrow();
  });
});

describe('FsStoragePort lock', () => {
  let port: FsStoragePort;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    port = makeTestPort();
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // AC2: FsStoragePort implements lock operations
  it('withLock executes the callback and returns result', async () => {
    const result = await port.withLock(async () => 'locked-value');
    expect(result).toBe('locked-value');
  });

  it('withLock serializes concurrent calls', async () => {
    const order: number[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const p1 = port.withLock(async () => {
      order.push(1);
      await delay(50);
      order.push(2);
    });

    const p2 = port.withLock(async () => {
      order.push(3);
      await delay(10);
      order.push(4);
    });

    await Promise.all([p1, p2]);
    // Lock serializes: first lock fully completes before second starts
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('withLock releases lock on error', async () => {
    await expect(
      port.withLock(async () => {
        throw new Error('test-error');
      }),
    ).rejects.toThrow('test-error');

    // Should be able to acquire lock again
    const result = await port.withLock(async () => 'recovered');
    expect(result).toBe('recovered');
  });
});

describe('FsStoragePort audit', () => {
  let port: FsStoragePort;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    port = makeTestPort();
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // AC2: FsStoragePort implements audit operations
  it('appendAudit writes event to audit log', async () => {
    const event = makeAuditEvent();
    await port.appendAudit(event);
    const events = await port.readAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('appendAudit appends (does not overwrite)', async () => {
    const event1 = makeAuditEvent({ id: 'evt-1' });
    const event2 = makeAuditEvent({ id: 'evt-2' });
    await port.appendAudit(event1);
    await port.appendAudit(event2);
    const events = await port.readAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.id).toBe('evt-1');
    expect(events[1]?.id).toBe('evt-2');
  });

  it('readAuditEvents returns empty array when no audit file exists', async () => {
    const events = await port.readAuditEvents();
    expect(events).toEqual([]);
  });

  it('readAuditEvents skips malformed lines', async () => {
    const auditPath = path.join(TEST_ROOT, 'audit', 'events.jsonl');
    await mkdir(path.dirname(auditPath), { recursive: true });
    const validEvent = makeAuditEvent({ id: 'evt-valid' });
    await writeFile(auditPath, `${JSON.stringify(validEvent)}\nBAD LINE\n`, 'utf8');
    const events = await port.readAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('evt-valid');
  });
});

describe('FsStoragePort concurrent write and audit', () => {
  let port: FsStoragePort;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    port = makeTestPort();
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // AC4: Concurrent write and audit tests pass
  it('concurrent writes under lock produce consistent state', async () => {
    const WRITE_COUNT = 10;
    const promises = Array.from({ length: WRITE_COUNT }, (_, i) =>
      port.withLock(async () => {
        const tasks = await port.readStore('tasks');
        tasks.push({
          id: `task-${i}`,
          title: `Task ${i}`,
          priority: 'P2' as const,
          status: 'pending' as const,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        await port.writeStore('tasks', tasks);
      }),
    );
    await Promise.all(promises);

    const finalTasks = await port.readStore('tasks');
    expect(finalTasks).toHaveLength(WRITE_COUNT);
  });

  it('concurrent audit appends all produce entries', async () => {
    const APPEND_COUNT = 20;
    const promises = Array.from({ length: APPEND_COUNT }, (_, i) =>
      port.appendAudit(makeAuditEvent({ id: `evt-${i}` })),
    );
    await Promise.all(promises);

    const events = await port.readAuditEvents();
    expect(events).toHaveLength(APPEND_COUNT);
    const ids = events.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(APPEND_COUNT);
  });
});

describe('Injection helpers', () => {
  let originalPort: StoragePort;

  beforeEach(() => {
    originalPort = getStoragePort();
  });

  afterEach(() => {
    setDefaultStoragePort(originalPort);
  });

  // AC3: Injection helpers exist
  it('getStoragePort returns default FsStoragePort', () => {
    const port = getStoragePort();
    expect(port).toBeDefined();
    expect(typeof port.readStore).toBe('function');
  });

  it('setDefaultStoragePort overrides the global default', () => {
    const customPort = makeTestPort();
    setDefaultStoragePort(customPort);
    expect(getStoragePort()).toBe(customPort);
  });

  it('runWithStoragePort scopes port to callback via AsyncLocalStorage', async () => {
    const scopedPort = makeTestPort();
    const defaultPort = getStoragePort();

    await runWithStoragePort(scopedPort, async () => {
      expect(getStoragePort()).toBe(scopedPort);
    });

    // Outside the callback, should be back to default
    expect(getStoragePort()).toBe(defaultPort);
  });

  it('runWithStoragePort supports nested scoping', async () => {
    const outerPort = makeTestPort();
    const innerPort = new FsStoragePort(path.join(TEST_ROOT, 'inner'));

    await runWithStoragePort(outerPort, async () => {
      expect(getStoragePort()).toBe(outerPort);

      await runWithStoragePort(innerPort, async () => {
        expect(getStoragePort()).toBe(innerPort);
      });

      expect(getStoragePort()).toBe(outerPort);
    });
  });

  it('channel transport registry is scoped to runWithStoragePort context', async () => {
    const scopedPort = makeTestPort();
    const transport = makeChannelTransport('slack');

    expect(getChannelTransport('slack')).toBeUndefined();

    await runWithStoragePort(scopedPort, async () => {
      registerChannelTransport(transport);
      expect(getChannelTransport('slack')).toBe(transport);
    });

    expect(getChannelTransport('slack')).toBeUndefined();
  });

  it('clearChannelTransports resets registry within active context', async () => {
    await runWithStoragePort(makeTestPort(), async () => {
      registerChannelTransport(makeChannelTransport('discord'));
      expect(getChannelTransport('discord')).toBeDefined();
      clearChannelTransports();
      expect(getChannelTransport('discord')).toBeUndefined();
    });
  });

  it('registerChannelTransport rejects usage outside runtime context', () => {
    expect(() => registerChannelTransport(makeChannelTransport('telegram'))).toThrow(
      'channel transport registry is unavailable outside sidekick runtime context.',
    );
  });
});
