import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { WorkspaceSpecSchema, WORKSPACE_FILE_NAME } from '@lumenflow/kernel';
import { handleWorkspaceConnect } from '../../../../src/server/workspace-connect-handler';
import {
  validateCsrfOrigin,
  validateBodySize,
} from '../../../../src/server/input-validation';

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' };

/**
 * Allowed origins for CSRF checking (WU-1921).
 * In production, this should be loaded from environment configuration.
 */
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
];

/** Maximum request body size for workspace connect: 64 KB. */
const MAX_BODY_SIZE = 64 * 1024;

/**
 * POST /api/workspace/connect
 *
 * Accepts { workspaceRoot: string } and reads the workspace.yaml to extract
 * workspace info (name, packs, lanes). This is a lightweight read-only
 * operation that does not initialize the full kernel runtime.
 *
 * WU-1921: CSRF origin checking and body size limits.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // WU-1921: CSRF origin checking
    const csrfResult = validateCsrfOrigin(request, ALLOWED_ORIGINS);
    if (!csrfResult.valid) {
      return new Response(
        JSON.stringify({ success: false, code: csrfResult.code, error: csrfResult.message }),
        { status: HTTP_STATUS.FORBIDDEN, headers: JSON_CONTENT_TYPE },
      );
    }

    // WU-1921: Body size limit
    const bodySizeResult = validateBodySize(request, MAX_BODY_SIZE);
    if (!bodySizeResult.valid) {
      return new Response(
        JSON.stringify({ success: false, code: bodySizeResult.code, error: bodySizeResult.message }),
        { status: HTTP_STATUS.PAYLOAD_TOO_LARGE, headers: JSON_CONTENT_TYPE },
      );
    }

    const body: unknown = await request.json();

    const result = await handleWorkspaceConnect(body, async (options) => {
      const workspaceFilePath = path.join(options.workspaceRoot, WORKSPACE_FILE_NAME);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace root is user-provided via connect flow; validated by handler
      const raw = await readFile(workspaceFilePath, 'utf-8');
      const parsed = WorkspaceSpecSchema.parse(YAML.parse(raw));

      return {
        workspace_spec: {
          id: parsed.id,
          name: parsed.name,
          packs: parsed.packs,
          lanes: parsed.lanes,
        },
      };
    });

    const statusCode = result.success ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST;

    return new Response(JSON.stringify(result), {
      status: statusCode,
      headers: JSON_CONTENT_TYPE,
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      headers: JSON_CONTENT_TYPE,
    });
  }
}
