// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { Disposable, KernelEvent, ReplayFilter } from '@lumenflow/kernel';
import type { EventSubscriber } from './event-stream.js';

const CONTROL_PLANE_POLICY_DECISION = {
  DENY: 'deny',
} as const;

const DIAGNOSTIC_REASON = {
  POLICY_PULL_FAILED: 'policy pull failed',
  HEARTBEAT_FAILED: 'heartbeat failed',
  EVENT_PUSH_FAILED: 'event forwarding failed',
} as const;

const ACTIONABLE_SYNC_DIAGNOSTIC_SUFFIX = 'Check control_plane.endpoint and auth token.';
const WORKSPACE_WARNING_EVENT_KIND = 'workspace_warning';
const KERNEL_EVENT_SCHEMA_VERSION = 1;
const DEFAULT_SYNC_INTERVAL_MS = 30_000;
const SYNC_SESSION_ID_PREFIX = 'http-surface-sync';
const CLOCK_ISO_OFFSET = 36;

interface ControlPlanePolicyRuleLike {
  id: string;
  decision: 'allow' | 'deny';
  reason?: string;
}

interface ControlPlanePolicySetLike {
  default_decision: 'allow' | 'deny';
  rules: ControlPlanePolicyRuleLike[];
}

export interface ControlPlaneSyncPortLike {
  pullPolicies(input: { workspace_id: string }): Promise<ControlPlanePolicySetLike>;
  heartbeat(input: {
    workspace_id: string;
    session_id: string;
  }): Promise<{ status: 'ok'; server_time: string }>;
  pushKernelEvents(input: {
    workspace_id: string;
    events: KernelEvent[];
  }): Promise<{ accepted: number }>;
}

export interface ControlPlaneEventSubscriberOptions {
  controlPlaneSyncPort: ControlPlaneSyncPortLike;
  workspaceId: string;
  pollIntervalMs: number;
  logger?: Pick<Console, 'warn'>;
  now?: () => Date;
}

export const DEFAULT_CONTROL_PLANE_SYNC_INTERVAL_MS = DEFAULT_SYNC_INTERVAL_MS;

interface SyncState {
  allowForwarding: boolean;
  inFlight: boolean;
}

function createWorkspaceWarningEvent(message: string, now: () => Date): KernelEvent {
  return {
    schema_version: KERNEL_EVENT_SCHEMA_VERSION,
    kind: WORKSPACE_WARNING_EVENT_KIND,
    timestamp: now().toISOString(),
    message,
  } as KernelEvent;
}

function createSyncSessionId(now: () => Date): string {
  return `${SYNC_SESSION_ID_PREFIX}:${now().toISOString().slice(0, CLOCK_ISO_OFFSET)}`;
}

async function emitDiagnostic(
  callback: (event: KernelEvent) => void | Promise<void>,
  logger: Pick<Console, 'warn'> | undefined,
  workspaceId: string,
  reason: string,
  now: () => Date,
): Promise<void> {
  const message =
    `Control plane sync ${reason} for workspace "${workspaceId}". ` +
    ACTIONABLE_SYNC_DIAGNOSTIC_SUFFIX;
  logger?.warn?.(message);
  await callback(createWorkspaceWarningEvent(message, now));
}

async function runSyncCycle(
  options: ControlPlaneEventSubscriberOptions,
  callback: (event: KernelEvent) => void | Promise<void>,
  sessionId: string,
  pendingEvents: KernelEvent[],
  state: SyncState,
): Promise<void> {
  if (state.inFlight) {
    return;
  }
  state.inFlight = true;
  const now = options.now ?? (() => new Date());

  try {
    try {
      const pulledPolicies = await options.controlPlaneSyncPort.pullPolicies({
        workspace_id: options.workspaceId,
      });
      state.allowForwarding =
        pulledPolicies.default_decision !== CONTROL_PLANE_POLICY_DECISION.DENY;
    } catch {
      state.allowForwarding = false;
      await emitDiagnostic(
        callback,
        options.logger,
        options.workspaceId,
        DIAGNOSTIC_REASON.POLICY_PULL_FAILED,
        now,
      );
      return;
    }

    try {
      await options.controlPlaneSyncPort.heartbeat({
        workspace_id: options.workspaceId,
        session_id: sessionId,
      });
    } catch {
      await emitDiagnostic(
        callback,
        options.logger,
        options.workspaceId,
        DIAGNOSTIC_REASON.HEARTBEAT_FAILED,
        now,
      );
      return;
    }

    if (!state.allowForwarding || pendingEvents.length === 0) {
      return;
    }

    const batch = pendingEvents.splice(0, pendingEvents.length);
    try {
      await options.controlPlaneSyncPort.pushKernelEvents({
        workspace_id: options.workspaceId,
        events: batch,
      });
    } catch {
      pendingEvents.unshift(...batch);
      state.allowForwarding = false;
      await emitDiagnostic(
        callback,
        options.logger,
        options.workspaceId,
        DIAGNOSTIC_REASON.EVENT_PUSH_FAILED,
        now,
      );
    }
  } finally {
    state.inFlight = false;
  }
}

export function wrapEventSubscriberWithControlPlaneSync(
  source: EventSubscriber,
  options: ControlPlaneEventSubscriberOptions,
): EventSubscriber {
  const resolvedIntervalMs =
    options.pollIntervalMs > 0 ? options.pollIntervalMs : DEFAULT_CONTROL_PLANE_SYNC_INTERVAL_MS;

  return {
    subscribe(
      filter: ReplayFilter,
      callback: (event: KernelEvent) => void | Promise<void>,
    ): Disposable {
      const pendingEvents: KernelEvent[] = [];
      const state: SyncState = {
        allowForwarding: true,
        inFlight: false,
      };
      const now = options.now ?? (() => new Date());
      const sessionId = createSyncSessionId(now);

      const wrappedCallback = async (event: KernelEvent): Promise<void> => {
        await callback(event);
        pendingEvents.push(event);
      };

      const sourceSubscription = source.subscribe(filter, wrappedCallback);
      const timer = setInterval(() => {
        void runSyncCycle(options, callback, sessionId, pendingEvents, state);
      }, resolvedIntervalMs);

      return {
        dispose: () => {
          clearInterval(timer);
          sourceSubscription.dispose();
        },
      };
    },
  };
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
