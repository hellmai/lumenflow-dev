/**
 * POST /api/registry/packs/:id/versions
 *
 * Publishes a new version of a pack. Requires GitHub OAuth Bearer token.
 *
 * Request: multipart/form-data with fields:
 *   - tarball: the pack .tgz file
 *   - description: pack description text
 *   - version: semver version string
 *
 * Returns 201 on success with the new version metadata.
 * Returns 401 if not authenticated.
 * Returns 400 if tarball is missing.
 */

import {
  getRegistryStore,
  getBlobStore,
  getAuthProvider,
} from '../../../../../../src/server/pack-registry-config';
import { createPublishVersionRoute } from '../../../../../../src/server/pack-registry-route-adapters';
import type { RouteContext } from '../../../../../../src/server/api-route-paths';
import { resolveRouteParams } from '../../../../../../src/server/api-route-paths';

const publishVersion = createPublishVersionRoute({
  registryStore: getRegistryStore(),
  blobStore: getBlobStore(),
  authProvider: getAuthProvider(),
});

interface PublishParams {
  readonly id: string;
}

const VERSION_FIELD_NAME = 'version';
const DEFAULT_VERSION = '0.0.0';

export async function POST(
  request: Request,
  context: RouteContext<PublishParams>,
): Promise<Response> {
  const { id } = await resolveRouteParams(context);

  // Extract version from form data or URL, cloning request so adapter can also read it
  const clonedRequest = request.clone();
  let version = DEFAULT_VERSION;

  try {
    const formData = await clonedRequest.formData();
    const formVersion = formData.get(VERSION_FIELD_NAME);
    if (typeof formVersion === 'string' && formVersion.length > 0) {
      version = formVersion;
    }
  } catch {
    // If form data parsing fails, use default version
  }

  return publishVersion(request, id, version);
}
