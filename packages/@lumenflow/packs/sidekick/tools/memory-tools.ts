// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  createToolDescriptor,
} from './types.js';

const MEMORY_READ_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/memory/**',
  access: TOOL_SCOPE_ACCESS.READ,
} as const;

const MEMORY_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/memory/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

const AUDIT_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/audit/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

export const memoryStoreDescriptor = createToolDescriptor({
  name: 'memory:store',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [MEMORY_READ_SCOPE, MEMORY_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: 'tool-impl/memory-tools.ts',
  description: 'Store a typed memory entry (fact, preference, note, snippet) with optional tags.',
});

export const memoryRecallDescriptor = createToolDescriptor({
  name: 'memory:recall',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [MEMORY_READ_SCOPE],
  entry: 'tool-impl/memory-tools.ts',
  description: 'Recall memory entries by substring search and/or tag filter.',
});

export const memoryForgetDescriptor = createToolDescriptor({
  name: 'memory:forget',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [MEMORY_READ_SCOPE, MEMORY_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: 'tool-impl/memory-tools.ts',
  description: 'Remove a memory entry by ID. Supports dry_run.',
});
