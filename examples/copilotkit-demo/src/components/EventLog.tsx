import { useEffect, useRef } from 'react';
import type { AgUiEvent } from '../lib/ag-ui-adapter';

interface EventLogProps {
  events: AgUiEvent[];
}

const EVENT_STYLE_MAP: Record<string, string> = {
  RUN_STARTED: 'run-started',
  STEP_STARTED: 'step-started',
  TOOL_CALL_START: 'tool-call',
  TOOL_CALL_END: 'tool-call',
  TOOL_CALL_RESULT: 'tool-call',
  GOVERNANCE_DECISION: 'governance',
  RUN_COMPLETED: 'run-completed',
  StateSnapshot: 'state-sync',
  StateDelta: 'state-sync',
  TEXT_MESSAGE_START: 'run-started',
  TEXT_MESSAGE_CONTENT: 'run-started',
  TEXT_MESSAGE_END: 'run-started',
};

function getEventStyleClass(eventType: string): string {
  return EVENT_STYLE_MAP[eventType] ?? '';
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch {
    return timestamp;
  }
}

function summarizePayload(event: AgUiEvent): string {
  const { type, payload } = event;

  switch (type) {
    case 'TOOL_CALL_START': {
      const toolName = payload.tool_name ?? 'unknown';
      const mode = payload.execution_mode ?? '';
      return `${String(toolName)} (${String(mode)})`;
    }
    case 'TOOL_CALL_END': {
      const result = payload.result ?? 'unknown';
      const duration = payload.duration_ms ?? '?';
      return `${String(result)} in ${String(duration)}ms`;
    }
    case 'TOOL_CALL_RESULT': {
      const hash = payload.output_hash ?? '';
      return `hash: ${String(hash).slice(0, 20)}...`;
    }
    case 'GOVERNANCE_DECISION': {
      const decision = payload.decision ?? 'unknown';
      const policyId = payload.policy_id ?? '';
      return `${String(decision).toUpperCase()}: ${String(policyId)}`;
    }
    case 'StateSnapshot': {
      const state = payload.state as Record<string, unknown> | undefined;
      const status = state?.status ?? 'unknown';
      return `status: ${String(status)}`;
    }
    case 'TEXT_MESSAGE_CONTENT': {
      const delta = payload.delta ?? '';
      return String(delta).slice(0, 60);
    }
    default:
      return '';
  }
}

export function EventLog({ events }: EventLogProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="event-panel">
      <div className="panel-header">AG-UI Event Stream ({events.length} events)</div>
      <div className="event-list" ref={listRef}>
        {events.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Send a message to see AG-UI events appear here in real time.
            <br />
            <br />
            Try: "Create a task for adding user authentication"
          </div>
        )}
        {events.map((event, index) => {
          const summary = summarizePayload(event);
          return (
            <div key={index} className={`event-item ${getEventStyleClass(event.type)}`}>
              <div>
                <span className="event-type">{event.type}</span>
                <span className="event-timestamp">{formatTimestamp(event.timestamp)}</span>
              </div>
              {summary && <div className="event-payload">{summary}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
