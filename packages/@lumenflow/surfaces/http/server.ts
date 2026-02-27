// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Disposable, KernelEvent, KernelRuntime, ReplayFilter } from '@lumenflow/kernel';
import { createEventStreamRouter, type EventSubscriber } from './event-stream.js';
import { createRunAgentRouter } from './run-agent.js';
import { createTaskApiRouter } from './task-api.js';
import { createToolApiRouter, type ToolApiRouterOptions } from './tool-api.js';
import {
  DEFAULT_CONTROL_PLANE_SYNC_INTERVAL_MS,
  type ControlPlaneSyncPortLike,
  wrapEventSubscriberWithControlPlaneSync,
} from './control-plane-event-subscriber.js';

const URL_BASE = 'http://localhost';
const ROUTE_SEGMENT = {
  TASKS: 'tasks',
  TOOLS: 'tools',
  EVENTS: 'events',
  AG_UI: 'ag-ui',
} as const;
const AG_UI_RUN_PATH_SEGMENTS = ['ag-ui', 'v1', 'run'] as const;
const HTTP_STATUS_NOT_FOUND = 404;
const HEADER_CONTENT_TYPE = 'content-type';
const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';
const RESPONSE_ERROR_KEY = 'error';
const RESPONSE_MESSAGE_KEY = 'message';

interface RuntimeEventStoreLike {
  subscribe(
    filter: ReplayFilter,
    callback: (event: KernelEvent) => void | Promise<void>,
  ): Disposable;
}

interface RuntimeWithSubscribeEvents extends KernelRuntime {
  subscribeEvents?: RuntimeEventStoreLike['subscribe'];
}

interface RuntimeWithPrivateEventStore extends KernelRuntime {
  eventStore?: RuntimeEventStoreLike;
}

export interface HttpSurfaceOptions {
  eventSubscriber?: EventSubscriber;
  controlPlaneSyncPort?: ControlPlaneSyncPortLike;
  workspaceId?: string;
  controlPlaneSyncIntervalMs?: number;
  controlPlaneDiagnosticsLogger?: Pick<Console, 'warn'>;
  allowlistedTools?: readonly string[];
}

export interface HttpSurface {
  handleRequest(request: IncomingMessage, response: ServerResponse<IncomingMessage>): Promise<void>;
}

function parseRoute(request: IncomingMessage): {
  segments: string[];
  searchParams: URLSearchParams;
} {
  const url = new URL(request.url ?? '/', URL_BASE);
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  return {
    segments,
    searchParams: url.searchParams,
  };
}

function writeNotFound(response: ServerResponse<IncomingMessage>): void {
  response.statusCode = HTTP_STATUS_NOT_FOUND;
  response.setHeader(HEADER_CONTENT_TYPE, CONTENT_TYPE_JSON);
  response.end(
    JSON.stringify({
      [RESPONSE_ERROR_KEY]: {
        [RESPONSE_MESSAGE_KEY]: 'Route not found.',
      },
    }),
  );
}

function matchesRunAgentRoute(segments: string[]): boolean {
  if (segments.length !== AG_UI_RUN_PATH_SEGMENTS.length) {
    return false;
  }
  return segments.every((segment, index) => segment === AG_UI_RUN_PATH_SEGMENTS[index]);
}

function resolveEventSubscriber(
  runtime: KernelRuntime,
  options: HttpSurfaceOptions,
): EventSubscriber | undefined {
  let subscriber: EventSubscriber | undefined;

  if (options.eventSubscriber) {
    subscriber = options.eventSubscriber;
  } else {
    const runtimeWithSubscribeEvents = runtime as RuntimeWithSubscribeEvents;
    if (typeof runtimeWithSubscribeEvents.subscribeEvents === 'function') {
      subscriber = {
        subscribe: runtimeWithSubscribeEvents.subscribeEvents.bind(runtimeWithSubscribeEvents),
      };
    } else {
      const runtimeWithPrivateEventStore = runtime as RuntimeWithPrivateEventStore;
      if (runtimeWithPrivateEventStore.eventStore) {
        subscriber = runtimeWithPrivateEventStore.eventStore;
      }
    }
  }

  if (subscriber && options.controlPlaneSyncPort && options.workspaceId) {
    return wrapEventSubscriberWithControlPlaneSync(subscriber, {
      controlPlaneSyncPort: options.controlPlaneSyncPort,
      workspaceId: options.workspaceId,
      pollIntervalMs: options.controlPlaneSyncIntervalMs ?? DEFAULT_CONTROL_PLANE_SYNC_INTERVAL_MS,
      logger: options.controlPlaneDiagnosticsLogger,
    });
  }

  return subscriber;
}

export function createHttpSurface(
  runtime: KernelRuntime,
  options: HttpSurfaceOptions = {},
): HttpSurface {
  const taskApiRouter = createTaskApiRouter(runtime);
  const toolApiRouter = options.allowlistedTools
    ? createToolApiRouter(runtime, { allowlistedTools: options.allowlistedTools })
    : undefined;
  const eventStreamRouter = createEventStreamRouter(resolveEventSubscriber(runtime, options));
  const runAgentConfig = options.workspaceId ? { workspaceId: options.workspaceId } : undefined;
  const runAgentRouter = createRunAgentRouter(
    runtime,
    resolveEventSubscriber(runtime, options),
    runAgentConfig,
  );

  return {
    async handleRequest(
      request: IncomingMessage,
      response: ServerResponse<IncomingMessage>,
    ): Promise<void> {
      const route = parseRoute(request);
      const rootSegment = route.segments[0] ?? '';
      const nestedSegments = route.segments.slice(1);

      if (rootSegment === ROUTE_SEGMENT.TASKS) {
        await taskApiRouter.handleRequest(request, response, nestedSegments);
        return;
      }

      if (rootSegment === ROUTE_SEGMENT.TOOLS && toolApiRouter) {
        await toolApiRouter.handleRequest(request, response, nestedSegments);
        return;
      }

      if (rootSegment === ROUTE_SEGMENT.EVENTS) {
        await eventStreamRouter.handleRequest(
          request,
          response,
          nestedSegments,
          route.searchParams,
        );
        return;
      }

      if (matchesRunAgentRoute(route.segments)) {
        await runAgentRouter.handleRequest(request, response);
        return;
      }

      writeNotFound(response);
    },
  };
}
