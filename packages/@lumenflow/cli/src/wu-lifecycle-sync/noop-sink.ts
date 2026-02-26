// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2224: No-op sink used when control_plane config is absent.
 *
 * @module wu-lifecycle-sync/noop-sink
 */

import type {
  WuLifecycleEventSink,
  WuLifecycleSyncResult,
  WuLifecycleSyncSkippedReason,
} from './port.js';
import { WU_LIFECYCLE_SYNC_RESULT_DEFAULTS } from './constants.js';

export function createNoopSink(skippedReason: WuLifecycleSyncSkippedReason): WuLifecycleEventSink {
  return {
    async push(): Promise<WuLifecycleSyncResult> {
      return {
        sent: WU_LIFECYCLE_SYNC_RESULT_DEFAULTS.SENT,
        accepted: WU_LIFECYCLE_SYNC_RESULT_DEFAULTS.ACCEPTED,
        skippedReason,
      };
    },
  };
}
