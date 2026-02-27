// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { getStoragePort, type TaskPriority, type TaskRecord } from './storage.js';
import {
  asInteger,
  asNonEmptyString,
  asStringArray,
  buildAuditEvent,
  createId,
  failure,
  isDryRun,
  matchesTags,
  nowIso,
  success,
  toRecord,
  type ToolContextLike,
  type ToolOutput,
} from './shared.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOL_NAMES = {
  CREATE: 'task:create',
  LIST: 'task:list',
  COMPLETE: 'task:complete',
  SCHEDULE: 'task:schedule',
} as const;

const VALID_PRIORITIES: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
const DEFAULT_PRIORITY: TaskPriority = 'P2';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asPriority(value: unknown): TaskPriority {
  return VALID_PRIORITIES.includes(value as TaskPriority)
    ? (value as TaskPriority)
    : DEFAULT_PRIORITY;
}

// ---------------------------------------------------------------------------
// task:create
// ---------------------------------------------------------------------------

async function taskCreateTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const title = asNonEmptyString(parsed.title);

  if (!title) {
    return failure('INVALID_INPUT', 'title is required.');
  }

  const task: TaskRecord = {
    id: createId('task'),
    title,
    description: asNonEmptyString(parsed.description) ?? undefined,
    priority: asPriority(parsed.priority),
    status: 'pending',
    tags: asStringArray(parsed.tags),
    due_at: asNonEmptyString(parsed.due_at) ?? undefined,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  if (isDryRun(parsed)) {
    return success({ dry_run: true, task: task as unknown as Record<string, unknown> });
  }

  const storage = getStoragePort();
  await storage.withLock(async () => {
    const tasks = await storage.readStore('tasks');
    tasks.push(task);
    await storage.writeStore('tasks', tasks);
    await storage.appendAudit(
      buildAuditEvent({
        tool: TOOL_NAMES.CREATE,
        op: 'create',
        context,
        ids: [task.id],
      }),
    );
  });

  return success({ task: task as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// task:list
// ---------------------------------------------------------------------------

async function taskListTool(input: unknown, _context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const statusFilter = asNonEmptyString(parsed.status);
  const priorityFilter = asNonEmptyString(parsed.priority);
  const tags = asStringArray(parsed.tags);
  const dueBefore = asNonEmptyString(parsed.due_before);
  const limit = asInteger(parsed.limit);

  const storage = getStoragePort();
  const tasks = await storage.readStore('tasks');

  const filtered = tasks.filter((task) => {
    if (statusFilter && task.status !== statusFilter) {
      return false;
    }
    if (priorityFilter && task.priority !== priorityFilter) {
      return false;
    }
    if (!matchesTags(tags, task.tags)) {
      return false;
    }
    if (dueBefore && task.due_at) {
      if (Date.parse(task.due_at) >= Date.parse(dueBefore)) {
        return false;
      }
    }
    if (dueBefore && !task.due_at) {
      return false;
    }
    return true;
  });

  const sorted = filtered.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  const items = limit && limit > 0 ? sorted.slice(0, limit) : sorted;

  return success({
    items: items as unknown as Record<string, unknown>,
    count: items.length,
  });
}

// ---------------------------------------------------------------------------
// task:complete
// ---------------------------------------------------------------------------

async function taskCompleteTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = asNonEmptyString(parsed.id);

  if (!id) {
    return failure('INVALID_INPUT', 'id is required.');
  }

  const storage = getStoragePort();
  const tasks = await storage.readStore('tasks');
  const task = tasks.find((t) => t.id === id);

  if (!task) {
    return failure('NOT_FOUND', `task ${id} was not found.`);
  }

  if (isDryRun(parsed)) {
    const preview = { ...task, status: 'done' as const, completed_at: nowIso() };
    return success({
      dry_run: true,
      task: preview as unknown as Record<string, unknown>,
    });
  }

  await storage.withLock(async () => {
    const latest = await storage.readStore('tasks');
    const target = latest.find((t) => t.id === id);
    if (target) {
      target.status = 'done';
      target.completed_at = nowIso();
      target.updated_at = nowIso();
      if (parsed.note) {
        target.note = asNonEmptyString(parsed.note) ?? undefined;
      }
      await storage.writeStore('tasks', latest);
      await storage.appendAudit(
        buildAuditEvent({
          tool: TOOL_NAMES.COMPLETE,
          op: 'update',
          context,
          ids: [id],
        }),
      );
    }
  });

  const updated = await storage.readStore('tasks');
  const completedTask = updated.find((t) => t.id === id);

  return success({ task: completedTask as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// task:schedule
// ---------------------------------------------------------------------------

async function taskScheduleTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = asNonEmptyString(parsed.id);

  if (!id) {
    return failure('INVALID_INPUT', 'id is required.');
  }

  const storage = getStoragePort();
  const tasks = await storage.readStore('tasks');
  const task = tasks.find((t) => t.id === id);

  if (!task) {
    return failure('NOT_FOUND', `task ${id} was not found.`);
  }

  const dueAt = asNonEmptyString(parsed.due_at);
  const cron = asNonEmptyString(parsed.cron);

  if (isDryRun(parsed)) {
    const preview = {
      ...task,
      ...(dueAt ? { due_at: dueAt } : {}),
      ...(cron ? { cron } : {}),
    };
    return success({
      dry_run: true,
      task: preview as unknown as Record<string, unknown>,
    });
  }

  await storage.withLock(async () => {
    const latest = await storage.readStore('tasks');
    const target = latest.find((t) => t.id === id);
    if (target) {
      if (dueAt) {
        target.due_at = dueAt;
      }
      // cron is stored but TaskRecord doesn't have it yet -- extend inline
      if (cron) {
        (target as unknown as Record<string, unknown>).cron = cron;
      }
      target.updated_at = nowIso();
      await storage.writeStore('tasks', latest);
      await storage.appendAudit(
        buildAuditEvent({
          tool: TOOL_NAMES.SCHEDULE,
          op: 'update',
          context,
          ids: [id],
        }),
      );
    }
  });

  const updated = await storage.readStore('tasks');
  const scheduledTask = updated.find((t) => t.id === id);

  return success({ task: scheduledTask as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// Router (default export)
// ---------------------------------------------------------------------------

export default async function taskTools(
  input: unknown,
  context?: ToolContextLike,
): Promise<ToolOutput> {
  switch (context?.tool_name) {
    case TOOL_NAMES.CREATE:
      return taskCreateTool(input, context);
    case TOOL_NAMES.LIST:
      return taskListTool(input, context);
    case TOOL_NAMES.COMPLETE:
      return taskCompleteTool(input, context);
    case TOOL_NAMES.SCHEDULE:
      return taskScheduleTool(input, context);
    default:
      return failure('UNKNOWN_TOOL', `Unknown task tool: ${context?.tool_name ?? 'unknown'}`);
  }
}
