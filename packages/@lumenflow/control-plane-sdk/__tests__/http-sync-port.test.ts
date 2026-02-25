// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import {
  HttpControlPlaneSyncPort,
  createHttpControlPlaneSyncPort,
} from '../src/http/http-control-plane-sync-port.js';
import type {
  ControlPlaneSyncPort,
  WorkspaceControlPlaneConfig,
} from '../src/sync-port.js';

const TEST_TIMEOUT_MS = 5;
const TOKEN_ENV = 'LUMENFLOW_CLOUD_TOKEN_TEST';
const TOKEN_VALUE = 'token-test-value';
const TEST_ENDPOINT = 'https://cloud.example.com';

const TEST_CONFIG: WorkspaceControlPlaneConfig = {
  endpoint: TEST_ENDPOINT,
  org_id: 'org-test',
  project_id: 'project-test',
  sync_interval: 30,
  policy_mode: 'tighten-only',
  auth: {
    token_env: TOKEN_ENV,
  },
};

const REQUEST_INPUTS = {
  pullPolicies: { workspace_id: 'workspace-a' },
  pullConfig: { workspace_id: 'workspace-a' },
  pushTelemetry: {
    workspace_id: 'workspace-a',
    records: [{ metric: 'task_completed', value: 1, timestamp: '2026-02-25T00:00:00.000Z' }],
  },
  pushEvidence: { workspace_id: 'workspace-a', evidence_refs: ['cas:sha256:abc'] },
  pushKernelEvents: {
    workspace_id: 'workspace-a',
    events: [
      {
        schema_version: 1,
        kind: 'workspace_warning',
        timestamp: '2026-02-25T00:00:00.000Z',
        message: 'warning',
      },
    ],
  },
  authenticate: {
    workspace_id: 'workspace-a',
    org_id: 'org-test',
    agent_id: 'agent-test',
    token_hint: 'hint',
  },
  heartbeat: { workspace_id: 'workspace-a', session_id: 'session-a' },
} as const;

const ENDPOINTS = {
  pullPolicies: '/api/v1/policies',
  pullConfig: '/api/v1/config',
  pushTelemetry: '/api/v1/telemetry',
  pushEvidence: '/api/v1/evidence',
  pushKernelEvents: '/api/v1/events',
  authenticate: '/api/v1/authenticate',
  heartbeat: '/api/v1/heartbeat',
} as const;

const SUCCESS_RESPONSES = {
  pullPolicies: { default_decision: 'allow', rules: [] },
  pullConfig: { id: 'workspace-a', control_plane: TEST_CONFIG },
  pushTelemetry: { accepted: 1 },
  pushEvidence: { accepted: 1 },
  pushKernelEvents: { accepted: 1 },
  authenticate: {
    workspace_id: 'workspace-a',
    org_id: 'org-test',
    agent_id: 'agent-test',
    token: 'server-token',
  },
  heartbeat: { status: 'ok', server_time: '2026-02-25T00:00:01.000Z' },
} as const;

const FALLBACK_RESULTS = {
  pullConfig: { id: 'workspace-a', control_plane: TEST_CONFIG },
  pushTelemetry: { accepted: 0 },
  pushEvidence: { accepted: 0 },
  authenticate: {
    workspace_id: 'workspace-a',
    org_id: 'org-test',
    agent_id: 'agent-test',
    token: '',
  },
} as const;

type MethodCase = {
  methodName: keyof typeof ENDPOINTS;
  call: (port: ControlPlaneSyncPort) => Promise<unknown>;
  expectsThrow: boolean;
  fallback?: unknown;
};

const METHOD_CASES: readonly MethodCase[] = [
  {
    methodName: 'pullPolicies',
    call: (port) => port.pullPolicies(REQUEST_INPUTS.pullPolicies),
    expectsThrow: true,
  },
  {
    methodName: 'pullConfig',
    call: (port) => port.pullConfig(REQUEST_INPUTS.pullConfig),
    expectsThrow: false,
    fallback: FALLBACK_RESULTS.pullConfig,
  },
  {
    methodName: 'pushTelemetry',
    call: (port) => port.pushTelemetry(REQUEST_INPUTS.pushTelemetry),
    expectsThrow: false,
    fallback: FALLBACK_RESULTS.pushTelemetry,
  },
  {
    methodName: 'pushEvidence',
    call: (port) => port.pushEvidence(REQUEST_INPUTS.pushEvidence),
    expectsThrow: false,
    fallback: FALLBACK_RESULTS.pushEvidence,
  },
  {
    methodName: 'pushKernelEvents',
    call: (port) => port.pushKernelEvents(REQUEST_INPUTS.pushKernelEvents),
    expectsThrow: true,
  },
  {
    methodName: 'authenticate',
    call: (port) => port.authenticate(REQUEST_INPUTS.authenticate),
    expectsThrow: false,
    fallback: FALLBACK_RESULTS.authenticate,
  },
  {
    methodName: 'heartbeat',
    call: (port) => port.heartbeat(REQUEST_INPUTS.heartbeat),
    expectsThrow: true,
  },
] as const;

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function createPort(input: {
  fetchFn: typeof fetch;
  logger?: Pick<Console, 'warn'>;
  timeoutMs?: number;
}): ControlPlaneSyncPort {
  return new HttpControlPlaneSyncPort(TEST_CONFIG, {
    fetchFn: input.fetchFn,
    timeoutMs: input.timeoutMs ?? 100,
    logger: input.logger,
    environment: {
      [TOKEN_ENV]: TOKEN_VALUE,
    },
  });
}

describe('HttpControlPlaneSyncPort', () => {
  it('maps all 7 methods to cloud /api/v1 endpoints with auth and JSON headers', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.pullPolicies))
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.pullConfig))
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.pushTelemetry))
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.pushEvidence))
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.pushKernelEvents))
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.authenticate))
      .mockResolvedValueOnce(createJsonResponse(SUCCESS_RESPONSES.heartbeat));

    const port = createPort({ fetchFn });

    await port.pullPolicies(REQUEST_INPUTS.pullPolicies);
    await port.pullConfig(REQUEST_INPUTS.pullConfig);
    await port.pushTelemetry(REQUEST_INPUTS.pushTelemetry);
    await port.pushEvidence(REQUEST_INPUTS.pushEvidence);
    await port.pushKernelEvents(REQUEST_INPUTS.pushKernelEvents);
    await port.authenticate(REQUEST_INPUTS.authenticate);
    await port.heartbeat(REQUEST_INPUTS.heartbeat);

    expect(fetchFn).toHaveBeenCalledTimes(7);

    const expectedPaths = [
      ENDPOINTS.pullPolicies,
      ENDPOINTS.pullConfig,
      ENDPOINTS.pushTelemetry,
      ENDPOINTS.pushEvidence,
      ENDPOINTS.pushKernelEvents,
      ENDPOINTS.authenticate,
      ENDPOINTS.heartbeat,
    ];

    fetchFn.mock.calls.forEach((call, index) => {
      const [url, init] = call;
      expect(url).toBe(`${TEST_ENDPOINT}${expectedPaths[index]}`);
      expect(init?.method).toBe('POST');

      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN_VALUE}`);
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toBeDefined();
    });
  });

  it.each(METHOD_CASES)(
    'handles network failure for $methodName',
    async ({ call, expectsThrow, fallback, methodName }) => {
      const logger = { warn: vi.fn() };
      const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'));
      const port = createPort({ fetchFn, logger });

      if (expectsThrow) {
        await expect(call(port)).rejects.toThrow('network down');
      } else {
        await expect(call(port)).resolves.toEqual(fallback);
      }

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(methodName));
    },
  );

  it.each(METHOD_CASES)(
    'handles non-2xx response for $methodName',
    async ({ call, expectsThrow, fallback, methodName }) => {
      const logger = { warn: vi.fn() };
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ error: 'bad' }, 503));
      const port = createPort({ fetchFn, logger });

      if (expectsThrow) {
        await expect(call(port)).rejects.toThrow('503');
      } else {
        await expect(call(port)).resolves.toEqual(fallback);
      }

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(methodName));
    },
  );

  it.each(METHOD_CASES)(
    'handles request timeout for $methodName',
    async ({ call, expectsThrow, fallback, methodName }) => {
      const logger = { warn: vi.fn() };
      const fetchFn = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }) as Promise<Response>,
      );
      const port = createPort({
        fetchFn,
        logger,
        timeoutMs: TEST_TIMEOUT_MS,
      });

      if (expectsThrow) {
        await expect(call(port)).rejects.toThrow('timed out');
      } else {
        await expect(call(port)).resolves.toEqual(fallback);
      }

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(methodName));
    },
  );

  it('factory creates an HttpControlPlaneSyncPort with logger wiring', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse(SUCCESS_RESPONSES.pullPolicies));
    const logger = { warn: vi.fn() };
    const port = createHttpControlPlaneSyncPort(TEST_CONFIG, logger, {
      fetchFn,
      environment: {
        [TOKEN_ENV]: TOKEN_VALUE,
      },
    });

    const result = await port.pullPolicies(REQUEST_INPUTS.pullPolicies);
    expect(result).toEqual(SUCCESS_RESPONSES.pullPolicies);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
