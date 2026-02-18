/**
 * AG-UI Runtime Adapter for CopilotKit
 *
 * Bridges CopilotKit's CopilotRuntime to the LumenFlow AG-UI endpoint.
 * The adapter POSTs to /ag-ui/v1/run and parses the newline-delimited
 * JSON event stream, forwarding text message events to CopilotKit and
 * exposing all events via a callback for the EventLog component.
 *
 * See: packages/@lumenflow/surfaces/http/run-agent.ts for the real endpoint.
 */

export interface AgUiEvent {
  type: string;
  timestamp: string;
  threadId: string;
  runId: string;
  task_id?: string;
  run_id?: string;
  payload: Record<string, unknown>;
  metadata: {
    source: string;
    kernel_kind?: string;
  };
}

export type EventCallback = (event: AgUiEvent) => void;

const AG_UI_ENDPOINT = '/ag-ui/v1/run';

interface RunAgentMessage {
  id: string;
  role: string;
  content: string;
}

interface RunAgentRequestBody {
  threadId: string;
  runId: string;
  messages: RunAgentMessage[];
  tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
  context?: Array<{ name: string; description?: string; value: unknown }>;
  forwardedProps?: Record<string, unknown>;
}

/**
 * Send a message to the LumenFlow AG-UI endpoint and stream back events.
 *
 * Returns the full assistant response text assembled from TEXT_MESSAGE_CONTENT deltas.
 */
export async function sendToAgUi(
  messages: RunAgentMessage[],
  onEvent: EventCallback,
  options: { threadId?: string } = {},
): Promise<string> {
  const threadId = options.threadId ?? `thread-${Date.now()}`;
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const body: RunAgentRequestBody = {
    threadId,
    runId,
    messages,
  };

  const response = await fetch(AG_UI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AG-UI request failed (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('AG-UI response has no body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const event: AgUiEvent = JSON.parse(trimmed);
        onEvent(event);

        // Accumulate text message content for the return value
        if (event.type === 'TEXT_MESSAGE_CONTENT') {
          const delta = event.payload.delta;
          if (typeof delta === 'string') {
            assistantText += delta;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim().length > 0) {
    try {
      const event: AgUiEvent = JSON.parse(buffer.trim());
      onEvent(event);
      if (event.type === 'TEXT_MESSAGE_CONTENT') {
        const delta = event.payload.delta;
        if (typeof delta === 'string') {
          assistantText += delta;
        }
      }
    } catch {
      // Skip malformed final buffer
    }
  }

  return assistantText;
}
