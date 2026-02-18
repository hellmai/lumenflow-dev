// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  TaskSpecSchema,
  type ClaimTaskInput,
  type CompleteTaskInput,
  type KernelRuntime,
} from '@lumenflow/kernel';

const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
} as const;

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const HEADER = {
  CONTENT_TYPE: 'content-type',
} as const;

const CONTENT_TYPE = {
  JSON: 'application/json; charset=utf-8',
} as const;

const ROUTE_ACTION = {
  CLAIM: 'claim',
  COMPLETE: 'complete',
} as const;

const JSON_BODY_EMPTY = '';
const JSON_RESPONSE_KEY_ERROR = 'error';
const JSON_RESPONSE_KEY_MESSAGE = 'message';
const UTF8_ENCODING = 'utf8';

class HttpSurfaceRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = HTTP_STATUS.BAD_REQUEST) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface TaskApiRouter {
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
    routeSegments: string[],
  ): Promise<boolean>;
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(payload: JsonRecord, key: string, validationMessage: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpSurfaceRequestError(validationMessage);
  }
  return value;
}

function readOptionalString(
  payload: JsonRecord,
  key: string,
  validationMessage: string,
): string | undefined {
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpSurfaceRequestError(validationMessage);
  }
  return value;
}

function readOptionalObject(
  payload: JsonRecord,
  key: string,
  validationMessage: string,
): JsonRecord | undefined {
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonRecord(value)) {
    throw new HttpSurfaceRequestError(validationMessage);
  }
  return value;
}

function readOptionalStringArray(
  payload: JsonRecord,
  key: string,
  validationMessage: string,
): string[] | undefined {
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HttpSurfaceRequestError(validationMessage);
  }
  if (value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new HttpSurfaceRequestError(validationMessage);
  }
  return value;
}

function writeJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader(HEADER.CONTENT_TYPE, CONTENT_TYPE.JSON);
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = JSON_BODY_EMPTY;
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString(UTF8_ENCODING) : String(chunk);
  }
  return body;
}

async function readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
  const rawBody = await readRequestBody(request);
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpSurfaceRequestError('Request body must be valid JSON.');
  }
}

function assertJsonRecord(payload: unknown, message: string): JsonRecord {
  if (!isJsonRecord(payload)) {
    throw new HttpSurfaceRequestError(message);
  }
  return payload;
}

function toClaimTaskInput(taskId: string, payload: JsonRecord): ClaimTaskInput {
  return {
    task_id: taskId,
    by: readRequiredString(payload, 'by', 'claim requires by.'),
    session_id: readRequiredString(payload, 'session_id', 'claim requires session_id.'),
    timestamp: readOptionalString(
      payload,
      'timestamp',
      'claim timestamp must be a non-empty string.',
    ),
    domain_data: readOptionalObject(
      payload,
      'domain_data',
      'claim domain_data must be a JSON object when provided.',
    ),
  };
}

function toCompleteTaskInput(taskId: string, payload: JsonRecord): CompleteTaskInput {
  return {
    task_id: taskId,
    run_id: readOptionalString(payload, 'run_id', 'complete run_id must be a non-empty string.'),
    timestamp: readOptionalString(
      payload,
      'timestamp',
      'complete timestamp must be a non-empty string.',
    ),
    evidence_refs: readOptionalStringArray(
      payload,
      'evidence_refs',
      'complete evidence_refs must be an array of non-empty strings.',
    ),
  };
}

function matchesCollectionRoute(routeSegments: string[]): boolean {
  return routeSegments.length === 0;
}

function matchesTaskDetailRoute(routeSegments: string[]): boolean {
  return routeSegments.length === 1;
}

function matchesTaskActionRoute(routeSegments: string[]): boolean {
  return routeSegments.length === 2;
}

function writeUnknownRoute(response: ServerResponse<IncomingMessage>): void {
  writeJson(response, HTTP_STATUS.NOT_FOUND, {
    [JSON_RESPONSE_KEY_ERROR]: {
      [JSON_RESPONSE_KEY_MESSAGE]: 'Route not found.',
    },
  });
}

function writeMethodNotAllowed(response: ServerResponse<IncomingMessage>, method: string): void {
  writeJson(response, HTTP_STATUS.METHOD_NOT_ALLOWED, {
    [JSON_RESPONSE_KEY_ERROR]: {
      [JSON_RESPONSE_KEY_MESSAGE]: `Unsupported method: ${method}`,
    },
  });
}

function writeError(response: ServerResponse<IncomingMessage>, error: unknown): void {
  if (error instanceof HttpSurfaceRequestError) {
    writeJson(response, error.statusCode, {
      [JSON_RESPONSE_KEY_ERROR]: {
        [JSON_RESPONSE_KEY_MESSAGE]: error.message,
      },
    });
    return;
  }

  writeJson(response, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
    [JSON_RESPONSE_KEY_ERROR]: {
      [JSON_RESPONSE_KEY_MESSAGE]: 'Internal server error.',
    },
  });
}

export function createTaskApiRouter(runtime: KernelRuntime): TaskApiRouter {
  return {
    async handleRequest(
      request: IncomingMessage,
      response: ServerResponse<IncomingMessage>,
      routeSegments: string[],
    ): Promise<boolean> {
      const method = request.method ?? '';

      try {
        if (matchesCollectionRoute(routeSegments)) {
          if (method !== HTTP_METHOD.POST) {
            writeMethodNotAllowed(response, method);
            return true;
          }
          const payload = await readJsonRequestBody(request);
          const taskSpec = TaskSpecSchema.parse(payload);
          const result = await runtime.createTask(taskSpec);
          writeJson(response, HTTP_STATUS.OK, result);
          return true;
        }

        if (matchesTaskDetailRoute(routeSegments)) {
          if (method !== HTTP_METHOD.GET) {
            writeMethodNotAllowed(response, method);
            return true;
          }
          const taskId = routeSegments[0] ?? '';
          const result = await runtime.inspectTask(taskId);
          writeJson(response, HTTP_STATUS.OK, result);
          return true;
        }

        if (matchesTaskActionRoute(routeSegments)) {
          if (method !== HTTP_METHOD.POST) {
            writeMethodNotAllowed(response, method);
            return true;
          }

          const taskId = routeSegments[0] ?? '';
          const action = routeSegments[1] ?? '';
          const payload = assertJsonRecord(
            await readJsonRequestBody(request),
            'Request body must be a JSON object.',
          );

          if (action === ROUTE_ACTION.CLAIM) {
            const result = await runtime.claimTask(toClaimTaskInput(taskId, payload));
            writeJson(response, HTTP_STATUS.OK, result);
            return true;
          }

          if (action === ROUTE_ACTION.COMPLETE) {
            const result = await runtime.completeTask(toCompleteTaskInput(taskId, payload));
            writeJson(response, HTTP_STATUS.OK, result);
            return true;
          }
        }

        writeUnknownRoute(response);
        return true;
      } catch (error) {
        writeError(response, error);
        return true;
      }
    },
  };
}
