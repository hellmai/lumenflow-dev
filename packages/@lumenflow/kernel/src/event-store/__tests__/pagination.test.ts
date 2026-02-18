// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { KernelEvent, TaskSpec } from '../../kernel.schemas.js';
import { canonical_json } from '../../canonical-json.js';
import { EventStore } from '../index.js';

describe('event-store pagination', () => {
  let tempDir: string;
  let eventsFilePath: string;
  let lockFilePath: string;

  const taskId = 'WU-1870';
  const baseTimestamp = '2026-02-18T10:00:00.000Z';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-pagination-'));
    eventsFilePath = join(tempDir, 'events.jsonl');
    lockFilePath = join(tempDir, 'events.lock');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeTaskSpec(): TaskSpec {
    return {
      id: taskId,
      workspace_id: 'workspace-default',
      lane_id: 'framework-core-lifecycle',
      domain: 'software-delivery',
      title: 'Pagination test task',
      description: 'Test task for cursor-based pagination.',
      acceptance: ['Pagination works'],
      declared_scopes: [],
      risk: 'low',
      type: 'feature',
      priority: 'P1',
      created: '2026-02-18',
    };
  }

  function makeCreatedEvent(specHash: string, timestamp = baseTimestamp): KernelEvent {
    return {
      schema_version: 1,
      kind: 'task_created',
      task_id: taskId,
      timestamp,
      spec_hash: specHash,
    };
  }

  function makeTimestamp(secondsOffset: number): string {
    const date = new Date(Date.parse(baseTimestamp) + secondsOffset * 1000);
    return date.toISOString();
  }

  async function seedEvents(store: EventStore, count: number): Promise<KernelEvent[]> {
    const spec = makeTaskSpec();
    const created = makeCreatedEvent(canonical_json(spec));
    await store.append(created);

    const events: KernelEvent[] = [created];
    for (let i = 1; i <= count; i++) {
      const event: KernelEvent = {
        schema_version: 1,
        kind: i % 2 === 0 ? 'task_waiting' : 'task_resumed',
        task_id: taskId,
        timestamp: makeTimestamp(i),
        ...(i % 2 === 0 ? { reason: `wait-${i}` } : {}),
      };
      await store.append(event);
      events.push(event);
    }
    return events;
  }

  describe('ReplayFilter.limit', () => {
    it('returns at most limit events when limit is specified', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 10);

      const result = await store.replay({ limit: 5 });
      expect(result.events).toHaveLength(5);
    });

    it('defaults to 100 when limit is omitted', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 150);

      const result = await store.replay({});
      expect(result.events).toHaveLength(100);
    });

    it('clamps limit to max 500', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 10);

      // Requesting limit > 500 should be clamped to 500
      const result = await store.replay({ limit: 1000 });
      // With only 11 events total, all should be returned
      expect(result.events).toHaveLength(11);
    });

    it('returns all events when fewer than limit exist', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 3);

      const result = await store.replay({ limit: 100 });
      expect(result.events).toHaveLength(4); // 1 created + 3 seeded
    });
  });

  describe('ReplayFilter.cursor', () => {
    it('returns only events after cursor timestamp (exclusive lower bound)', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      const events = await seedEvents(store, 5);

      // Use timestamp of 3rd event as cursor (index 2)
      const cursor = events[2]!.timestamp;
      const result = await store.replay({ cursor, limit: 100 });

      // Should exclude events at or before cursor timestamp
      for (const event of result.events) {
        expect(Date.parse(event.timestamp)).toBeGreaterThan(Date.parse(cursor));
      }
      expect(result.events).toHaveLength(3); // events at index 3, 4, 5
    });

    it('returns empty events array when cursor is after all events', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 3);

      const futureCursor = '2099-12-31T23:59:59.999Z';
      const result = await store.replay({ cursor: futureCursor, limit: 100 });

      expect(result.events).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('nextCursor', () => {
    it('returns nextCursor as timestamp of last event when more events remain', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      const events = await seedEvents(store, 10);

      const result = await store.replay({ limit: 5 });
      expect(result.nextCursor).toBe(result.events[result.events.length - 1]!.timestamp);
      expect(result.nextCursor).not.toBeNull();
    });

    it('returns null nextCursor when all matching events are returned', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 3);

      const result = await store.replay({ limit: 100 });
      expect(result.nextCursor).toBeNull();
    });

    it('returns null nextCursor when empty result', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });

      const result = await store.replay({ limit: 100 });
      expect(result.events).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('cursor + limit pagination walk', () => {
    it('iterating with cursor/limit retrieves all events without duplicates', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      const allEvents = await seedEvents(store, 10);

      const collected: KernelEvent[] = [];
      let cursor: string | undefined;
      const pageSize = 3;

      // Paginate through all events
      for (let page = 0; page < 10; page++) {
        const result = await store.replay({ cursor, limit: pageSize });
        collected.push(...result.events);

        if (result.nextCursor === null) {
          break;
        }
        cursor = result.nextCursor;
      }

      // All events collected, no duplicates
      expect(collected).toHaveLength(allEvents.length);
      const timestamps = collected.map((e) => e.timestamp);
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBe(timestamps.length);
    });
  });

  describe('backward compatibility', () => {
    it('omitting cursor and limit returns events up to default limit with response shape', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 5);

      const result = await store.replay();
      // Should return paginated response shape
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('nextCursor');
      expect(result.events).toHaveLength(6); // 1 created + 5 seeded
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('cursor + existing filters', () => {
    it('cursor and limit work alongside taskId filter', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 5);

      // Add events for a different task
      await store.append({
        schema_version: 1,
        kind: 'task_waiting',
        task_id: 'WU-OTHER',
        timestamp: makeTimestamp(3),
        reason: 'other task',
      });

      const result = await store.replay({ taskId, limit: 3 });
      expect(result.events).toHaveLength(3);
      for (const event of result.events) {
        expect((event as KernelEvent & { task_id: string }).task_id).toBe(taskId);
      }
    });

    it('cursor and limit work alongside kind filter', async () => {
      const store = new EventStore({ eventsFilePath, lockFilePath });
      await seedEvents(store, 10);

      const result = await store.replay({ kind: 'task_waiting', limit: 2 });
      expect(result.events).toHaveLength(2);
      for (const event of result.events) {
        expect(event.kind).toBe('task_waiting');
      }
    });
  });
});
