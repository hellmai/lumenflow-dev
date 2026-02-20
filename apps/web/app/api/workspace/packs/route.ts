import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  DomainPackManifestSchema,
  WORKSPACE_FILE_NAME,
  WorkspaceSpecSchema,
  type DomainPackManifest,
  type PackPin,
} from '@lumenflow/kernel';
import type {
  PackCatalogEntry,
  PackPolicyView,
  PackToolView,
} from '../../../../src/lib/pack-catalog-types';
import { handleWorkspacePacks } from '../../../../src/server/workspace-connect-handler';

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' } as const;

const PACKS_DIRECTORY_NAME = 'packs';
const PACK_MANIFEST_FILE_NAME = 'manifest.yaml';
const UTF8_ENCODING = 'utf-8';
const ERROR_INTERNAL = 'Internal server error';

function toPackToolView(tools: DomainPackManifest['tools']): PackToolView[] {
  return tools.map((tool) => ({
    name: tool.name,
    permission: tool.permission,
    scopes: tool.required_scopes.map((scope) =>
      scope.type === 'path'
        ? {
            type: scope.type,
            pattern: scope.pattern,
            access: scope.access,
          }
        : {
            type: scope.type,
          },
    ),
  }));
}

function toPackPolicyView(policies: DomainPackManifest['policies']): PackPolicyView[] {
  return policies.map((policy) => ({
    id: policy.id,
    trigger: policy.trigger,
    decision: policy.decision,
    reason: policy.reason,
  }));
}

function buildFallbackCatalogEntry(pin: PackPin): PackCatalogEntry {
  return {
    id: pin.id,
    version: pin.version,
    source: pin.source,
    integrity: pin.integrity,
    tools: [],
    policies: [],
    taskTypes: [],
    evidenceTypes: [],
  };
}

async function buildWorkspacePackCatalogEntry(
  workspaceRoot: string,
  pin: PackPin,
): Promise<PackCatalogEntry> {
  const fallback = buildFallbackCatalogEntry(pin);
  const manifestPath = path.join(
    workspaceRoot,
    PACKS_DIRECTORY_NAME,
    pin.id,
    PACK_MANIFEST_FILE_NAME,
  );

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace root and pack id are validated before this route reads files
    const manifestRaw = await readFile(manifestPath, UTF8_ENCODING);
    const manifest = DomainPackManifestSchema.parse(YAML.parse(manifestRaw));

    return {
      ...fallback,
      tools: toPackToolView(manifest.tools),
      policies: toPackPolicyView(manifest.policies),
      taskTypes: manifest.task_types,
      evidenceTypes: manifest.evidence_types,
    };
  } catch {
    // Manifest load failures should not hide the workspace pin itself.
    return fallback;
  }
}

async function loadWorkspacePacks(workspaceRoot: string): Promise<readonly PackCatalogEntry[]> {
  const workspaceFilePath = path.join(workspaceRoot, WORKSPACE_FILE_NAME);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace root is validated before file read
  const workspaceRaw = await readFile(workspaceFilePath, UTF8_ENCODING);
  const workspaceSpec = WorkspaceSpecSchema.parse(YAML.parse(workspaceRaw));

  const entries = await Promise.all(
    workspaceSpec.packs.map((pin) => buildWorkspacePackCatalogEntry(workspaceRoot, pin)),
  );

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * GET /api/workspace/packs?workspaceRoot=/abs/path
 *
 * Returns workspace-loaded pack metadata for the connected workspace.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const result = await handleWorkspacePacks(url.searchParams, loadWorkspacePacks);
    const status = result.success ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST;

    return new Response(JSON.stringify(result), {
      status,
      headers: JSON_CONTENT_TYPE,
    });
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: ERROR_INTERNAL,
      }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: JSON_CONTENT_TYPE,
      },
    );
  }
}
