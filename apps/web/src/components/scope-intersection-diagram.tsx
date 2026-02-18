'use client';

/**
 * Scope intersection diagram component (WU-1834).
 * Renders a three-column visualization of requested vs allowed vs enforced scopes.
 * Displays the scope intersection that determines policy decisions.
 */

import type { ScopeIntersectionView, ScopeView } from '../lib/dashboard-types';

const COLUMN_CONFIGS = [
  {
    key: 'requested' as const,
    label: 'Requested',
    headerColor: 'text-blue-700 bg-blue-50 border-blue-200',
    itemColor: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'allowed' as const,
    label: 'Allowed',
    headerColor: 'text-green-700 bg-green-50 border-green-200',
    itemColor: 'bg-green-50 text-green-700 border-green-200',
  },
  {
    key: 'enforced' as const,
    label: 'Enforced',
    headerColor: 'text-red-700 bg-red-50 border-red-200',
    itemColor: 'bg-red-50 text-red-700 border-red-200',
  },
] as const;

function hasAnyScopes(intersection: ScopeIntersectionView): boolean {
  return (
    intersection.requested.length > 0 ||
    intersection.allowed.length > 0 ||
    intersection.enforced.length > 0
  );
}

interface ScopeItemProps {
  readonly scope: ScopeView;
  readonly index: number;
  readonly colorClass: string;
}

function ScopeItem({ scope, index, colorClass }: ScopeItemProps) {
  return (
    <div
      data-testid={`scope-item-${index}`}
      className={`rounded border px-2 py-1 text-xs ${colorClass}`}
    >
      <span className="font-medium">{scope.type}</span>
      {scope.pattern && <span className="ml-1 font-mono">{scope.pattern}</span>}
      {scope.access && (
        <span className="ml-1 rounded bg-white/50 px-1 text-[10px] font-medium uppercase">
          {scope.access}
        </span>
      )}
    </div>
  );
}

interface ScopeIntersectionDiagramProps {
  readonly intersection: ScopeIntersectionView;
}

export function ScopeIntersectionDiagram({ intersection }: ScopeIntersectionDiagramProps) {
  if (!hasAnyScopes(intersection)) {
    return (
      <div
        data-testid="scope-intersection-empty"
        className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400"
      >
        No scope data available.
      </div>
    );
  }

  return (
    <div data-testid="scope-intersection-diagram" className="grid grid-cols-3 gap-3">
      {COLUMN_CONFIGS.map((column) => {
        const scopes = intersection[column.key];
        return (
          <div
            key={column.key}
            data-testid={`scope-column-${column.key}`}
            className="rounded-lg border border-slate-200 bg-white"
          >
            {/* Column header */}
            <div
              className={`rounded-t-lg border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide ${column.headerColor}`}
            >
              {column.label}
              <span className="ml-1 font-normal opacity-70">({scopes.length})</span>
            </div>

            {/* Scope items */}
            <div className="space-y-1 p-2">
              {scopes.length === 0 ? (
                <div className="px-2 py-1 text-xs italic text-slate-400">None</div>
              ) : (
                scopes.map((scope, index) => (
                  <ScopeItem
                    key={`${column.key}-${scope.type}-${scope.pattern ?? ''}-${index}`}
                    scope={scope}
                    index={index}
                    colorClass={column.itemColor}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
