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
import type { PackCatalogEntry } from '../lib/pack-catalog-types';
import {
  ValidationErrorCode,
  type ValidationErrorCodeType,
  validatePathInput,
} from './input-validation';

const ERROR_WORKSPACE_ROOT_REQUIRED = 'workspaceRoot is required and must be a non-empty string.';
const ERROR_WORKSPACE_ROOT_QUERY_REQUIRED =
  'workspaceRoot query parameter is required and must be a non-empty string.';
const ERROR_INITIALIZATION_PREFIX = 'Failed to initialize workspace';
const ERROR_PACKS_LOAD_PREFIX = 'Failed to load workspace packs';
const WORKSPACE_ROOT_QUERY_PARAM = 'workspaceRoot';

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
  readonly code?: ValidationErrorCodeType;
}

export type ParseResult = ParseSuccess | ParseFailure;

function parseWorkspaceRootInput(value: unknown, requiredError: string): ParseResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { success: false, error: requiredError };
  }

  const pathValidation = validatePathInput(value);
  if (!pathValidation.valid) {
    return {
      success: false,
      code: pathValidation.code,
      error: `${ValidationErrorCode.PATH_TRAVERSAL}: ${pathValidation.message}`,
    };
  }

  return { success: true, workspaceRoot: value };
}

export function parseWorkspaceConnectRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { success: false, error: ERROR_WORKSPACE_ROOT_REQUIRED };
  }

  const record = body as Record<string, unknown>;
  return parseWorkspaceRootInput(record.workspaceRoot, ERROR_WORKSPACE_ROOT_REQUIRED);
}

export function parseWorkspacePacksRequest(searchParams: URLSearchParams): ParseResult {
  const workspaceRoot = searchParams.get(WORKSPACE_ROOT_QUERY_PARAM);
  return parseWorkspaceRootInput(workspaceRoot, ERROR_WORKSPACE_ROOT_QUERY_REQUIRED);
}

/* ------------------------------------------------------------------
 * Workspace packs handler
 * ------------------------------------------------------------------ */

interface WorkspacePacksSuccess {
  readonly success: true;
  readonly packs: readonly PackCatalogEntry[];
}

interface WorkspacePacksFailure {
  readonly success: false;
  readonly error: string;
  readonly code?: ValidationErrorCodeType;
}

export type WorkspacePacksResult = WorkspacePacksSuccess | WorkspacePacksFailure;

export type WorkspacePacksLoader = (workspaceRoot: string) => Promise<readonly PackCatalogEntry[]>;

export async function handleWorkspacePacks(
  searchParams: URLSearchParams,
  loadWorkspacePacks: WorkspacePacksLoader,
): Promise<WorkspacePacksResult> {
  const parsed = parseWorkspacePacksRequest(searchParams);
  if (!parsed.success) {
    return { success: false, error: parsed.error, code: parsed.code };
  }

  try {
    const packs = await loadWorkspacePacks(parsed.workspaceRoot);
    return { success: true, packs };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${ERROR_PACKS_LOAD_PREFIX}: unknown error`;
    return { success: false, error: message };
  }
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

  const pathValidation = validatePathInput(parsed.workspaceRoot);
  if (!pathValidation.valid) {
    return {
      success: false,
      error: `${ValidationErrorCode.PATH_TRAVERSAL}: ${pathValidation.message}`,
    };
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
