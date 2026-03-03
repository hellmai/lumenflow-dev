// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChannelTransport } from './channel-transports.js';
import type { StoragePort } from './storage.js';

export interface SidekickRuntimeContext {
  storagePort: StoragePort;
  channelTransports: Map<string, ChannelTransport>;
}

const runtimeContext = new AsyncLocalStorage<SidekickRuntimeContext>();

export function getSidekickRuntimeContext(): SidekickRuntimeContext | undefined {
  return runtimeContext.getStore();
}

export async function runWithSidekickRuntimeContext<T>(
  context: SidekickRuntimeContext,
  fn: () => Promise<T>,
): Promise<T> {
  return runtimeContext.run(context, fn);
}
