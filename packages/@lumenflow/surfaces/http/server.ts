// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Disposable, KernelEvent, KernelRuntime, ReplayFilter } from '@lumenflow/kernel';
import { createEventStreamRouter, type EventSubscriber } from './event-stream.js';
import { createTaskApiRouter } from './task-api.js';

const URL_BASE = 'http://localhost';
const ROUTE_SEGMENT = {
  TASKS: 'tasks',
  EVENTS: 'events',
} as const;
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

function resolveEventSubscriber(
  runtime: KernelRuntime,
  options: HttpSurfaceOptions,
): EventSubscriber | undefined {
  if (options.eventSubscriber) {
    return options.eventSubscriber;
  }

  const runtimeWithSubscribeEvents = runtime as RuntimeWithSubscribeEvents;
  if (typeof runtimeWithSubscribeEvents.subscribeEvents === 'function') {
    return {
      subscribe: runtimeWithSubscribeEvents.subscribeEvents.bind(runtimeWithSubscribeEvents),
    };
  }

  const runtimeWithPrivateEventStore = runtime as RuntimeWithPrivateEventStore;
  if (runtimeWithPrivateEventStore.eventStore) {
    return runtimeWithPrivateEventStore.eventStore;
  }

  return undefined;
}

export function createHttpSurface(
  runtime: KernelRuntime,
  options: HttpSurfaceOptions = {},
): HttpSurface {
  const taskApiRouter = createTaskApiRouter(runtime);
  const eventStreamRouter = createEventStreamRouter(resolveEventSubscriber(runtime, options));

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

      if (rootSegment === ROUTE_SEGMENT.EVENTS) {
        await eventStreamRouter.handleRequest(
          request,
          response,
          nestedSegments,
          route.searchParams,
        );
        return;
      }

      writeNotFound(response);
    },
  };
}
