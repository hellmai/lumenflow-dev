import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { WORKSPACE_FILE_NAME, type WorkspaceSpec } from '@lumenflow/kernel';
import {
  ValidationErrorCode,
  sanitizePath,
  validateBodySize,
  validateCsrfOrigin,
  validatePathWithinRoot,
} from '../../../../src/server/input-validation';

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' } as const;
const DEFAULT_ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const ALLOWED_ORIGINS = [DEFAULT_ALLOWED_ORIGIN];
const MAX_BODY_SIZE = 64 * 1024;
const UTF8_ENCODING = 'utf-8';
const ERROR_INTERNAL = 'Internal server error';
const ERROR_WORKSPACE_ROOT_REQUIRED = 'workspaceRoot is required';
const ERROR_PROJECT_NAME_REQUIRED = 'projectName is required';
const DEFAULT_WORKSPACE_ID = 'workspace';
const DEFAULT_LANE_ID = 'default';
const DEFAULT_LANE_TITLE = 'Default';
const DEFAULT_NETWORK_PROFILE = 'off' as const;
const YAML_HEADER_COMMENT = '# LumenFlow Workspace Configuration\n';
const DEFAULT_DENY_OVERLAYS = ['~/.ssh', '~/.aws', '~/.gnupg', '.env'] as const;

interface CreateWorkspaceRequestBody {
  readonly workspaceRoot?: unknown;
  readonly projectName?: unknown;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_CONTENT_TYPE,
  });
}

function getAllowedWorkspaceRoot(): string {
  const configuredRoot = process.env.LUMENFLOW_WEB_WORKSPACE_ROOT ?? process.cwd();
  return path.resolve(configuredRoot);
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function buildWorkspaceSpec(projectName: string): WorkspaceSpec {
  const workspaceId = toKebabCase(projectName) || DEFAULT_WORKSPACE_ID;

  return {
    id: workspaceId,
    name: projectName,
    packs: [],
    lanes: [
      {
        id: DEFAULT_LANE_ID,
        title: DEFAULT_LANE_TITLE,
        allowed_scopes: [],
      },
    ],
    policies: {},
    security: {
      allowed_scopes: [],
      network_default: DEFAULT_NETWORK_PROFILE,
      deny_overlays: [...DEFAULT_DENY_OVERLAYS],
    },
    memory_namespace: workspaceId,
    event_namespace: workspaceId,
  };
}

function generateWorkspaceYaml(spec: WorkspaceSpec): string {
  return `${YAML_HEADER_COMMENT}${YAML.stringify(spec)}`;
}

/**
 * POST /api/workspace/create
 *
 * Creates workspace.yaml for the requested workspace root if it does not exist.
 * Request paths are constrained to LUMENFLOW_WEB_WORKSPACE_ROOT.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const csrfResult = validateCsrfOrigin(request, ALLOWED_ORIGINS);
    if (!csrfResult.valid) {
      return jsonResponse(
        {
          success: false,
          code: csrfResult.code,
          error: csrfResult.message,
        },
        HTTP_STATUS.FORBIDDEN,
      );
    }

    const bodySizeResult = validateBodySize(request, MAX_BODY_SIZE);
    if (!bodySizeResult.valid) {
      return jsonResponse(
        {
          success: false,
          code: bodySizeResult.code,
          error: bodySizeResult.message,
        },
        HTTP_STATUS.PAYLOAD_TOO_LARGE,
      );
    }

    const body = (await request.json()) as CreateWorkspaceRequestBody;

    if (typeof body.workspaceRoot !== 'string' || body.workspaceRoot.trim().length === 0) {
      return jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: ERROR_WORKSPACE_ROOT_REQUIRED,
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    if (typeof body.projectName !== 'string' || body.projectName.trim().length === 0) {
      return jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: ERROR_PROJECT_NAME_REQUIRED,
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const allowedRoot = getAllowedWorkspaceRoot();
    const rootValidation = validatePathWithinRoot(body.workspaceRoot, allowedRoot);
    if (!rootValidation.valid) {
      return jsonResponse(
        {
          success: false,
          code: rootValidation.code,
          error: rootValidation.message,
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const workspaceRoot = sanitizePath(body.workspaceRoot, allowedRoot);
    const workspaceYamlPath = path.join(workspaceRoot, WORKSPACE_FILE_NAME);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspaceRoot is constrained by sanitizePath against allowed root
    if (existsSync(workspaceYamlPath)) {
      return jsonResponse(
        {
          success: true,
          created: false,
          existing: true,
          workspaceRoot,
        },
        HTTP_STATUS.OK,
      );
    }

    const workspaceSpec = buildWorkspaceSpec(body.projectName.trim());
    const workspaceYaml = generateWorkspaceYaml(workspaceSpec);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspaceRoot is constrained by sanitizePath against allowed root
    await mkdir(workspaceRoot, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspaceRoot is constrained by sanitizePath against allowed root
    await writeFile(workspaceYamlPath, workspaceYaml, UTF8_ENCODING);

    return jsonResponse(
      {
        success: true,
        created: true,
        existing: false,
        workspaceRoot,
      },
      HTTP_STATUS.CREATED,
    );
  } catch {
    return jsonResponse(
      {
        success: false,
        error: ERROR_INTERNAL,
      },
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  }
}
