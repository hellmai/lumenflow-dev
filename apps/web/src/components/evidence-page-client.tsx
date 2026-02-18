'use client';

import { useCallback, useState } from 'react';
import { EvidenceViewer, type TimelineEntry } from './evidence-viewer';

const FETCH_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

type FetchStatus = (typeof FETCH_STATUS)[keyof typeof FETCH_STATUS];

interface EvidenceResponse {
  readonly traces: readonly unknown[];
  readonly timeline: readonly TimelineEntry[];
}

export function EvidencePageClient() {
  const [taskId, setTaskId] = useState('');
  const [status, setStatus] = useState<FetchStatus>(FETCH_STATUS.IDLE);
  const [timeline, setTimeline] = useState<readonly TimelineEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchEvidence = useCallback(async () => {
    if (taskId.trim().length === 0) {
      return;
    }

    setStatus(FETCH_STATUS.LOADING);
    setErrorMessage('');

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/evidence`);

      if (!response.ok) {
        setStatus(FETCH_STATUS.ERROR);
        setErrorMessage(`Failed to fetch evidence: HTTP ${response.status}`);
        return;
      }

      const data: EvidenceResponse = await response.json();
      setTimeline(data.timeline);
      setStatus(FETCH_STATUS.SUCCESS);
    } catch {
      setStatus(FETCH_STATUS.ERROR);
      setErrorMessage('Network error while fetching evidence.');
    }
  }, [taskId]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Evidence Viewer</h1>
        <p className="mt-1 text-sm text-slate-500">
          View tool trace timeline with scope intersection and result badges.
        </p>
      </div>

      {/* Task ID input */}
      <div className="flex items-center gap-3">
        <input
          data-testid="task-id-input"
          type="text"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void fetchEvidence();
            }
          }}
          placeholder="Enter task ID (e.g., task-1)"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          data-testid="fetch-evidence-button"
          onClick={() => void fetchEvidence()}
          disabled={status === FETCH_STATUS.LOADING || taskId.trim().length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {status === FETCH_STATUS.LOADING ? 'Loading...' : 'Load Evidence'}
        </button>
      </div>

      {/* Error display */}
      {status === FETCH_STATUS.ERROR && (
        <div
          data-testid="evidence-error"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {errorMessage}
        </div>
      )}

      {/* Timeline */}
      {status === FETCH_STATUS.SUCCESS && <EvidenceViewer timeline={timeline} taskId={taskId} />}
    </div>
  );
}
