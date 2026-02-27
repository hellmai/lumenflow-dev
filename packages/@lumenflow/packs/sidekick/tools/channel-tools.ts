// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  TOOL_PERMISSIONS,
  TOOL_SCOPE_ACCESS,
  TOOL_SCOPE_TYPES,
  createToolDescriptor,
} from './types.js';

const CHANNEL_READ_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/channels/**',
  access: TOOL_SCOPE_ACCESS.READ,
} as const;

const CHANNEL_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/channels/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

const AUDIT_WRITE_SCOPE = {
  type: TOOL_SCOPE_TYPES.PATH,
  pattern: '.sidekick/audit/**',
  access: TOOL_SCOPE_ACCESS.WRITE,
} as const;

const CHANNEL_TOOLS_ENTRY = 'tool-impl/channel-tools.ts';

export const channelConfigureDescriptor = createToolDescriptor({
  name: 'channel:configure',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [CHANNEL_READ_SCOPE, CHANNEL_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: CHANNEL_TOOLS_ENTRY,
  description: 'Configure a messaging channel (terminal-only in v0.1).',
});

export const channelSendDescriptor = createToolDescriptor({
  name: 'channel:send',
  permission: TOOL_PERMISSIONS.WRITE,
  required_scopes: [CHANNEL_READ_SCOPE, CHANNEL_WRITE_SCOPE, AUDIT_WRITE_SCOPE],
  entry: CHANNEL_TOOLS_ENTRY,
  description: 'Send a message to a channel. Supports dry_run.',
});

export const channelReceiveDescriptor = createToolDescriptor({
  name: 'channel:receive',
  permission: TOOL_PERMISSIONS.READ,
  required_scopes: [CHANNEL_READ_SCOPE],
  entry: CHANNEL_TOOLS_ENTRY,
  description: 'Receive messages from a channel with optional limit and since filter.',
});
