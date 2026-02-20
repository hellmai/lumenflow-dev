/**
 * Server-side handler for workspace connection (WU-1822, WU-1921).
 *
 * Pure functions for parsing, validating, and handling workspace
 * connect requests. Decoupled from Next.js route infrastructure.
 *
 * WU-1921: Path safety — workspaceRoot is validated to prevent
 * path traversal (null bytes, ../ sequences).
 */

import type { WorkspaceInfo } from '../lib/workspace-connection-types';
import { ValidationErrorCode } from './input-validation';

const ERROR_WORKSPACE_ROOT_REQUIRED = 'workspaceRoot is required and must be a non-empty string.';
const ERROR_PATH_TRAVERSAL = `${ValidationErrorCode.PATH_TRAVERSAL}: workspaceRoot contains path traversal sequences`;
const ERROR_NULL_BYTES = `${ValidationErrorCode.PATH_TRAVERSAL}: workspaceRoot contains null bytes`;
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

  // WU-1921: Reject null bytes (poison null byte attack)
  if (workspaceRoot.includes('\0')) {
    return { success: false, error: ERROR_NULL_BYTES };
  }

  // WU-1921: Reject path traversal sequences
  // Normalize and check for .. components that could escape
  if (workspaceRoot.includes('..')) {
    return { success: false, error: ERROR_PATH_TRAVERSAL };
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

  // WU-1921: Additional path safety check at handler level
  // Reject null bytes that might have been encoded differently
  if (parsed.workspaceRoot.includes('\0')) {
    return { success: false, error: ERROR_NULL_BYTES };
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
