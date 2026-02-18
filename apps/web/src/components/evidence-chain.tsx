'use client';

import type { EvidenceLink } from '../lib/dashboard-types';

const TYPE_ICONS = new Map<string, string>([
  ['receipt', 'R'],
  ['event', 'E'],
]);

const TYPE_COLORS = new Map<string, string>([
  ['receipt', 'bg-indigo-100 text-indigo-700 border-indigo-200'],
  ['event', 'bg-blue-100 text-blue-700 border-blue-200'],
]);

const DEFAULT_TYPE_COLOR = 'bg-slate-100 text-slate-600 border-slate-200';

function getTypeColor(type: string): string {
  return TYPE_COLORS.get(type) ?? DEFAULT_TYPE_COLOR;
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toISOString().split('T')[1]?.replace('Z', '') ?? iso;
  } catch {
    return iso;
  }
}

interface EvidenceChainProps {
  readonly links: readonly EvidenceLink[];
}

export function EvidenceChain({ links }: EvidenceChainProps) {
  if (links.length === 0) {
    return (
      <div
        data-testid="evidence-chain-empty"
        className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400"
      >
        No evidence collected yet.
      </div>
    );
  }

  return (
    <div data-testid="evidence-chain" className="space-y-2">
      {links.map((link, index) => (
        <div key={link.id} className="flex items-start gap-3">
          {/* Vertical connector */}
          <div className="flex flex-col items-center">
            <div
              data-testid={`evidence-link-${link.id}`}
              data-type={link.type}
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${getTypeColor(link.type)}`}
            >
              {TYPE_ICONS.get(link.type) ?? '?'}
            </div>
            {index < links.length - 1 && <div className="h-4 w-px bg-slate-200" />}
          </div>

          {/* Content */}
          <div className="flex-1 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">{link.label}</span>
              <span className="font-mono text-xs text-slate-400">
                {formatTimestamp(link.timestamp)}
              </span>
            </div>
            {link.ref && <span className="font-mono text-xs text-slate-400">ref: {link.ref}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
