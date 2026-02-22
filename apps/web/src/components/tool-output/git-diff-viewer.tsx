'use client';

/**
 * Git diff viewer component for git tool outputs.
 * Renders unified diff lines with add/remove/context coloring.
 */

const DIFF_LINE_COLORS = new Map<string, string>([
  ['added', 'bg-green-50 text-green-800'],
  ['removed', 'bg-red-50 text-red-800'],
  ['context', 'bg-white text-slate-700'],
  ['header', 'bg-blue-50 text-blue-700 font-semibold'],
]);

const DIFF_LINE_PREFIXES = new Map<string, string>([
  ['added', '+'],
  ['removed', '-'],
  ['context', ' '],
  ['header', ''],
]);

const DEFAULT_DIFF_LINE_COLOR = 'bg-white text-slate-700';

interface DiffLineData {
  readonly type: string;
  readonly content: string;
  readonly lineNumber?: number;
}

interface GitDiffViewerProps {
  readonly filePath: string;
  readonly lines: readonly DiffLineData[];
}

interface DiffLineRow {
  readonly line: DiffLineData;
  readonly key: string;
  readonly ordinal: number;
}

function buildDiffLineRows(lines: readonly DiffLineData[]): readonly DiffLineRow[] {
  const seenBaseKeys = new Map<string, number>();
  const rows: DiffLineRow[] = [];

  for (const line of lines) {
    const baseKey = `${line.type}::${line.lineNumber ?? ''}::${line.content}`;
    const occurrence = seenBaseKeys.get(baseKey) ?? 0;
    seenBaseKeys.set(baseKey, occurrence + 1);
    rows.push({
      line,
      key: `${baseKey}::${occurrence}`,
      ordinal: rows.length,
    });
  }

  return rows;
}

export function GitDiffViewer({ filePath, lines }: GitDiffViewerProps) {
  const lineRows = buildDiffLineRows(lines);

  return (
    <div
      data-testid="git-diff-viewer"
      className="rounded-lg border border-slate-200 overflow-hidden"
    >
      {/* File header */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
        <span className="font-mono text-sm font-medium text-slate-700">{filePath}</span>
      </div>

      {/* Diff lines */}
      <div className="font-mono text-xs leading-relaxed">
        {lineRows.map((row) => (
          <div
            key={row.key}
            data-testid={`diff-line-${row.ordinal}`}
            data-diff-type={row.line.type}
            className={`flex px-4 py-0.5 ${DIFF_LINE_COLORS.get(row.line.type) ?? DEFAULT_DIFF_LINE_COLOR}`}
          >
            {row.line.lineNumber !== undefined && (
              <span className="mr-4 w-8 select-none text-right text-slate-400">
                {row.line.lineNumber}
              </span>
            )}
            {row.line.type !== 'header' && (
              <span className="mr-2 select-none text-slate-400">
                {DIFF_LINE_PREFIXES.get(row.line.type) ?? ' '}
              </span>
            )}
            <span className="flex-1 whitespace-pre">{row.line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
