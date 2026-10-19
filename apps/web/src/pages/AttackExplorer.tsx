import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlowButton } from "@/components/ui/GlowButton";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { FilterDrawer, FilterField, selectClass } from "@/components/ui/FilterDrawer";
import { ErrorBlock } from "@/components/ui/AsyncStates";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { FlowDetailPanel } from "@/components/ui/FlowDetailPanel";
import { ATTACK_TYPES } from "@/data/mockData";
import { flowsApi } from "@/services/flows";
import type { NetworkFlow } from "@/types";
import { ArrowDown, ArrowUp, Columns3, Download, Search } from "lucide-react";

type SortKey = "timestamp" | "sourceIp" | "destinationIp" | "protocol" | "label" | "severity";

const PAGE_SIZE = 10;
const PROTOCOLS = ["TCP", "UDP", "ICMP"];
const SEVERITIES = ["critical", "high", "medium", "low", "info", "safe"];
const ALL_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "timestamp", label: "Timestamp" },
  { key: "sourceIp", label: "Source IP" },
  { key: "destinationIp", label: "Destination IP" },
  { key: "protocol", label: "Protocol" },
  { key: "label", label: "Attack Type" },
  { key: "severity", label: "Severity" },
];
const COLUMN_PREFS_KEY = "sentinel_attack_explorer_columns";

function exportCsv(rows: NetworkFlow[]) {
  const header = "timestamp,sourceIp,destinationIp,protocol,label,severity\n";
  const body = rows
    .map((r) => `${r.timestamp},${r.sourceIp},${r.destinationIp},${r.protocol},${r.label},${r.severity}`)
    .join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attack-explorer-export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function loadColumnPrefs(): Set<SortKey> {
  try {
    const saved = localStorage.getItem(COLUMN_PREFS_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch {
    // ignore malformed localStorage value
  }
  return new Set(ALL_COLUMNS.map((c) => c.key));
}

export default function AttackExplorer() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("ip") || "");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [attackFilter, setAttackFilter] = useState("All types");
  const [protocolFilter, setProtocolFilter] = useState("All protocols");
  const [severityFilter, setSeverityFilter] = useState("All severities");
  const [selectedFlow, setSelectedFlow] = useState<NetworkFlow | null>(null);

  const [visibleColumns, setVisibleColumns] = useState<Set<SortKey>>(loadColumnPrefs);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<NetworkFlow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeFilterCount = [attackFilter !== "All types", protocolFilter !== "All protocols", severityFilter !== "All severities"].filter(
    Boolean
  ).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) setColumnMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleColumn(key: SortKey) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // always keep at least one column visible
      } else {
        next.add(key);
      }
      localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    flowsApi
      .list({
        page,
        limit: PAGE_SIZE,
        sortBy: sortKey,
        sortDir,
        onlyAttacks: true,
        attackType: attackFilter !== "All types" ? attackFilter : undefined,
        protocol: protocolFilter !== "All protocols" ? protocolFilter : undefined,
        severity: severityFilter !== "All severities" ? severityFilter : undefined,
        sourceIp: query || undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
        setPages(res.pages);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, sortKey, sortDir, attackFilter, protocolFilter, severityFilter, query]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const columns = ALL_COLUMNS.filter((c) => visibleColumns.has(c.key));

  return (
    <div>
      <PageHeader
        title="Attack Explorer"
        subtitle={`${total.toLocaleString()} matching flows in MongoDB — click a row for full details`}
        actions={
          <>
            <GlowButton variant="ghost" onClick={() => exportCsv(rows)}>
              <Download className="w-4 h-4" /> Export CSV
            </GlowButton>

            <div ref={columnMenuRef} className="relative">
              <button
                onClick={() => setColumnMenuOpen((o) => !o)}
                className="focus-ring flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-white/[0.18] hover:text-white transition-colors"
              >
                <Columns3 className="w-4 h-4" /> Columns
              </button>
              {columnMenuOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-base-900 border border-white/[0.12] rounded-2xl shadow-panel p-2 z-50">
                  {ALL_COLUMNS.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer text-sm text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.has(c.key)}
                        onChange={() => toggleColumn(c.key)}
                        className="accent-neon-violet"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <FilterDrawer badge={activeFilterCount || undefined}>
              <FilterField label="Attack Type">
                <select
                  className={selectClass}
                  value={attackFilter}
                  onChange={(e) => {
                    setAttackFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option>All types</option>
                  {ATTACK_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Protocol">
                <select
                  className={selectClass}
                  value={protocolFilter}
                  onChange={(e) => {
                    setProtocolFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option>All protocols</option>
                  {PROTOCOLS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Severity">
                <select
                  className={selectClass}
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option>All severities</option>
                  {SEVERITIES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </FilterField>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setAttackFilter("All types");
                    setProtocolFilter("All protocols");
                    setSeverityFilter("All severities");
                    setPage(1);
                  }}
                  className="focus-ring w-full mt-2 text-xs text-slate-400 hover:text-white underline underline-offset-2"
                >
                  Clear all filters
                </button>
              )}
            </FilterDrawer>
          </>
        }
      />

      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="p-4 border-b border-white/[0.06]">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Exact source IP (server-side match)..."
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus-ring focus:border-neon-violet/50"
            />
          </div>
        </div>

        {loading && (
          <div className="p-4">
            <SkeletonTable rows={PAGE_SIZE} />
          </div>
        )}
        {error && <ErrorBlock message={error} />}

        {!loading && !error && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left">
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer select-none hover:text-slate-200 transition-colors"
                      >
                        <span className="flex items-center gap-1">
                          {c.label}
                          {sortKey === c.key && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr
                      key={f.id}
                      onClick={() => setSelectedFlow(f)}
                      className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors cursor-pointer"
                    >
                      {visibleColumns.has("timestamp") && (
                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">{new Date(f.timestamp).toLocaleString("en-US")}</td>
                      )}
                      {visibleColumns.has("sourceIp") && <td className="px-4 py-3 font-mono text-slate-300">{f.sourceIp}</td>}
                      {visibleColumns.has("destinationIp") && (
                        <td className="px-4 py-3 font-mono text-slate-300">
                          {f.destinationIp}:{f.destinationPort}
                        </td>
                      )}
                      {visibleColumns.has("protocol") && <td className="px-4 py-3 text-slate-300">{f.protocol}</td>}
                      {visibleColumns.has("label") && <td className="px-4 py-3 text-slate-200 font-medium">{f.label}</td>}
                      {visibleColumns.has("severity") && (
                        <td className="px-4 py-3">
                          <SeverityBadge severity={f.severity} />
                        </td>
                      )}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500">
                        No matching flows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06] text-xs text-slate-400">
              <span>
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="focus-ring px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] disabled:opacity-40 hover:border-white/[0.16]"
                >
                  Previous
                </button>
                <button
                  disabled={page === pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  className="focus-ring px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] disabled:opacity-40 hover:border-white/[0.16]"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </GlassCard>

      <FlowDetailPanel flow={selectedFlow} onClose={() => setSelectedFlow(null)} />
    </div>
  );
}
