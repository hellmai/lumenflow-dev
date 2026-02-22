'use client';

/**
 * Action diff viewer component (WU-1834).
 * Renders a visual diff showing what the agent attempted vs what governance permitted.
 * Each row is color-coded by status: denied (red), allowed (green), narrowed (amber).
 */

import type { ActionDiffEntry, ActionDiffStatus } from '../lib/dashboard-types';

const STATUS_COLORS = new Map<ActionDiffStatus, string>([
  ['denied', 'bg-red-50 border-red-200'],
  ['allowed', 'bg-green-50 border-green-200'],
  ['narrowed', 'bg-amber-50 border-amber-200'],
]);

const STATUS_BADGE_COLORS = new Map<ActionDiffStatus, string>([
  ['denied', 'bg-red-100 text-red-700'],
  ['allowed', 'bg-green-100 text-green-700'],
  ['narrowed', 'bg-amber-100 text-amber-700'],
]);

const DEFAULT_ROW_COLOR = 'bg-slate-50 border-slate-200';
const DEFAULT_BADGE_COLOR = 'bg-slate-100 text-slate-600';

interface ActionDiffViewerProps {
  readonly entries: readonly ActionDiffEntry[];
}

interface ActionDiffRow {
  readonly entry: ActionDiffEntry;
  readonly key: string;
  readonly ordinal: number;
}

function buildActionDiffRows(entries: readonly ActionDiffEntry[]): readonly ActionDiffRow[] {
  const seenBaseKeys = new Map<string, number>();
  const rows: ActionDiffRow[] = [];

  for (const entry of entries) {
    const baseKey = `${entry.field}::${entry.attempted}::${entry.permitted ?? 'blocked'}::${entry.status}`;
    const occurrence = seenBaseKeys.get(baseKey) ?? 0;
    seenBaseKeys.set(baseKey, occurrence + 1);
    rows.push({
      entry,
      key: `${baseKey}::${occurrence}`,
      ordinal: rows.length,
    });
  }

  return rows;
}

export function ActionDiffViewer({ entries }: ActionDiffViewerProps) {
  if (entries.length === 0) {
    return (
      <div
        data-testid="action-diff-empty"
        className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400"
      >
        No action diff data available.
      </div>
    );
  }

  const rows = buildActionDiffRows(entries);

  return (
    <div data-testid="action-diff-viewer" className="rounded-lg border border-slate-200 bg-white">
      {/* Table header */}
      <div className="grid grid-cols-4 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div>Field</div>
        <div>Attempted</div>
        <div>Permitted</div>
        <div>Status</div>
      </div>

      {/* Diff rows */}
      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div
            key={row.key}
            data-testid={`action-diff-row-${row.ordinal}`}
            data-status={row.entry.status}
            className={`grid grid-cols-4 gap-2 border-l-2 px-4 py-2 text-sm ${STATUS_COLORS.get(row.entry.status) ?? DEFAULT_ROW_COLOR}`}
          >
            {/* Field name */}
            <div className="font-medium text-slate-700">{row.entry.field}</div>

            {/* Attempted value */}
            <div data-testid="attempted-value" className="font-mono text-slate-600">
              {row.entry.attempted}
            </div>

            {/* Permitted value */}
            <div data-testid="permitted-value" className="font-mono text-slate-600">
              {row.entry.permitted !== null ? (
                row.entry.permitted
              ) : (
                <span
                  data-testid="permitted-blocked"
                  className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700"
                >
                  blocked
                </span>
              )}
            </div>

            {/* Status badge */}
            <div>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_COLORS.get(row.entry.status) ?? DEFAULT_BADGE_COLOR}`}
              >
                {row.entry.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
