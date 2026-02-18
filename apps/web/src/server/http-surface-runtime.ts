import {
  initializeKernelRuntime,
  type Disposable,
  type KernelEvent,
  type KernelRuntime,
  type ReplayFilter,
} from '@lumenflow/kernel';
import {
  createHttpSurface,
  type HttpSurface,
} from '../../../../packages/@lumenflow/surfaces/http/server';

const ENVIRONMENT_KEY = {
  ENABLE_RUNTIME: 'LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME',
  WORKSPACE_ROOT: 'LUMENFLOW_WEB_WORKSPACE_ROOT',
} as const;

const ENVIRONMENT_VALUE = {
  TRUE: '1',
} as const;

const ERROR_MESSAGE = {
  RUNTIME_UNAVAILABLE: 'Kernel runtime unavailable in web app preview mode.',
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

let httpSurfacePromise: Promise<HttpSurface> | null = null;

function createRuntimeUnavailableError(): Error {
  return new Error(ERROR_MESSAGE.RUNTIME_UNAVAILABLE);
}

function createPreviewRuntime(): KernelRuntimeWithEventSubscription {
  return {
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
    getToolHost: () => {
      throw createRuntimeUnavailableError();
    },
    getPolicyEngine: () => {
      throw createRuntimeUnavailableError();
    },
    subscribeEvents: () => NOOP_DISPOSABLE,
  } as KernelRuntimeWithEventSubscription;
}

function isRuntimeInitializationEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment[ENVIRONMENT_KEY.ENABLE_RUNTIME] === ENVIRONMENT_VALUE.TRUE;
}

function resolveWorkspaceRoot(environment: NodeJS.ProcessEnv): string {
  return environment[ENVIRONMENT_KEY.WORKSPACE_ROOT] ?? process.cwd();
}

async function createRuntimeForWeb(): Promise<KernelRuntimeWithEventSubscription> {
  if (!isRuntimeInitializationEnabled(process.env)) {
    return createPreviewRuntime();
  }

  try {
    const runtime = await initializeKernelRuntime({
      workspaceRoot: resolveWorkspaceRoot(process.env),
    });
    return runtime as KernelRuntimeWithEventSubscription;
  } catch {
    return createPreviewRuntime();
  }
}

async function createWebHttpSurface(): Promise<HttpSurface> {
  const runtime = await createRuntimeForWeb();
  return createHttpSurface(runtime);
}

export async function getHttpSurfaceForWeb(): Promise<HttpSurface> {
  if (!httpSurfacePromise) {
    httpSurfacePromise = createWebHttpSurface();
  }
  return httpSurfacePromise;
}
