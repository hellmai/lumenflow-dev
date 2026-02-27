// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  createToolDescriptor,
} from './types.js';

const ROUTINE_READ_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/routines/**',
  access: TOOL_SCOPE_ACCESS.READ,
} as const;

const ROUTINE_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/routines/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

const AUDIT_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/audit/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

export const routineCreateDescriptor = createToolDescriptor({
  name: 'routine:create',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [ROUTINE_READ_SCOPE, ROUTINE_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: 'tool-impl/routine-tools.ts',
  description: 'Create a named routine with ordered tool+input steps and optional cron.',
});

export const routineListDescriptor = createToolDescriptor({
  name: 'routine:list',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [ROUTINE_READ_SCOPE],
  entry: 'tool-impl/routine-tools.ts',
  description: 'List routines with optional enabled_only filter.',
});

export const routineRunDescriptor = createToolDescriptor({
  name: 'routine:run',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [ROUTINE_READ_SCOPE],
  entry: 'tool-impl/routine-tools.ts',
  description: 'Generate an execution plan for a routine (plan-only, does not execute).',
});
