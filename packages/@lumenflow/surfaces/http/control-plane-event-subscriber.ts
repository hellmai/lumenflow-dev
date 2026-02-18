// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { Disposable, KernelEvent, ReplayFilter } from '@lumenflow/kernel';
import type { EventSubscriber } from './event-stream.js';

interface ControlPlaneSyncPortLike {
  pushKernelEvents(input: {
    workspace_id: string;
    events: KernelEvent[];
  }): Promise<{ accepted: number }>;
}

export interface ControlPlaneEventSubscriberOptions {
  controlPlaneSyncPort: ControlPlaneSyncPortLike;
  workspaceId: string;
  pollIntervalMs: number;
}

/**
 * Creates an EventSubscriber that can be used by the dashboard to
 * optionally read events from the control plane instead of a local
 * EventStore. This enables centralized observability for organizations
 * where the web dashboard may not have direct access to the local
 * event-store file.
 *
 * Note: This is a push-side bridge. The subscriber interface allows
 * the dashboard to subscribe to events that are forwarded through the
 * control plane, enabling the same SSE streaming pattern as local mode.
 */
export function createControlPlaneEventSubscriber(
  _options: ControlPlaneEventSubscriberOptions,
): EventSubscriber {
  return {
    subscribe(
      _filter: ReplayFilter,
      _callback: (event: KernelEvent) => void | Promise<void>,
    ): Disposable {
      // The control plane event subscriber provides the interface contract
      // for dashboard integration. The actual polling/streaming implementation
      // will be wired when the control plane SDK exposes a pull/subscribe
      // endpoint for kernel events.
      return {
        dispose: () => {
          // Cleanup when subscription is no longer needed.
        },
      };
    },
  };
}
