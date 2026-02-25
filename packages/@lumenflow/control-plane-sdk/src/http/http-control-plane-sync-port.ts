// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import type {
  AcceptedCount,
  AuthenticateInput,
  ControlPlaneIdentity,
  ControlPlanePolicySet,
  ControlPlaneSyncPort,
  HeartbeatInput,
  HeartbeatResult,
  PullConfigInput,
  PullPoliciesInput,
  PushEvidenceInput,
  PushKernelEventsInput,
  PushTelemetryInput,
  WorkspaceControlPlaneConfig,
  WorkspaceControlPlaneSpec,
} from '../sync-port.js';

const API_PATH = {
  AUTHENTICATE: '/api/v1/authenticate',
  HEARTBEAT: '/api/v1/heartbeat',
  EVENTS: '/api/v1/events',
  EVIDENCE: '/api/v1/evidence',
  TELEMETRY: '/api/v1/telemetry',
  POLICIES: '/api/v1/policies',
  CONFIG: '/api/v1/config',
} as const;

const HTTP = {
  METHOD_POST: 'POST',
  HEADER_AUTHORIZATION: 'authorization',
  HEADER_CONTENT_TYPE: 'content-type',
  CONTENT_TYPE_JSON: 'application/json',
} as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const TIMEOUT_ERROR_PREFIX = 'request timed out after';

export interface HttpControlPlaneSyncPortOptions {
  fetchFn?: typeof fetch;
  logger?: Pick<Console, 'warn'>;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

export interface CreateHttpControlPlaneSyncPortOptions
  extends Omit<HttpControlPlaneSyncPortOptions, 'logger'> {
  logger?: Pick<Console, 'warn'>;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, endpoint.length - 1) : endpoint;
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function describeError(error: unknown): string {
  return asError(error).message;
}

function cloneControlPlaneConfig(config: WorkspaceControlPlaneConfig): WorkspaceControlPlaneConfig {
  return {
    ...config,
    auth: {
      ...config.auth,
    },
  };
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export class HttpControlPlaneSyncPort implements ControlPlaneSyncPort {
  private readonly config: WorkspaceControlPlaneConfig;
  private readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly logger?: Pick<Console, 'warn'>;

  public constructor(config: WorkspaceControlPlaneConfig, options: HttpControlPlaneSyncPortOptions = {}) {
    this.config = cloneControlPlaneConfig(config);
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const environment = options.environment ?? process.env;
    const rawToken = environment[config.auth.token_env];
    this.token = typeof rawToken === 'string' ? rawToken.trim() : '';

    if (this.token.length === 0) {
      this.warn(`Missing auth token in env "${config.auth.token_env}". Requests may fail.`);
    }
  }

  public async pullPolicies(input: PullPoliciesInput): Promise<ControlPlanePolicySet> {
    try {
      return await this.postJson<ControlPlanePolicySet>(API_PATH.POLICIES, input);
    } catch (error) {
      this.warnFailure('pullPolicies', error);
      throw error;
    }
  }

  public async pullConfig(input: PullConfigInput): Promise<WorkspaceControlPlaneSpec> {
    try {
      return await this.postJson<WorkspaceControlPlaneSpec>(API_PATH.CONFIG, input);
    } catch (error) {
      this.warnFailure('pullConfig', error);
      return {
        id: input.workspace_id,
        control_plane: cloneControlPlaneConfig(this.config),
      };
    }
  }

  public async pushTelemetry(input: PushTelemetryInput): Promise<AcceptedCount> {
    try {
      return await this.postJson<AcceptedCount>(API_PATH.TELEMETRY, input);
    } catch (error) {
      this.warnFailure('pushTelemetry', error);
      return { accepted: 0 };
    }
  }

  public async pushEvidence(input: PushEvidenceInput): Promise<AcceptedCount> {
    try {
      return await this.postJson<AcceptedCount>(API_PATH.EVIDENCE, input);
    } catch (error) {
      this.warnFailure('pushEvidence', error);
      return { accepted: 0 };
    }
  }

  public async pushKernelEvents(input: PushKernelEventsInput): Promise<AcceptedCount> {
    try {
      return await this.postJson<AcceptedCount>(API_PATH.EVENTS, input);
    } catch (error) {
      this.warnFailure('pushKernelEvents', error);
      throw error;
    }
  }

  public async authenticate(input: AuthenticateInput): Promise<ControlPlaneIdentity> {
    try {
      return await this.postJson<ControlPlaneIdentity>(API_PATH.AUTHENTICATE, input);
    } catch (error) {
      this.warnFailure('authenticate', error);
      return {
        workspace_id: input.workspace_id,
        org_id: input.org_id,
        agent_id: input.agent_id,
        token: '',
      };
    }
  }

  public async heartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
    try {
      return await this.postJson<HeartbeatResult>(API_PATH.HEARTBEAT, input);
    } catch (error) {
      this.warnFailure('heartbeat', error);
      throw error;
    }
  }

  private warn(message: string): void {
    this.logger?.warn?.(`[control-plane] ${message}`);
  }

  private warnFailure(operation: string, error: unknown): void {
    this.warn(`${operation} failed: ${describeError(error)}`);
  }

  private getHeaders(): Record<string, string> {
    return {
      [HTTP.HEADER_AUTHORIZATION]: `Bearer ${this.token}`,
      [HTTP.HEADER_CONTENT_TYPE]: HTTP.CONTENT_TYPE_JSON,
    };
  }

  private async postJson<Result>(apiPath: string, payload: unknown): Promise<Result> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(`${this.endpoint}${apiPath}`, {
        method: HTTP.METHOD_POST,
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await safeResponseText(response);
        const suffix = responseText.length > 0 ? `: ${responseText}` : '';
        throw new Error(`HTTP ${response.status}${suffix}`);
      }

      return (await response.json()) as Result;
    } catch (error) {
      const parsedError = asError(error);
      if (parsedError.name === 'AbortError') {
        throw new Error(`${TIMEOUT_ERROR_PREFIX} ${this.timeoutMs}ms`);
      }
      throw parsedError;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createHttpControlPlaneSyncPort(
  config: WorkspaceControlPlaneConfig,
  logger?: Pick<Console, 'warn'>,
  options: CreateHttpControlPlaneSyncPortOptions = {},
): HttpControlPlaneSyncPort {
  return new HttpControlPlaneSyncPort(config, {
    ...options,
    logger: options.logger ?? logger,
  });
}
