/**
 * Server-side handler for workspace connection (WU-1822).
 *
 * Pure functions for parsing, validating, and handling workspace
 * connect requests. Decoupled from Next.js route infrastructure.
 */

import type { WorkspaceInfo } from '../lib/workspace-connection-types';

const ERROR_WORKSPACE_ROOT_REQUIRED = 'workspaceRoot is required and must be a non-empty string.';
const ERROR_INITIALIZATION_PREFIX = 'Failed to initialize workspace';

/* ------------------------------------------------------------------
 * Request parsing
 * ------------------------------------------------------------------ */

interface ParseSuccess {
  readonly success: true;
  readonly workspaceRoot: string;
}

interface ParseFailure {
  readonly success: false;
  readonly error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseWorkspaceConnectRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { success: false, error: ERROR_WORKSPACE_ROOT_REQUIRED };
  }

  const record = body as Record<string, unknown>;
  const workspaceRoot = record.workspaceRoot;

  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    return { success: false, error: ERROR_WORKSPACE_ROOT_REQUIRED };
  }

  return { success: true, workspaceRoot };
}

/* ------------------------------------------------------------------
 * Workspace info extraction
 * ------------------------------------------------------------------ */

interface MinimalWorkspaceSpec {
  readonly id: string;
  readonly name: string;
  readonly packs: readonly { readonly id: string }[];
  readonly lanes: readonly { readonly id: string }[];
}

export function buildWorkspaceInfoFromSpec(
  spec: MinimalWorkspaceSpec,
  workspaceRoot: string,
): WorkspaceInfo {
  return {
    workspaceName: spec.name,
    workspaceId: spec.id,
    packCount: spec.packs.length,
    laneCount: spec.lanes.length,
    workspaceRoot,
  };
}

/* ------------------------------------------------------------------
 * Connect handler
 * ------------------------------------------------------------------ */

interface ConnectSuccess {
  readonly success: true;
  readonly workspace: WorkspaceInfo;
}

interface ConnectFailure {
  readonly success: false;
  readonly error: string;
}

export type ConnectResult = ConnectSuccess | ConnectFailure;

/**
 * The runtime initializer function signature.
 * Injected to keep the handler testable without importing kernel directly.
 */
export type RuntimeInitializer = (options: {
  workspaceRoot: string;
}) => Promise<{ workspace_spec: MinimalWorkspaceSpec }>;

/**
 * Handles a workspace connect request.
 *
 * 1. Parses and validates the request body.
 * 2. Initializes the kernel runtime with the given workspace root.
 * 3. Extracts workspace info from the runtime's workspace spec.
 */
export async function handleWorkspaceConnect(
  body: unknown,
  initializeRuntime: RuntimeInitializer,
): Promise<ConnectResult> {
  const parsed = parseWorkspaceConnectRequest(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }

  try {
    const runtime = await initializeRuntime({
      workspaceRoot: parsed.workspaceRoot,
    });

    const workspaceInfo = buildWorkspaceInfoFromSpec(runtime.workspace_spec, parsed.workspaceRoot);

    return { success: true, workspace: workspaceInfo };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${ERROR_INITIALIZATION_PREFIX}: unknown error`;

    return { success: false, error: message };
  }
}
