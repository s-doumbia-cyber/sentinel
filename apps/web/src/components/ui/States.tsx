import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-3/70", className)} />;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className="mb-1 text-fg-3" aria-hidden>
        {icon ?? <Inbox className="h-7 w-7" strokeWidth={1.75} />}
      </div>
      <p className="text-body font-medium text-fg-1">{title}</p>
      {description && <p className="max-w-md text-small text-fg-3">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** What failed, a retry, and the request id for support (§5). */
export function ErrorState({ error, onRetry, title = "Couldn’t load this data", className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <AlertTriangle aria-hidden className="h-7 w-7 text-sevfg-high" strokeWidth={1.75} />
      <p className="text-body font-medium text-fg-1">{title}</p>
      <p className="max-w-md text-small text-fg-2">{errorMessage(error)}</p>
      {requestId && <p className="font-mono text-caption text-fg-3">Request id: {requestId}</p>}
      {onRetry && (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
