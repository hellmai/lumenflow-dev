// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { getSidekickRuntimeContext } from './runtime-context.js';

export interface ChannelTransport {
  provider: string;
  send(req: {
    workspaceId: string;
    provider: string;
    channel: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    error?: string;
    externalMessageId?: string;
    failureClass?: 'retryable' | 'terminal';
    retryAfterSeconds?: number;
    metadata?: Record<string, unknown>;
  }>;
  receive(req: {
    workspaceId: string;
    provider: string;
    channel: string;
    cursor?: string;
    limit?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    error?: string;
    records?: unknown[];
    nextCursor?: string;
    failureClass?: 'retryable' | 'terminal';
    retryAfterSeconds?: number;
    metadata?: Record<string, unknown>;
  }>;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function getRegistry(): Map<string, ChannelTransport> | undefined {
  return getSidekickRuntimeContext()?.channelTransports;
}

export function registerChannelTransport(transport: ChannelTransport): void {
  const provider = normalizeProvider(transport.provider);
  if (provider.length === 0) {
    throw new Error('channel transport provider must be a non-empty string.');
  }
  const registry = getRegistry();
  if (!registry) {
    throw new Error('channel transport registry is unavailable outside sidekick runtime context.');
  }
  registry.set(provider, transport);
}

export function getChannelTransport(provider: string): ChannelTransport | undefined {
  const normalized = normalizeProvider(provider);
  if (normalized.length === 0) {
    return undefined;
  }
  const registry = getRegistry();
  return registry?.get(normalized);
}

export function clearChannelTransports(): void {
  const registry = getRegistry();
  if (!registry) {
    return;
  }
  registry.clear();
}
