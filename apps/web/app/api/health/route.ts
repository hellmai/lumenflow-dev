import { getKernelRuntimeHealth } from '../../../src/server/http-surface-runtime';

const HTTP_STATUS = {
  OK: 200,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' } as const;
const ERROR_INTERNAL = 'Internal server error';

/**
 * GET /api/health
 *
 * Returns runtime mode diagnostics for quick preview-vs-runtime debugging.
 */
export async function GET(): Promise<Response> {
  try {
    const runtime = await getKernelRuntimeHealth();
    return new Response(
      JSON.stringify({
        success: true,
        runtime,
      }),
      {
        status: HTTP_STATUS.OK,
        headers: JSON_CONTENT_TYPE,
      },
    );
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
