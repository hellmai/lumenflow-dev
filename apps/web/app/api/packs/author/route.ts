import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PACK_MANIFEST_FILE_NAME, UTF8_ENCODING } from '@lumenflow/kernel';
import {
  ValidationErrorCode,
  sanitizeRelativePath,
  sanitizePath,
  validateBodySize,
  validateCsrfOrigin,
  validatePathInput,
  validatePathWithinRoot,
} from '../../../../src/server/input-validation';
import {
  PackAuthoringRequestSchema,
  generatePackAuthoringArtifacts,
} from '../../../../src/server/pack-authoring-template-engine';

const HTTP_STATUS = {
  CREATED: 201,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' } as const;
const DEFAULT_ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const ALLOWED_ORIGINS = [DEFAULT_ALLOWED_ORIGIN];
const DEFAULT_OUTPUT_DIR = 'packs';
const MAX_BODY_SIZE = 256 * 1024;
const ERROR_INTERNAL = 'Internal server error';
const ERROR_WORKSPACE_ROOT_REQUIRED = 'workspaceRoot is required';
const ERROR_REQUEST_REQUIRED = 'request payload is required';
const ERROR_OUTPUT_DIR_INVALID = 'outputDir must be a non-empty string when provided';
const ERROR_PACK_EXISTS = 'Pack directory already exists. Use force=true to overwrite.';

interface PackAuthorRequestBody {
  readonly workspaceRoot?: unknown;
  readonly outputDir?: unknown;
  readonly request?: unknown;
  readonly force?: unknown;
}

interface ParseSuccess {
  readonly ok: true;
  readonly value: string;
}

interface ParseFailure {
  readonly ok: false;
  readonly response: Response;
}

type ParseResult = ParseSuccess | ParseFailure;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_CONTENT_TYPE,
  });
}

function getAllowedWorkspaceRoot(): string {
  const configured = process.env.LUMENFLOW_WEB_WORKSPACE_ROOT ?? process.cwd();
  return path.resolve(configured);
}

function parseWorkspaceRoot(value: unknown, allowedRoot: string): ParseResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: ERROR_WORKSPACE_ROOT_REQUIRED,
        },
        HTTP_STATUS.BAD_REQUEST,
      ),
    };
  }

  const rootValidation = validatePathWithinRoot(value, allowedRoot);
  if (!rootValidation.valid) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          code: rootValidation.code,
          error: rootValidation.message,
        },
        HTTP_STATUS.BAD_REQUEST,
      ),
    };
  }

  return {
    ok: true,
    value: sanitizePath(value, allowedRoot),
  };
}

function parseOutputDir(value: unknown, workspaceRoot: string): ParseResult {
  if (value === undefined) {
    return {
      ok: true,
      value: path.resolve(workspaceRoot, DEFAULT_OUTPUT_DIR),
    };
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: ERROR_OUTPUT_DIR_INVALID,
        },
        HTTP_STATUS.BAD_REQUEST,
      ),
    };
  }

  const pathValidation = validatePathInput(value);
  if (!pathValidation.valid) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          code: pathValidation.code,
          error: pathValidation.message,
        },
        HTTP_STATUS.BAD_REQUEST,
      ),
    };
  }

  const withinWorkspace = validatePathWithinRoot(value, workspaceRoot);
  if (!withinWorkspace.valid) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          code: withinWorkspace.code,
          error: withinWorkspace.message,
        },
        HTTP_STATUS.BAD_REQUEST,
      ),
    };
  }

  return {
    ok: true,
    value: sanitizePath(value, workspaceRoot),
  };
}

/**
 * POST /api/packs/author
 *
 * Creates secure template-based pack artifacts under a root-constrained workspace path.
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

    const body = (await request.json()) as PackAuthorRequestBody;
    if (!body || typeof body !== 'object') {
      return jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: ERROR_WORKSPACE_ROOT_REQUIRED,
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    if (body.request === undefined) {
      return jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: ERROR_REQUEST_REQUIRED,
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const allowedRoot = getAllowedWorkspaceRoot();
    const workspaceRootResult = parseWorkspaceRoot(body.workspaceRoot, allowedRoot);
    if (!workspaceRootResult.ok) {
      return workspaceRootResult.response;
    }

    const outputDirResult = parseOutputDir(body.outputDir, workspaceRootResult.value);
    if (!outputDirResult.ok) {
      return outputDirResult.response;
    }

    const parsedRequest = PackAuthoringRequestSchema.parse(body.request);
    const artifacts = generatePackAuthoringArtifacts(parsedRequest);
    const packRoot = path.join(outputDirResult.value, parsedRequest.pack_id);
    const forceOverwrite = body.force === true;

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- packRoot is validated to remain within workspace root
    if (existsSync(packRoot)) {
      if (!forceOverwrite) {
        return jsonResponse(
          {
            success: false,
            error: ERROR_PACK_EXISTS,
          },
          HTTP_STATUS.CONFLICT,
        );
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- packRoot is validated to remain within workspace root
      await rm(packRoot, { recursive: true, force: true });
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- packRoot is validated to remain within workspace root
    await mkdir(packRoot, { recursive: true });
    const manifestPath = path.join(packRoot, PACK_MANIFEST_FILE_NAME);
    const filesCreated = [manifestPath];

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- manifestPath is constrained by workspace-root path validation
    await writeFile(manifestPath, artifacts.manifest_yaml, UTF8_ENCODING);

    const sortedEntries = Object.entries(artifacts.files).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    for (const [relativeFilePath, fileContent] of sortedEntries) {
      const absoluteFilePath = sanitizeRelativePath(relativeFilePath, packRoot);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- generated file path is validated relative to packRoot
      await mkdir(path.dirname(absoluteFilePath), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- generated file path is validated relative to packRoot
      await writeFile(absoluteFilePath, fileContent, UTF8_ENCODING);
      filesCreated.push(absoluteFilePath);
    }

    return jsonResponse(
      {
        success: true,
        packId: parsedRequest.pack_id,
        version: parsedRequest.version,
        outputRoot: packRoot,
        filesCreated,
        toolCount: parsedRequest.templates.length,
        policyCount: 0,
      },
      HTTP_STATUS.CREATED,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return jsonResponse(
        {
          success: false,
          code: ValidationErrorCode.INVALID_PATH,
          error: error.message,
        },
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    return jsonResponse(
      {
        success: false,
        error: ERROR_INTERNAL,
      },
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
    );
  }
}
