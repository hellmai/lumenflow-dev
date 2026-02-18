// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  KERNEL_EVENT_KINDS,
  type Disposable,
  type KernelEvent,
  type ReplayFilter,
} from '@lumenflow/kernel';

const HTTP_METHOD = {
  GET: 'GET',
} as const;

const HTTP_STATUS = {
  OK: 200,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_IMPLEMENTED: 501,
} as const;

const HEADER = {
  CACHE_CONTROL: 'cache-control',
  CONNECTION: 'connection',
  CONTENT_TYPE: 'content-type',
} as const;

const HEADER_VALUE = {
  CACHE_CONTROL: 'no-cache',
  CONNECTION: 'keep-alive',
  EVENT_STREAM: 'text/event-stream; charset=utf-8',
} as const;

const JSON_RESPONSE_KEY_ERROR = 'error';
const JSON_RESPONSE_KEY_MESSAGE = 'message';
const JSON_LINE_SEPARATOR = '\n';
const SEARCH_PARAM = {
  KIND: 'kind',
  SINCE_TIMESTAMP: 'sinceTimestamp',
  UNTIL_TIMESTAMP: 'untilTimestamp',
} as const;

const REPLAY_KIND_VALUES = new Set<KernelEvent['kind']>(
  Object.values(KERNEL_EVENT_KINDS) as KernelEvent['kind'][],
);

export interface EventSubscriber {
  subscribe(
    filter: ReplayFilter,
    callback: (event: KernelEvent) => void | Promise<void>,
  ): Disposable;
}

export interface EventStreamRouter {
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
    routeSegments: string[],
    searchParams: URLSearchParams,
  ): Promise<boolean>;
}

function writeJsonError(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  message: string,
): void {
  response.statusCode = statusCode;
  response.setHeader(HEADER.CONTENT_TYPE, 'application/json; charset=utf-8');
  response.end(
    JSON.stringify({
      [JSON_RESPONSE_KEY_ERROR]: {
        [JSON_RESPONSE_KEY_MESSAGE]: message,
      },
    }),
  );
}

function toKindFilter(searchParams: URLSearchParams): ReplayFilter['kind'] {
  const values = searchParams
    .getAll(SEARCH_PARAM.KIND)
    .map((value) => value.trim())
    .filter((value): value is KernelEvent['kind'] => {
      return value.length > 0 && REPLAY_KIND_VALUES.has(value as KernelEvent['kind']);
    });

  if (values.length === 0) {
    return undefined;
  }
  if (values.length === 1) {
    return values[0];
  }
  return values;
}

function toReplayFilter(taskId: string, searchParams: URLSearchParams): ReplayFilter {
  const sinceTimestamp = searchParams.get(SEARCH_PARAM.SINCE_TIMESTAMP) ?? undefined;
  const untilTimestamp = searchParams.get(SEARCH_PARAM.UNTIL_TIMESTAMP) ?? undefined;
  return {
    taskId,
    kind: toKindFilter(searchParams),
    sinceTimestamp,
    untilTimestamp,
  };
}

function writeEventStreamHeaders(response: ServerResponse<IncomingMessage>): void {
  response.statusCode = HTTP_STATUS.OK;
  response.setHeader(HEADER.CONTENT_TYPE, HEADER_VALUE.EVENT_STREAM);
  response.setHeader(HEADER.CACHE_CONTROL, HEADER_VALUE.CACHE_CONTROL);
  response.setHeader(HEADER.CONNECTION, HEADER_VALUE.CONNECTION);
}

export function createEventStreamRouter(eventSubscriber?: EventSubscriber): EventStreamRouter {
  return {
    async handleRequest(
      request: IncomingMessage,
      response: ServerResponse<IncomingMessage>,
      routeSegments: string[],
      searchParams: URLSearchParams,
    ): Promise<boolean> {
      if (routeSegments.length !== 1) {
        writeJsonError(response, HTTP_STATUS.NOT_FOUND, 'Route not found.');
        return true;
      }

      if ((request.method ?? '') !== HTTP_METHOD.GET) {
        writeJsonError(response, HTTP_STATUS.METHOD_NOT_ALLOWED, 'Unsupported method.');
        return true;
      }

      if (!eventSubscriber) {
        writeJsonError(response, HTTP_STATUS.NOT_IMPLEMENTED, 'Event streaming is unavailable.');
        return true;
      }

      const taskId = routeSegments[0] ?? '';
      const filter = toReplayFilter(taskId, searchParams);

      writeEventStreamHeaders(response);

      let isDisposed = false;
      const subscription = eventSubscriber.subscribe(filter, async (event) => {
        if (isDisposed) {
          return;
        }
        const payload = `${JSON.stringify(event)}${JSON_LINE_SEPARATOR}`;
        response.write(payload);
      });

      const dispose = (): void => {
        if (isDisposed) {
          return;
        }
        isDisposed = true;
        subscription.dispose();
      };

      request.on('close', dispose);
      response.on('close', dispose);
      response.on('finish', dispose);

      return true;
    },
  };
}
