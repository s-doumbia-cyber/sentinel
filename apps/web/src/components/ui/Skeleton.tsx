/** A pulsing placeholder block, shaped like the content it stands in for. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.06] ${className}`} />;
}

/** Mimics the KPI card grid on Dashboard while its real data loads. */
export function SkeletonKpiGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-panel p-5">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-8 w-24 mb-3" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Mimics a chart card while its data loads. */
export function SkeletonChartCard({ height = 280 }: { height?: number }) {
  return (
    <div className="glass-panel p-5">
      <Skeleton className="h-4 w-40 mb-2" />
      <Skeleton className="h-3 w-56 mb-4" />
      <Skeleton style={{ height }} className="w-full" />
    </div>
  );
}

/** Mimics a data table while rows load. */
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
