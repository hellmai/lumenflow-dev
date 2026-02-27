// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ExecutionContextSchema,
  TOOL_ERROR_CODES,
  type ExecutionContext,
  type KernelRuntime,
  type ToolOutput,
} from '@lumenflow/kernel';

const HTTP_METHOD = {
  POST: 'POST',
} as const;

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const HEADER = {
  CONTENT_TYPE: 'content-type',
} as const;

const CONTENT_TYPE = {
  JSON: 'application/json; charset=utf-8',
} as const;

const RESPONSE_KEYS = {
  ERROR: 'error',
  MESSAGE: 'message',
} as const;

const UTF8_ENCODING = 'utf8';

interface ToolApiRequestBody {
  input?: unknown;
  context: ExecutionContext;
}

interface JsonRecord {
  [key: string]: unknown;
}

class ToolApiRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = HTTP_STATUS.BAD_REQUEST) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface ToolApiRouterOptions {
  allowlistedTools: readonly string[];
}

export interface ToolApiRouter {
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
    routeSegments: string[],
  ): Promise<boolean>;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function writeMethodNotAllowed(response: ServerResponse<IncomingMessage>, method: string): void {
  writeJson(response, HTTP_STATUS.METHOD_NOT_ALLOWED, {
    [RESPONSE_KEYS.ERROR]: {
      [RESPONSE_KEYS.MESSAGE]: `Unsupported method: ${method}`,
    },
  });
}

function writeUnknownRoute(response: ServerResponse<IncomingMessage>): void {
  writeJson(response, HTTP_STATUS.NOT_FOUND, {
    [RESPONSE_KEYS.ERROR]: {
      [RESPONSE_KEYS.MESSAGE]: 'Route not found.',
    },
  });
}

function writeError(response: ServerResponse<IncomingMessage>, error: unknown): void {
  if (error instanceof ToolApiRequestError) {
    writeJson(response, error.statusCode, {
      [RESPONSE_KEYS.ERROR]: {
        [RESPONSE_KEYS.MESSAGE]: error.message,
      },
    });
    return;
  }

  writeJson(response, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
    [RESPONSE_KEYS.ERROR]: {
      [RESPONSE_KEYS.MESSAGE]: 'Internal server error.',
    },
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = '';
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
    throw new ToolApiRequestError('Request body must be valid JSON.');
  }
}

function toToolApiBody(payload: unknown): ToolApiRequestBody {
  if (!isJsonRecord(payload)) {
    throw new ToolApiRequestError('Request body must be a JSON object.');
  }

  if (!('context' in payload)) {
    throw new ToolApiRequestError('context is required.');
  }

  let context: ExecutionContext;
  try {
    context = ExecutionContextSchema.parse(payload.context);
  } catch (error) {
    throw new ToolApiRequestError((error as Error).message);
  }

  return {
    input: payload.input,
    context,
  };
}

function mapToolOutputStatus(output: ToolOutput): number {
  if (output.success) {
    return HTTP_STATUS.OK;
  }

  const code = output.error?.code;
  if (code === TOOL_ERROR_CODES.TOOL_NOT_FOUND) {
    return HTTP_STATUS.NOT_FOUND;
  }
  if (
    code === TOOL_ERROR_CODES.POLICY_DENIED ||
    code === TOOL_ERROR_CODES.SCOPE_DENIED ||
    code === TOOL_ERROR_CODES.APPROVAL_REQUIRED
  ) {
    return HTTP_STATUS.FORBIDDEN;
  }
  if (code === TOOL_ERROR_CODES.INVALID_INPUT) {
    return HTTP_STATUS.BAD_REQUEST;
  }

  return HTTP_STATUS.OK;
}

export function createToolApiRouter(
  runtime: KernelRuntime,
  options: ToolApiRouterOptions,
): ToolApiRouter {
  const allowlistedTools = new Set(options.allowlistedTools);

  return {
    async handleRequest(
      request: IncomingMessage,
      response: ServerResponse<IncomingMessage>,
      routeSegments: string[],
    ): Promise<boolean> {
      const method = request.method ?? '';

      try {
        if (routeSegments.length !== 1) {
          writeUnknownRoute(response);
          return true;
        }

        if (method !== HTTP_METHOD.POST) {
          writeMethodNotAllowed(response, method);
          return true;
        }

        const toolName = routeSegments[0] ?? '';
        if (!allowlistedTools.has(toolName)) {
          writeJson(response, HTTP_STATUS.FORBIDDEN, {
            success: false,
            error: {
              code: 'TOOL_NOT_ALLOWLISTED',
              message: `Tool "${toolName}" is not allowlisted for HTTP dispatch.`,
            },
          });
          return true;
        }

        const body = toToolApiBody(await readJsonRequestBody(request));
        const output = await runtime.executeTool(toolName, body.input ?? {}, body.context);
        writeJson(response, mapToolOutputStatus(output), output);
        return true;
      } catch (error) {
        writeError(response, error);
        return true;
      }
    },
  };
}
