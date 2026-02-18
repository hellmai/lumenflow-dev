'use client';

import { useEffect, useRef } from 'react';
import type { DashboardEvent } from '../lib/dashboard-types';

const EVENT_KIND_COLORS = new Map<string, string>([
  ['task_created', 'text-slate-500'],
  ['task_claimed', 'text-blue-600'],
  ['task_blocked', 'text-red-600'],
  ['task_unblocked', 'text-green-600'],
  ['task_waiting', 'text-amber-600'],
  ['task_resumed', 'text-blue-600'],
  ['task_completed', 'text-green-700'],
  ['task_released', 'text-slate-500'],
  ['task_delegated', 'text-purple-600'],
  ['run_started', 'text-blue-500'],
  ['run_paused', 'text-amber-500'],
  ['run_failed', 'text-red-500'],
  ['run_succeeded', 'text-green-500'],
  ['tool_call_started', 'text-indigo-500'],
  ['tool_call_finished', 'text-indigo-600'],
]);

const DEFAULT_EVENT_KIND_COLOR = 'text-slate-400';

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toISOString().split('T')[1]?.replace('Z', '') ?? iso;
  } catch {
    return iso;
  }
}

function getEventKindColor(kind: string): string {
  return EVENT_KIND_COLORS.get(kind) ?? DEFAULT_EVENT_KIND_COLOR;
}

interface EventLogProps {
  readonly events: readonly DashboardEvent[];
}

export function EventLog({ events }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div
        data-testid="event-log-empty"
        className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400"
      >
        Waiting for events...
      </div>
    );
  }

  return (
    <div
      data-testid="event-log"
      ref={scrollRef}
      className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white"
    >
      <div className="divide-y divide-slate-100">
        {events.map((event) => (
          <div
            key={event.id}
            data-testid={`event-item-${event.id}`}
            className="flex items-start gap-3 px-4 py-2 text-sm hover:bg-slate-50 transition-colors"
          >
            <span className="shrink-0 font-mono text-xs text-slate-400">
              {formatTimestamp(event.timestamp)}
            </span>
            <span className={`shrink-0 font-medium ${getEventKindColor(event.kind)}`}>
              {event.kind}
            </span>
            {Object.keys(event.data).length > 0 && (
              <span className="truncate text-xs text-slate-400">
                {JSON.stringify(event.data).slice(0, 120)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
