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
  pattern: '.sidekick/**',
  access: TOOL_SCOPE_ACCESS.READ,
} as const;

const SIDEKICK_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

const SYSTEM_TOOLS_ENTRY = 'tool-impl/system-tools.ts';

export const sidekickInitDescriptor = createToolDescriptor({
  name: 'sidekick:init',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [SIDEKICK_READ_SCOPE, SIDEKICK_WRITE_SCOPE],
  entry: SYSTEM_TOOLS_ENTRY,
  description: 'Initialize .sidekick/ directory structure. Idempotent.',
});

export const sidekickStatusDescriptor = createToolDescriptor({
  name: 'sidekick:status',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [SIDEKICK_READ_SCOPE],
  entry: SYSTEM_TOOLS_ENTRY,
  description: 'Show sidekick status: store counts, initialized state, version.',
});

export const sidekickExportDescriptor = createToolDescriptor({
  name: 'sidekick:export',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [SIDEKICK_READ_SCOPE],
  entry: SYSTEM_TOOLS_ENTRY,
  description: 'Export all sidekick data as a JSON bundle (read-only, no file write).',
});
