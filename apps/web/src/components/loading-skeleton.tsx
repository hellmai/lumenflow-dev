interface LoadingSkeletonProps {
  readonly label?: string;
}

const SKELETON_LINE_COUNT = 5;
const SKELETON_WIDTHS = ['75%', '100%', '60%', '90%', '45%'] as const;

export function LoadingSkeleton({ label }: LoadingSkeletonProps) {
  const displayLabel = label ?? 'Loading';

  return (
    <div role="status" className="animate-pulse space-y-4 p-4">
      <span className="sr-only">{displayLabel}</span>
      {Array.from({ length: SKELETON_LINE_COUNT }, (_, i) => (
        <div
          key={i}
          data-testid="skeleton-line"
          className="h-4 rounded bg-muted"
          style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
