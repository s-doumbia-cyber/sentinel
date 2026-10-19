import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { LoadingBlock, ErrorBlock } from "@/components/ui/AsyncStates";
import { useAsyncData } from "@/hooks/useAsyncData";
import { incidentsApi } from "@/services/flows";
import { useAuth } from "@/contexts/AuthContext";
import type { Incident, IncidentStatus } from "@/types";
import { GripVertical, User } from "lucide-react";

const STATUSES: IncidentStatus[] = ["Open", "Investigating", "Resolved", "Closed"];

const STATUS_DOT: Record<IncidentStatus, string> = {
  Open: "bg-neon-pink",
  Investigating: "bg-neon-violetStrong",
  Resolved: "bg-neon-cyan",
  Closed: "bg-slate-500",
};

export default function Incidents() {
  const { user } = useAuth();
  const { data, loading, error } = useAsyncData(() => incidentsApi.list(), [], "incidents");
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<IncidentStatus | null>(null);
  const [saveError, setSaveError] = useState("");

  // Local, optimistic copy so a drag-and-drop move feels instant; data is the
  // source of truth on first load / cache refresh, incidents is what renders.
  const list = incidents ?? data;
  const canDrag = user?.role !== "Viewer";

  async function moveIncident(id: string, newStatus: IncidentStatus) {
    const current = list;
    if (!current) return;
    const target = current.find((i) => i.id === id);
    if (!target || target.status === newStatus) return;

    const optimistic = current.map((i) => (i.id === id ? { ...i, status: newStatus } : i));
    setIncidents(optimistic);
    setSaveError("");
    try {
      await incidentsApi.updateStatus(id, newStatus);
    } catch (err: any) {
      setIncidents(current); // revert on failure
      setSaveError(err?.response?.data?.message || "Failed to move incident");
    }
  }

  return (
    <div>
      <PageHeader
        title="Incident Management"
        subtitle={
          list
            ? `${list.length} incidents auto-generated from real high/critical-severity attacks${canDrag ? " — drag a card to change its status" : ""}`
            : "Loading..."
        }
      />

      {loading && <LoadingBlock label="Analyzing high-severity attacks..." />}
      {error && <ErrorBlock message={error} />}
      {saveError && <p className="text-xs text-neon-pink mb-3">{saveError}</p>}

      {list && list.length === 0 && (
        <GlassCard hover={false}>
          <p className="text-sm text-slate-400">
            No critical/high-severity attacks found in the imported dataset yet — incidents are generated
            automatically from those. Import a dataset with attack traffic (e.g. the DDoS or PortScan CSV) to see
            this fill in.
          </p>
        </GlassCard>
      )}

      {list && list.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {STATUSES.map((status) => {
            const items = list.filter((i) => i.status === status);
            const isDropTarget = dragOverStatus === status;
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  if (!canDrag) return;
                  e.preventDefault();
                  setDragOverStatus(status);
                }}
                onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverStatus(null);
                  if (dragId) moveIncident(dragId, status);
                  setDragId(null);
                }}
                className={`rounded-2xl transition-colors ${isDropTarget ? "bg-white/[0.03] ring-1 ring-neon-violet/40" : ""}`}
              >
                <div className="flex items-center gap-2 mb-3 px-1 pt-1">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
                  <p className="text-sm font-semibold text-slate-200">{status}</p>
                  <span className="text-xs text-slate-500 ml-auto">{items.length}</span>
                </div>
                <div className="space-y-3 px-1 pb-1 min-h-[60px]">
                  {items.map((inc) => (
                    <div
                      key={inc.id}
                      className={`glass-panel glass-panel-hover p-4 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${
                        dragId === inc.id ? "opacity-40" : ""
                      }`}
                      draggable={canDrag}
                      onDragStart={() => setDragId(inc.id)}
                      onDragEnd={() => setDragId(null)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1 text-xs font-mono text-slate-500">
                          {canDrag && <GripVertical className="w-3 h-3 text-slate-600" />}
                          {inc.id.slice(-6)}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                          {inc.priority}
                        </span>
                      </div>
                      <p className="text-sm text-slate-200 font-medium mb-2 leading-snug">{inc.title}</p>
                      <p className="text-xs text-slate-500 font-mono mb-3">{inc.sourceIp}</p>
                      <div className="flex items-center justify-between">
                        <SeverityBadge severity={inc.severity} />
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <User className="w-3 h-3" /> {inc.assignee}
                        </span>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="text-xs text-slate-500 border border-dashed border-white/[0.08] rounded-xl py-6 text-center">
                      {isDropTarget ? "Drop here" : "No incidents"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
