// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { getStoragePort, type RoutineRecord, type RoutineStepRecord } from './storage.js';
import {
  asInteger,
  asNonEmptyString,
  buildAuditEvent,
  createId,
  failure,
  isDryRun,
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
  CREATE: 'routine:create',
  LIST: 'routine:list',
  RUN: 'routine:run',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSteps(value: unknown): RoutineStepRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: RoutineStepRecord[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const tool = asNonEmptyString(record.tool);
    if (!tool) {
      continue;
    }
    const input =
      record.input && typeof record.input === 'object' && !Array.isArray(record.input)
        ? (record.input as Record<string, unknown>)
        : {};

    steps.push({ tool, input });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// routine:create
// ---------------------------------------------------------------------------

async function routineCreateTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const name = asNonEmptyString(parsed.name);
  const steps = normalizeSteps(parsed.steps);

  if (!name) {
    return failure('INVALID_INPUT', 'name is required.');
  }
  if (steps.length === 0) {
    return failure('INVALID_INPUT', 'steps must include at least one tool step.');
  }

  const now = nowIso();
  const routine: RoutineRecord = {
    id: createId('routine'),
    name,
    steps,
    created_at: now,
    updated_at: now,
  };

  if (isDryRun(parsed)) {
    return success({
      dry_run: true,
      routine: routine as unknown as Record<string, unknown>,
    });
  }

  const storage = getStoragePort();
  await storage.withLock(async () => {
    const routines = await storage.readStore('routines');
    routines.push(routine);
    await storage.writeStore('routines', routines);
    await storage.appendAudit(
      buildAuditEvent({
        tool: TOOL_NAMES.CREATE,
        op: 'create',
        context,
        ids: [routine.id],
      }),
    );
  });

  return success({ routine: routine as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// routine:list
// ---------------------------------------------------------------------------

async function routineListTool(input: unknown, _context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const limit = asInteger(parsed.limit);

  const storage = getStoragePort();
  const routines = await storage.readStore('routines');

  const sorted = routines.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  const items = limit && limit > 0 ? sorted.slice(0, limit) : sorted;

  return success({
    items: items as unknown as Record<string, unknown>,
    count: items.length,
  });
}

// ---------------------------------------------------------------------------
// routine:run (PLAN-ONLY -- does NOT execute tool steps)
// ---------------------------------------------------------------------------

async function routineRunTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = asNonEmptyString(parsed.id);

  if (!id) {
    return failure('INVALID_INPUT', 'id is required.');
  }

  const storage = getStoragePort();
  const routines = await storage.readStore('routines');
  const routine = routines.find((r) => r.id === id);

  if (!routine) {
    return failure('NOT_FOUND', `routine ${id} was not found.`);
  }

  await storage.appendAudit(
    buildAuditEvent({
      tool: TOOL_NAMES.RUN,
      op: 'execute',
      context,
      ids: [id],
      details: { plan_only: true },
    }),
  );

  return success({
    routine_id: routine.id,
    name: routine.name,
    plan_only: true,
    plan: routine.steps.map((step, index) => ({
      index,
      tool: step.tool,
      input: step.input,
    })),
    governance: {
      dispatch_required: true,
      execution: 'No tool steps were executed by routine:run. This endpoint only returns a plan.',
    },
  });
}

// ---------------------------------------------------------------------------
// Router (default export)
// ---------------------------------------------------------------------------

export default async function routineTools(
  input: unknown,
  context?: ToolContextLike,
): Promise<ToolOutput> {
  switch (context?.tool_name) {
    case TOOL_NAMES.CREATE:
      return routineCreateTool(input, context);
    case TOOL_NAMES.LIST:
      return routineListTool(input, context);
    case TOOL_NAMES.RUN:
      return routineRunTool(input, context);
    default:
      return failure('UNKNOWN_TOOL', `Unknown routine tool: ${context?.tool_name ?? 'unknown'}`);
  }
}
