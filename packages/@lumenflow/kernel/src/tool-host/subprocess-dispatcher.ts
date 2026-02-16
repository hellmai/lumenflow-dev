import type { ExecutionContext, ToolCapability, ToolOutput, ToolScope } from '../kernel.schemas.js';

export interface SubprocessDispatchRequest {
  capability: ToolCapability;
  input: unknown;
  context: ExecutionContext;
  scopeEnforced: ToolScope[];
}

export interface SubprocessDispatcher {
  dispatch(request: SubprocessDispatchRequest): Promise<ToolOutput>;
}

export class DefaultSubprocessDispatcher implements SubprocessDispatcher {
  async dispatch(): Promise<ToolOutput> {
    return {
      success: false,
      error: {
        code: 'SUBPROCESS_NOT_AVAILABLE',
        message: 'Subprocess execution is not yet available until WU-1730.',
      },
    };
  }
}
