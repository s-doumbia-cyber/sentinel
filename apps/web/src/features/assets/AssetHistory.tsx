import { Activity, CircleDot, CircleOff, NotebookPen, PlugZap, RotateCcw, Unplug, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { formatDateTime, utcTitle } from "@/lib/format";
import { useAssetHistory } from "@/lib/queries";
import type { AssetEvent, AssetEventKind } from "@/lib/types";

const KIND: Record<AssetEventKind, { icon: LucideIcon; label: string }> = {
  first_observed: { icon: CircleDot, label: "First observed" },
  service_observed: { icon: PlugZap, label: "New service" },
  service_gone: { icon: Unplug, label: "Service no longer seen" },
  estimate_changed: { icon: Activity, label: "Estimate changed" },
  became_inactive: { icon: CircleOff, label: "No longer in stored flows" },
  reactivated: { icon: RotateCcw, label: "Seen again" },
  notes_updated: { icon: NotebookPen, label: "Analyst notes updated" },
};

const str = (v: unknown) => (typeof v === "string" ? v : null);

function describe(e: AssetEvent): string {
  const d = e.detail;
  switch (e.kind) {
    case "first_observed": {
      const services = Array.isArray(d.services) ? (d.services as string[]) : [];
      const base = `${String(d.flowsAsSource ?? 0)} flows as source, ${String(d.flowsAsDestination ?? 0)} as destination${services.length ? `; accepted ${services.join(", ")}` : ""}${str(d.estimate) ? `; estimated ${str(d.estimate)}` : ""}.`;
      return d.historyStart ? `${base} History starts here: changes before this version were not recorded.` : base;
    }
    case "service_observed":
      return `${str(d.service) ?? "A service"} accepted connections (${String(d.flows ?? "?")} flows).`;
    case "service_gone":
      return `${str(d.service) ?? "A service"} no longer appears in stored flows (data deleted or no longer imported).`;
    case "estimate_changed":
      return `Estimate ${str(d.from) ?? "none"} → ${str(d.to) ?? "none"}${str(d.basis) ? ` (${str(d.basis)})` : ""}. Still a low-confidence heuristic.`;
    case "became_inactive":
      return str(d.reason) ?? "No stored flow involves this address any more.";
    case "reactivated":
      return "Flows involving this address are stored again.";
    case "notes_updated":
      return `Changed ${Array.isArray(d.fields) ? (d.fields as string[]).join(" and ") : "notes"}; the previous text is in the audit log.`;
  }
}

/** Inventory changes over time (axis 8). Each entry says when Sentinel noticed it and, if known, when it happened. */
export function AssetHistory({ ip }: { ip: string }) {
  const q = useAssetHistory(ip);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isLoading) return <SkeletonRows rows={3} cols={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!items.length) return <EmptyState title="No history yet" description="Changes are recorded each time the inventory is rebuilt." />;
  return (
    <>
      <ol className="space-y-3">
        {items.map((e) => {
          const { icon: Icon, label } = KIND[e.kind];
          return (
            <li key={e.id} className="flex gap-3 text-small">
              <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" strokeWidth={1.75} />
              <div className="min-w-0">
                <p className="font-medium text-fg-1">{label}</p>
                <p className="text-fg-2">{describe(e)}</p>
                <p className="mt-0.5 text-caption text-fg-3">
                  <span title={utcTitle(e.ts)}>Recorded {formatDateTime(e.ts)}</span> by {e.actor ?? "Sentinel (inventory refresh)"}
                  {e.eventTime && (
                    <>
                      {" "}
                      · <span title={utcTitle(e.eventTime)}>in the flows from {formatDateTime(e.eventTime)}</span>
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage && (
        <Button size="sm" className="mt-4" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          Show older changes
        </Button>
      )}
    </>
  );
}
