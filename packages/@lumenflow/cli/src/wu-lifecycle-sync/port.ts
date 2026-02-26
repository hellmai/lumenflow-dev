// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2224: Port interface for WU lifecycle event sync.
 *
 * Command handlers depend only on this interface, never on HTTP or SDK details.
 *
 * @module wu-lifecycle-sync/port
 */

import type { KernelEvent } from '@lumenflow/kernel';
import type { WuLifecycleSyncSkippedReason as SharedWuLifecycleSyncSkippedReason } from './constants.js';

export type WuLifecycleSyncSkippedReason = SharedWuLifecycleSyncSkippedReason;

/** Result returned by every sink, whether real or noop. */
export interface WuLifecycleSyncResult {
  sent: boolean;
  accepted: number;
  skippedReason?: WuLifecycleSyncSkippedReason;
}

/** Port that command handlers call to push lifecycle events to the cloud. */
export interface WuLifecycleEventSink {
  push(events: KernelEvent[]): Promise<WuLifecycleSyncResult>;
}
