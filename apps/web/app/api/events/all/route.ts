import { type NextRequest } from 'next/server';
import { getKernelRuntimeForWeb } from '../../../../src/server/http-surface-runtime';

const HTTP_STATUS = {
  OK: 200,
} as const;

const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';

interface ReplayResult {
  events: unknown[];
  nextCursor: string | null;
}

interface EventStoreReplayCapability {
  eventStore?: {
    replay(filter?: Record<string, unknown>): Promise<ReplayResult>;
  };
}

const EMPTY_REPLAY_RESULT: ReplayResult = { events: [], nextCursor: null };

/**
 * GET /api/events/all
 *
 * Returns kernel events by replaying the EventStore without a task filter.
 * Supports cursor-based pagination via `cursor` and `limit` query parameters.
 * Used by the workspace overview page to derive task summaries and lane WIP counts.
 *
 * Returns `{ events: [], nextCursor: null }` when the kernel runtime is in
 * preview mode or when the event store is not available.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const runtime = await getKernelRuntimeForWeb();
    const runtimeWithEventStore = runtime as unknown as EventStoreReplayCapability;

    if (
      !runtimeWithEventStore.eventStore ||
      typeof runtimeWithEventStore.eventStore.replay !== 'function'
    ) {
      return new Response(JSON.stringify(EMPTY_REPLAY_RESULT), {
        status: HTTP_STATUS.OK,
        headers: { 'content-type': CONTENT_TYPE_JSON },
      });
    }

    const { searchParams } = request.nextUrl;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;

    const result = await runtimeWithEventStore.eventStore.replay({
      ...(cursor !== undefined && { cursor }),
      ...(limit !== undefined && !Number.isNaN(limit) && { limit }),
    });

    return new Response(JSON.stringify(result), {
      status: HTTP_STATUS.OK,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  } catch {
    return new Response(JSON.stringify(EMPTY_REPLAY_RESULT), {
      status: HTTP_STATUS.OK,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  }
}
