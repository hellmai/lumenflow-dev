import path from 'node:path';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import {
  initializeKernelRuntime,
  type Disposable,
  type KernelEvent,
  type KernelRuntime,
  type ReplayFilter,
} from '@lumenflow/kernel';
import {
  createHttpControlPlaneSyncPort,
  parseWorkspaceControlPlaneConfig,
  type WorkspaceControlPlaneConfig,
} from '../../../../packages/@lumenflow/control-plane-sdk/src/index';
import {
  createHttpSurface,
  type HttpSurface,
  type HttpSurfaceOptions,
} from '../../../../packages/@lumenflow/surfaces/http/server';

const ENVIRONMENT_KEY = {
  ENABLE_RUNTIME: 'LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME',
  RUNTIME_WORKSPACE_ROOT: 'LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT',
  WORKSPACE_ROOT: 'LUMENFLOW_WEB_WORKSPACE_ROOT',
} as const;

const ENVIRONMENT_VALUE = {
  TRUE: '1',
} as const;

const WORKSPACE_FILE_NAME = 'workspace.yaml';
const UTF8_ENCODING = 'utf8';
const WORKSPACE_ID_FIELD = 'id';
const CONTROL_PLANE_FIELD = 'control_plane';
const CONTROL_PLANE_AUTH_FIELD = 'auth';
const CONTROL_PLANE_ENDPOINT_FIELD = 'endpoint';
const CONTROL_PLANE_TOKEN_ENV_FIELD = 'token_env';
const CONTROL_PLANE_TOKEN_ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MILLISECONDS_PER_SECOND = 1000;
const CONTROL_PLANE_LOG_PREFIX = '[http-surface-runtime]';

const ERROR_MESSAGE = {
  RUNTIME_UNAVAILABLE:
    'Kernel runtime unavailable in web app preview mode. Set LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME=1 and LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT=/absolute/workspace/path (or fallback LUMENFLOW_WEB_WORKSPACE_ROOT=/absolute/path) in .env.local, then restart the web server.',
  RUNTIME_INIT_UNKNOWN: 'Unknown runtime initialization error.',
} as const;

const CONTROL_PLANE_STATE = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;

const CONTROL_PLANE_MESSAGE = {
  CONNECTED: 'Cloud control plane is connected and ready.',
  DISCONNECTED: 'Cloud control plane is disconnected.',
  NOT_CONFIGURED: 'No control_plane block found in workspace.yaml.',
} as const;

const CONTROL_PLANE_GUIDANCE = {
  ENABLE_RUNTIME:
    'Enable runtime mode by setting LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME=1 in .env.local.',
  RUNTIME_WORKSPACE_ROOT:
    'Set LUMENFLOW_WEB_RUNTIME_WORKSPACE_ROOT=/absolute/workspace/path (or LUMENFLOW_WEB_WORKSPACE_ROOT) in .env.local.',
  ADD_CONTROL_PLANE_BLOCK:
    'Add a control_plane block to workspace.yaml with endpoint, org_id, project_id, sync_interval, policy_mode, and auth.token_env.',
  VALIDATE_ENDPOINT: 'Validate control_plane.endpoint is present and uses a secure URL.',
  VALIDATE_TOKEN_ENV:
    'Validate control_plane.auth.token_env is present and uses uppercase env var naming.',
  SET_TOKEN_ENV: (tokenEnv: string) =>
    `Set ${tokenEnv} in the runtime environment before starting the web server.`,
} as const;

const NOOP_DISPOSABLE: Disposable = {
  dispose: () => {
    // noop
  },
};

type KernelRuntimeWithEventSubscription = KernelRuntime & {
  subscribeEvents?: (
    filter: ReplayFilter,
    callback: (event: KernelEvent) => void | Promise<void>,
  ) => Disposable;
};

type PreviewRuntimeTagged = {
  readonly __lumenflowPreviewRuntime: true;
};

interface WorkspaceControlPlaneConfigLike {
  readonly endpoint?: string;
  readonly auth?: {
    readonly token_env?: string;
  };
}

interface WorkspaceControlPlaneRuntimeOptions {
  readonly workspaceId: string;
  readonly controlPlane: WorkspaceControlPlaneConfig;
}

export interface RuntimeControlPlaneDiagnostics {
  readonly state: (typeof CONTROL_PLANE_STATE)[keyof typeof CONTROL_PLANE_STATE];
  readonly endpoint?: string;
  readonly tokenEnv?: string;
  readonly guidance: readonly string[];
  readonly message: string;
}

export interface KernelRuntimeHealth {
  readonly mode: 'runtime' | 'preview';
  readonly enabled: boolean;
  readonly available: boolean;
  readonly workspaceRoot: string;
  readonly controlPlane: RuntimeControlPlaneDiagnostics;
  readonly message?: string;
  readonly initializationError?: string;
}

let runtimePromise: Promise<KernelRuntimeWithEventSubscription> | null = null;
let httpSurfacePromise: Promise<HttpSurface> | null = null;
let runtimeInitializationError: string | null = null;

function createRuntimeUnavailableError(): Error {
  return new Error(ERROR_MESSAGE.RUNTIME_UNAVAILABLE);
}

function createPreviewRuntime(): KernelRuntimeWithEventSubscription {
  return {
    __lumenflowPreviewRuntime: true,
    createTask: async () => {
      throw createRuntimeUnavailableError();
    },
    claimTask: async () => {
      throw createRuntimeUnavailableError();
    },
    blockTask: async () => {
      throw createRuntimeUnavailableError();
    },
    unblockTask: async () => {
      throw createRuntimeUnavailableError();
    },
    completeTask: async () => {
      throw createRuntimeUnavailableError();
    },
    inspectTask: async () => {
      throw createRuntimeUnavailableError();
    },
    executeTool: async () => {
      throw createRuntimeUnavailableError();
    },
    resolveApproval: async () => {
      throw createRuntimeUnavailableError();
    },
    getToolHost: () => {
      throw createRuntimeUnavailableError();
    },
    getPolicyEngine: () => {
      throw createRuntimeUnavailableError();
    },
    subscribeEvents: () => NOOP_DISPOSABLE,
  } as KernelRuntimeWithEventSubscription & PreviewRuntimeTagged;
}

function isRuntimeInitializationEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment[ENVIRONMENT_KEY.ENABLE_RUNTIME] === ENVIRONMENT_VALUE.TRUE;
}

function resolveRuntimeWorkspaceRoot(environment: NodeJS.ProcessEnv): string {
  return (
    environment[ENVIRONMENT_KEY.RUNTIME_WORKSPACE_ROOT] ??
    environment[ENVIRONMENT_KEY.WORKSPACE_ROOT] ??
    process.cwd()
  );
}

function resolveRuntimeInitializationError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return ERROR_MESSAGE.RUNTIME_INIT_UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getRecordValue(record: Record<string, unknown>, key: string): unknown {
  return Reflect.get(record, key);
}

function getEnvironmentValue(environment: NodeJS.ProcessEnv, key: string): unknown {
  return Reflect.get(environment, key);
}

function isRuntimeTokenAvailable(tokenEnv: string, environment: NodeJS.ProcessEnv): boolean {
  const value = getEnvironmentValue(environment, tokenEnv);
  return typeof value === 'string' && value.trim().length > 0;
}

async function readWorkspaceControlPlaneConfig(
  workspaceRoot: string,
): Promise<WorkspaceControlPlaneConfigLike | null> {
  const workspacePath = path.join(workspaceRoot, WORKSPACE_FILE_NAME);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace root is an operator-controlled absolute path
  const workspaceYaml = await readFile(workspacePath, UTF8_ENCODING);
  const parsed = YAML.parse(workspaceYaml) as unknown;

  if (!isRecord(parsed)) {
    return null;
  }

  const controlPlane = getRecordValue(parsed, CONTROL_PLANE_FIELD);
  if (!isRecord(controlPlane)) {
    return null;
  }

  const authRaw = getRecordValue(controlPlane, CONTROL_PLANE_AUTH_FIELD);
  const auth = isRecord(authRaw)
    ? {
        token_env: asNonEmptyString(getRecordValue(authRaw, CONTROL_PLANE_TOKEN_ENV_FIELD)),
      }
    : undefined;

  return {
    endpoint: asNonEmptyString(getRecordValue(controlPlane, CONTROL_PLANE_ENDPOINT_FIELD)),
    auth,
  };
}

async function readWorkspaceControlPlaneRuntimeOptions(
  workspaceRoot: string,
): Promise<WorkspaceControlPlaneRuntimeOptions | null> {
  const workspacePath = path.join(workspaceRoot, WORKSPACE_FILE_NAME);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace root is an operator-controlled absolute path
  const workspaceYaml = await readFile(workspacePath, UTF8_ENCODING);
  const parsed = YAML.parse(workspaceYaml) as unknown;

  if (!isRecord(parsed)) {
    return null;
  }

  const workspaceId = asNonEmptyString(getRecordValue(parsed, WORKSPACE_ID_FIELD));
  if (workspaceId === undefined) {
    return null;
  }

  const controlPlane = getRecordValue(parsed, CONTROL_PLANE_FIELD);
  if (!isRecord(controlPlane)) {
    return null;
  }

  const runtimeConfig = parseWorkspaceControlPlaneConfig({
    id: workspaceId,
    control_plane: controlPlane,
  });

  return {
    workspaceId,
    controlPlane: runtimeConfig.control_plane,
  };
}

function createControlPlaneHttpSurfaceOptions(
  runtimeConfig: WorkspaceControlPlaneRuntimeOptions,
): HttpSurfaceOptions {
  return {
    controlPlaneSyncPort: createHttpControlPlaneSyncPort(runtimeConfig.controlPlane, console),
    workspaceId: runtimeConfig.workspaceId,
    controlPlaneSyncIntervalMs: runtimeConfig.controlPlane.sync_interval * MILLISECONDS_PER_SECOND,
    controlPlaneDiagnosticsLogger: console,
  };
}

async function getControlPlaneDiagnostics(input: {
  enabled: boolean;
  available: boolean;
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
}): Promise<RuntimeControlPlaneDiagnostics> {
  const guidance: string[] = [];

  if (!input.enabled) {
    guidance.push(CONTROL_PLANE_GUIDANCE.ENABLE_RUNTIME);
  }
  if (!input.available) {
    guidance.push(CONTROL_PLANE_GUIDANCE.RUNTIME_WORKSPACE_ROOT);
  }

  let controlPlaneConfig: WorkspaceControlPlaneConfigLike | null = null;
  try {
    controlPlaneConfig = await readWorkspaceControlPlaneConfig(input.workspaceRoot);
  } catch {
    guidance.push(CONTROL_PLANE_GUIDANCE.ADD_CONTROL_PLANE_BLOCK);
  }

  if (controlPlaneConfig === null) {
    if (!guidance.includes(CONTROL_PLANE_GUIDANCE.ADD_CONTROL_PLANE_BLOCK)) {
      guidance.push(CONTROL_PLANE_GUIDANCE.ADD_CONTROL_PLANE_BLOCK);
    }
    return {
      state: CONTROL_PLANE_STATE.DISCONNECTED,
      guidance,
      message: CONTROL_PLANE_MESSAGE.NOT_CONFIGURED,
    };
  }

  const endpoint = controlPlaneConfig.endpoint;
  const tokenEnv = controlPlaneConfig.auth?.token_env;

  if (endpoint === undefined) {
    guidance.push(CONTROL_PLANE_GUIDANCE.VALIDATE_ENDPOINT);
  }

  if (tokenEnv === undefined || !CONTROL_PLANE_TOKEN_ENV_PATTERN.test(tokenEnv)) {
    guidance.push(CONTROL_PLANE_GUIDANCE.VALIDATE_TOKEN_ENV);
  } else if (!isRuntimeTokenAvailable(tokenEnv, input.environment)) {
    guidance.push(CONTROL_PLANE_GUIDANCE.SET_TOKEN_ENV(tokenEnv));
  }

  return {
    state: guidance.length === 0 ? CONTROL_PLANE_STATE.CONNECTED : CONTROL_PLANE_STATE.DISCONNECTED,
    endpoint,
    tokenEnv,
    guidance,
    message:
      guidance.length === 0 ? CONTROL_PLANE_MESSAGE.CONNECTED : CONTROL_PLANE_MESSAGE.DISCONNECTED,
  };
}

async function createRuntimeForWeb(): Promise<KernelRuntimeWithEventSubscription> {
  if (!isRuntimeInitializationEnabled(process.env)) {
    runtimeInitializationError = null;
    return createPreviewRuntime();
  }

  try {
    const runtime = await initializeKernelRuntime({
      workspaceRoot: resolveRuntimeWorkspaceRoot(process.env),
    });
    runtimeInitializationError = null;
    return runtime as KernelRuntimeWithEventSubscription;
  } catch (error) {
    runtimeInitializationError = resolveRuntimeInitializationError(error);
    return createPreviewRuntime();
  }
}

export async function getKernelRuntimeForWeb(): Promise<KernelRuntimeWithEventSubscription> {
  if (!runtimePromise) {
    runtimePromise = createRuntimeForWeb();
  }
  return runtimePromise;
}

function isPreviewRuntime(runtime: KernelRuntimeWithEventSubscription): boolean {
  const runtimeWithMarker = runtime as Partial<PreviewRuntimeTagged>;
  return runtimeWithMarker.__lumenflowPreviewRuntime === true;
}

export async function getKernelRuntimeHealth(): Promise<KernelRuntimeHealth> {
  const enabled = isRuntimeInitializationEnabled(process.env);
  const workspaceRoot = resolveRuntimeWorkspaceRoot(process.env);
  const runtime = await getKernelRuntimeForWeb();
  const previewMode = isPreviewRuntime(runtime);
  const controlPlane = await getControlPlaneDiagnostics({
    enabled,
    available: !previewMode,
    workspaceRoot,
    environment: process.env,
  });
  const includeInitializationError =
    enabled && previewMode && runtimeInitializationError !== null
      ? { initializationError: runtimeInitializationError }
      : {};

  return {
    mode: previewMode ? 'preview' : 'runtime',
    enabled,
    available: !previewMode,
    workspaceRoot,
    controlPlane,
    ...(previewMode ? { message: ERROR_MESSAGE.RUNTIME_UNAVAILABLE } : {}),
    ...includeInitializationError,
  };
}

async function createWebHttpSurface(): Promise<HttpSurface> {
  const runtime = await getKernelRuntimeForWeb();
  const workspaceRoot = resolveRuntimeWorkspaceRoot(process.env);

  try {
    const runtimeConfig = await readWorkspaceControlPlaneRuntimeOptions(workspaceRoot);
    if (runtimeConfig !== null) {
      return createHttpSurface(runtime, createControlPlaneHttpSurfaceOptions(runtimeConfig));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${CONTROL_PLANE_LOG_PREFIX} Control-plane sync disabled: ${message}`);
  }

  return createHttpSurface(runtime);
}

export async function getHttpSurfaceForWeb(): Promise<HttpSurface> {
  if (!httpSurfacePromise) {
    httpSurfacePromise = createWebHttpSurface();
  }
  return httpSurfacePromise;
}
