// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { getChannelTransport } from './channel-transports.js';
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

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function withTransportMetadata<T extends Record<string, unknown>>(
  data: T,
  metadata: Record<string, unknown> | undefined,
): T & Record<string, unknown> {
  if (!metadata) {
    return data;
  }
  return {
    ...data,
    metadata,
  };
}

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

async function channelSendViaTransport(
  input: Record<string, unknown>,
  context: ToolContextLike | undefined,
  provider: string,
  channel: string,
  content: string,
): Promise<ToolOutput> {
  const workspaceId = asNonEmptyString(context?.workspace_id);
  if (!workspaceId) {
    return failure(
      'WORKSPACE_CONTEXT_REQUIRED',
      'workspace_id is required when provider is specified.',
    );
  }

  const transport = getChannelTransport(provider);
  if (!transport) {
    return failure(
      'INTEGRATION_PROVIDER_NOT_REGISTERED',
      `No channel transport registered for provider: ${provider}`,
    );
  }

  if (isDryRun(input)) {
    return success({
      dry_run: true,
      provider,
      capability: 'send',
      channel,
      content,
    });
  }

  const transportResult = await transport.send({
    workspaceId,
    provider,
    channel,
    content,
    metadata: asOptionalRecord(input.metadata),
  });

  const outputData = withTransportMetadata(
    {
      provider,
      capability: 'send',
      channel,
      ...(transportResult.externalMessageId !== undefined
        ? { externalMessageId: transportResult.externalMessageId }
        : {}),
      ...(transportResult.failureClass ? { failureClass: transportResult.failureClass } : {}),
      ...(transportResult.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: transportResult.retryAfterSeconds }
        : {}),
    },
    transportResult.metadata,
  );

  if (!transportResult.success) {
    return {
      success: false,
      error: {
        code: 'INTEGRATION_PROVIDER_SEND_FAILED',
        message: transportResult.error ?? `Provider send failed for provider: ${provider}`,
      },
      data: outputData,
    };
  }

  return success(outputData);
}

async function channelSendTool(input: unknown, context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const content = asNonEmptyString(parsed.content);

  if (!content) {
    return failure('INVALID_INPUT', 'content is required.');
  }

  const channelName = asNonEmptyString(parsed.channel) ?? DEFAULT_CHANNEL_NAME;
  const provider = asNonEmptyString(parsed.provider);

  if (provider) {
    return channelSendViaTransport(parsed, context, provider, channelName, content);
  }

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
    const found = channels.find((c) => c.name === channelName);
    let channelId: string;

    if (!found) {
      channelId = createId('chan');
      channels.push({
        id: channelId,
        name: channelName,
        created_at: now,
        updated_at: now,
      });
      await storage.writeStore('channels', channels);
    } else {
      channelId = found.id;
      const updated = channels.map((c) => (c.id === channelId ? { ...c, updated_at: now } : c));
      await storage.writeStore('channels', updated);
    }

    resolvedMessage = { ...message, channel_id: channelId };

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
        ids: [channelId, resolvedMessage.id],
      }),
    );
  });

  return success({ message: resolvedMessage as unknown as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// channel:receive
// ---------------------------------------------------------------------------

async function channelReceiveViaTransport(
  input: Record<string, unknown>,
  context: ToolContextLike | undefined,
  provider: string,
  channel: string,
  limit: number | null,
): Promise<ToolOutput> {
  const workspaceId = asNonEmptyString(context?.workspace_id);
  if (!workspaceId) {
    return failure(
      'WORKSPACE_CONTEXT_REQUIRED',
      'workspace_id is required when provider is specified.',
    );
  }

  const transport = getChannelTransport(provider);
  if (!transport) {
    return failure(
      'INTEGRATION_PROVIDER_NOT_REGISTERED',
      `No channel transport registered for provider: ${provider}`,
    );
  }

  const cursor = asNonEmptyString(input.cursor) ?? undefined;

  const transportResult = await transport.receive({
    workspaceId,
    provider,
    channel,
    cursor,
    limit: limit && limit > 0 ? limit : undefined,
    metadata: asOptionalRecord(input.metadata),
  });

  const outputData = withTransportMetadata(
    {
      provider,
      capability: 'read',
      channel,
      ...(transportResult.records !== undefined ? { records: transportResult.records } : {}),
      ...(transportResult.nextCursor !== undefined
        ? { nextCursor: transportResult.nextCursor }
        : {}),
      ...(transportResult.failureClass ? { failureClass: transportResult.failureClass } : {}),
      ...(transportResult.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: transportResult.retryAfterSeconds }
        : {}),
    },
    transportResult.metadata,
  );

  if (!transportResult.success) {
    return {
      success: false,
      error: {
        code: 'INTEGRATION_PROVIDER_RECEIVE_FAILED',
        message: transportResult.error ?? `Provider receive failed for provider: ${provider}`,
      },
      data: outputData,
    };
  }

  return success(outputData);
}

async function channelReceiveTool(input: unknown, _context?: ToolContextLike): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const channelName = asNonEmptyString(parsed.channel);
  const limit = asInteger(parsed.limit);
  const provider = asNonEmptyString(parsed.provider);

  if (provider) {
    return channelReceiveViaTransport(
      parsed,
      _context,
      provider,
      channelName ?? DEFAULT_CHANNEL_NAME,
      limit,
    );
  }

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
