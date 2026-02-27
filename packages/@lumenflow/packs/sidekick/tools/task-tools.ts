// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  createToolDescriptor,
} from './types.js';

const SIDEKICK_READ_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/tasks/**',
  access: TOOL_SCOPE_ACCESS.READ,
} as const;

const SIDEKICK_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/tasks/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

const AUDIT_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/audit/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

export const taskCreateDescriptor = createToolDescriptor({
  name: 'task:create',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [SIDEKICK_READ_SCOPE, SIDEKICK_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: 'tool-impl/task-tools.ts',
  description: 'Create a new task with title, priority, due date, and tags.',
});

export const taskListDescriptor = createToolDescriptor({
  name: 'task:list',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [SIDEKICK_READ_SCOPE],
  entry: 'tool-impl/task-tools.ts',
  description: 'List tasks with optional filters: status, priority, tag, due_before.',
});

export const taskCompleteDescriptor = createToolDescriptor({
  name: 'task:complete',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [SIDEKICK_READ_SCOPE, SIDEKICK_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: 'tool-impl/task-tools.ts',
  description: 'Mark a task as complete. Supports dry_run.',
});

export const taskScheduleDescriptor = createToolDescriptor({
  name: 'task:schedule',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [SIDEKICK_READ_SCOPE, SIDEKICK_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: 'tool-impl/task-tools.ts',
  description: 'Set or update a task due date or cron schedule.',
});
