import {
  SANDBOX_BACKEND_IDS,
  type SandboxBackend,
  type SandboxExecutionPlan,
  type SandboxExecutionRequest,
} from './sandbox-profile.js';

export interface WindowsSandboxBackendOptions {
  commandExists?: (binary: string) => boolean;
}

const WINDOWS_ENFORCEMENT_UNAVAILABLE_REASON =
  'Windows sandbox backend unavailable: write enforcement is not yet available on Windows.';
const WINDOWS_ENFORCEMENT_UNAVAILABLE_WARNING =
  'Running unsandboxed because write enforcement is not yet available on Windows and fallback was explicitly enabled.';

function buildNotImplementedPlan(request: SandboxExecutionRequest): SandboxExecutionPlan {
  if (request.allowUnsandboxedFallback) {
    return {
      backendId: SANDBOX_BACKEND_IDS.WINDOWS,
      enforced: false,
      failClosed: false,
      warning: WINDOWS_ENFORCEMENT_UNAVAILABLE_WARNING,
    };
  }

  return {
    backendId: SANDBOX_BACKEND_IDS.WINDOWS,
    enforced: false,
    failClosed: true,
    reason: WINDOWS_ENFORCEMENT_UNAVAILABLE_REASON,
  };
}

export function createWindowsSandboxBackend(
  _options: WindowsSandboxBackendOptions = {},
): SandboxBackend {
  return {
    id: SANDBOX_BACKEND_IDS.WINDOWS,
    resolveExecution(request: SandboxExecutionRequest): SandboxExecutionPlan {
      return buildNotImplementedPlan(request);
    },
  };
}
