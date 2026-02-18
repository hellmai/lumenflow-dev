import { getKernelRuntimeForWeb } from '../../../../src/server/http-surface-runtime';

const HTTP_STATUS = {
  OK: 200,
} as const;

const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';
const EMPTY_EVENTS_RESPONSE = '[]';

interface EventStoreReplayCapability {
  eventStore?: {
    replay(filter?: Record<string, unknown>): Promise<unknown[]>;
  };
}

/**
 * GET /api/events/all
 *
 * Returns all kernel events by replaying the EventStore without a task filter.
 * Used by the workspace overview page to derive task summaries and lane WIP counts.
 *
 * Returns an empty array when the kernel runtime is in preview mode or
 * when the event store is not available.
 */
export async function GET(): Promise<Response> {
  try {
    const runtime = await getKernelRuntimeForWeb();
    const runtimeWithEventStore = runtime as unknown as EventStoreReplayCapability;

    if (
      !runtimeWithEventStore.eventStore ||
      typeof runtimeWithEventStore.eventStore.replay !== 'function'
    ) {
      return new Response(EMPTY_EVENTS_RESPONSE, {
        status: HTTP_STATUS.OK,
        headers: { 'content-type': CONTENT_TYPE_JSON },
      });
    }

    const events = await runtimeWithEventStore.eventStore.replay({});

    return new Response(JSON.stringify(events), {
      status: HTTP_STATUS.OK,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  } catch {
    return new Response(EMPTY_EVENTS_RESPONSE, {
      status: HTTP_STATUS.OK,
      headers: { 'content-type': CONTENT_TYPE_JSON },
    });
  }
}
