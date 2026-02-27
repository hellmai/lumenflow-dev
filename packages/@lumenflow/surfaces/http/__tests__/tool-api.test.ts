// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createToolApiRouter } from '../tool-api.js';

const HTTP_METHOD = {
  POST: 'POST',
  GET: 'GET',
} as const;

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const TOOL_NAME = {
  ALLOWED: 'task:status',
  DISALLOWED: 'task:delete',
} as const;

interface RequestOptions {
  method: string;
  body?: unknown;
}

class MockResponse extends EventEmitter {
  statusCode = HTTP_STATUS.OK;
  body = '';
  private readonly headers = new Map<string, string>();

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  write(chunk: string | Buffer): boolean {
    this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    return true;
  }

  end(chunk?: string | Buffer): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.emit('finish');
    return this;
  }
}

function createRequest(options: RequestOptions): IncomingMessage {
  const request = new PassThrough() as unknown as IncomingMessage & {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
  };

  request.method = options.method;
  request.url = '/';
  request.headers = {
    'content-type': 'application/json; charset=utf-8',
  };

  const payload = options.body === undefined ? '' : JSON.stringify(options.body);
  (request as unknown as PassThrough).end(payload);
  return request;
}

function createContext() {
  return {
    run_id: 'run-tool-api',
    task_id: 'WU-tool-api',
    session_id: 'session-tool-api',
    allowed_scopes: [
      {
        type: 'path' as const,
        pattern: 'workspace/**',
        access: 'read' as const,
      },
    ],
  };
}

function parseJsonBody(body: string): unknown {
  return JSON.parse(body);
}

describe('http tool api router', () => {
  // --- AC1: HTTP surface exposes POST /tools/:name ---

  it('dispatches allowlisted tool via POST and returns success', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: true,
        data: { ok: true },
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: { taskId: 'WU-1' },
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(runtime.executeTool).toHaveBeenCalledTimes(1);
    expect(runtime.executeTool).toHaveBeenCalledWith(
      TOOL_NAME.ALLOWED,
      { taskId: 'WU-1' },
      createContext(),
    );
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
  });

  it('passes empty object as input when input is omitted', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: true,
        data: {},
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(runtime.executeTool).toHaveBeenCalledWith(TOOL_NAME.ALLOWED, {}, createContext());
  });

  it('returns 405 for non-POST methods', async () => {
    const runtime = {
      executeTool: vi.fn(),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.GET,
      body: {},
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(runtime.executeTool).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HTTP_STATUS.METHOD_NOT_ALLOWED);
  });

  it('returns 404 for nested route segments', async () => {
    const runtime = {
      executeTool: vi.fn(),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
      'extra',
    ]);

    expect(runtime.executeTool).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  // --- AC2: Endpoint dispatches only allowlisted tools ---

  it('denies tools outside the allowlist with 403', async () => {
    const runtime = {
      executeTool: vi.fn(),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.DISALLOWED,
    ]);

    expect(runtime.executeTool).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const body = parseJsonBody(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TOOL_NOT_ALLOWLISTED');
  });

  // --- AC3: Policy/scope/tool-not-found responses are enforced and tested ---

  it('returns 404 when runtime reports TOOL_NOT_FOUND', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: 'Tool not registered.',
        },
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('returns 403 when runtime reports POLICY_DENIED', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: false,
        error: {
          code: 'POLICY_DENIED',
          message: 'Policy forbids this tool.',
        },
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(response.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('returns 403 when runtime reports SCOPE_DENIED', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: false,
        error: {
          code: 'SCOPE_DENIED',
          message: 'Scope intersection denied.',
        },
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(response.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('returns 403 when runtime reports APPROVAL_REQUIRED', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: false,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: 'Approval needed.',
        },
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(response.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('returns 400 when runtime reports INVALID_INPUT', async () => {
    const runtime = {
      executeTool: vi.fn(async () => ({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Bad input schema.',
        },
      })),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('returns 400 when context is missing from request body', async () => {
    const runtime = {
      executeTool: vi.fn(),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(runtime.executeTool).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const runtime = {
      executeTool: vi.fn(),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    // Create request with raw invalid JSON
    const request = new PassThrough() as unknown as IncomingMessage & {
      method: string;
      url: string;
      headers: IncomingHttpHeaders;
    };
    request.method = HTTP_METHOD.POST;
    request.url = '/';
    request.headers = { 'content-type': 'application/json; charset=utf-8' };
    (request as unknown as PassThrough).end('not-valid-json{');

    const response = new MockResponse();

    await router.handleRequest(
      request as IncomingMessage,
      response as unknown as ServerResponse<IncomingMessage>,
      [TOOL_NAME.ALLOWED],
    );

    expect(runtime.executeTool).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('returns 500 when runtime throws an unexpected error', async () => {
    const runtime = {
      executeTool: vi.fn(async () => {
        throw new Error('unexpected runtime crash');
      }),
    };

    const router = createToolApiRouter(runtime as never, {
      allowlistedTools: [TOOL_NAME.ALLOWED],
    });

    const request = createRequest({
      method: HTTP_METHOD.POST,
      body: {
        input: {},
        context: createContext(),
      },
    });
    const response = new MockResponse();

    await router.handleRequest(request, response as unknown as ServerResponse<IncomingMessage>, [
      TOOL_NAME.ALLOWED,
    ]);

    expect(response.statusCode).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });
});
