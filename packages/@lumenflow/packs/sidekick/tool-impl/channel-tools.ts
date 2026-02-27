// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { getStoragePort, type ChannelMessageRecord, type ChannelRecord } from './storage.js';
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
  CONFIGURE: 'channel:configure',
  SEND: 'channel:send',
  RECEIVE: 'channel:receive',
} as const;

const OUTBOX_CAP = 100;
const DEFAULT_CHANNEL_NAME = 'default';

// ---------------------------------------------------------------------------
// channel:configure
// ---------------------------------------------------------------------------

async function channelConfigureTool(
  input: unknown,
  context?: ToolContextLike,
): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const name = asNonEmptyString(parsed.name);

  if (!name) {
    return failure('INVALID_INPUT', 'name is required.');
  }

  const now = nowIso();
  const channel: ChannelRecord = {
    id: createId('chan'),
    name,
    created_at: now,
    updated_at: now,
  };

  if (isDryRun(parsed)) {
    return success({
      dry_run: true,
      channel: channel as unknown as Record<string, unknown>,
    });
  }

  const storage = getStoragePort();
  let resolvedChannel = channel;

  await storage.withLock(async () => {
    const channels = await storage.readStore('channels');
    const existing = channels.find((c) => c.name === name);

    if (existing) {
      resolvedChannel = { ...existing, updated_at: now };
      const updated = channels.map((c) => (c.id === existing.id ? resolvedChannel : c));
      await storage.writeStore('channels', updated);
      await storage.appendAudit(
        buildAuditEvent({
          tool: TOOL_NAMES.CONFIGURE,
          op: 'update',
          context,
          ids: [existing.id],
        }),
      );
    } else {
      channels.push(channel);
      await storage.writeStore('channels', channels);
      await storage.appendAudit(
        buildAuditEvent({
          tool: TOOL_NAMES.CONFIGURE,
          op: 'create',
          context,
          ids: [channel.id],
        }),
      );
    }
  });

  return success({ channel: resolvedChannel as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// channel:send
// ---------------------------------------------------------------------------

async function channelSendTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const content = asNonEmptyString(parsed.content);

  if (!content) {
    return failure('INVALID_INPUT', 'content is required.');
  }

  const channelName = asNonEmptyString(parsed.channel) ?? DEFAULT_CHANNEL_NAME;
  const sender = asNonEmptyString(parsed.sender) ?? 'assistant';
  const now = nowIso();

  const message: ChannelMessageRecord = {
    id: createId('msg'),
    channel_id: '', // resolved below
    sender,
    content,
    created_at: now,
  };

  if (isDryRun(parsed)) {
    return success({
      dry_run: true,
      message: { ...message, channel_id: 'dry-run' } as unknown as Record<string, unknown>,
    });
  }

  const storage = getStoragePort();
  let resolvedMessage = message;

  await storage.withLock(async () => {
    const channels = await storage.readStore('channels');
    let existing = channels.find((c) => c.name === channelName);

    if (!existing) {
      existing = {
        id: createId('chan'),
        name: channelName,
        created_at: now,
        updated_at: now,
      };
      channels.push(existing);
      await storage.writeStore('channels', channels);
    } else {
      const updated = channels.map((c) => (c.id === existing!.id ? { ...c, updated_at: now } : c));
      await storage.writeStore('channels', updated);
    }

    resolvedMessage = { ...message, channel_id: existing.id };

    const messages = await storage.readStore('messages');
    messages.push(resolvedMessage);

    // Cap outbox at OUTBOX_CAP
    const capped = messages.length > OUTBOX_CAP ? messages.slice(-OUTBOX_CAP) : messages;
    await storage.writeStore('messages', capped);

    await storage.appendAudit(
      buildAuditEvent({
        tool: TOOL_NAMES.SEND,
        op: 'create',
        context,
        ids: [existing.id, resolvedMessage.id],
      }),
    );
  });

  return success({ message: resolvedMessage as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// channel:receive
// ---------------------------------------------------------------------------

async function channelReceiveTool(input: unknown, _context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const channelName = asNonEmptyString(parsed.channel);
  const limit = asInteger(parsed.limit);

  const storage = getStoragePort();
  const messages = await storage.readStore('messages');
  const channels = await storage.readStore('channels');

  let filtered = messages;

  if (channelName) {
    const channel = channels.find((c) => c.name === channelName);
    if (channel) {
      filtered = messages.filter((m) => m.channel_id === channel.id);
    } else {
      filtered = [];
    }
  }

  const sorted = filtered.toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const items = limit && limit > 0 ? sorted.slice(-limit) : sorted;

  return success({
    items: items as unknown as Record<string, unknown>,
    count: items.length,
  });
}

// ---------------------------------------------------------------------------
// Router (default export)
// ---------------------------------------------------------------------------

export default async function channelTools(
  input: unknown,
  context?: ToolContextLike,
): Promise<ToolOutput> {
  switch (context?.tool_name) {
    case TOOL_NAMES.CONFIGURE:
      return channelConfigureTool(input, context);
    case TOOL_NAMES.SEND:
      return channelSendTool(input, context);
    case TOOL_NAMES.RECEIVE:
      return channelReceiveTool(input, context);
    default:
      return failure('UNKNOWN_TOOL', `Unknown channel tool: ${context?.tool_name ?? 'unknown'}`);
  }
}
