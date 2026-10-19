import { Bell, Search, ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { incidentsApi } from "@/services/flows";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { MobileNav } from "./MobileNav";

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<"notifications" | "profile" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Real notifications: open/investigating incidents, newest first — replaces
  // the earlier hardcoded "Critical DDoS spike from 41.22.x.x" placeholder list.
  const [incidents, setIncidents] = useState<Awaited<ReturnType<typeof incidentsApi.list>> | null>(null);
  useEffect(() => {
    incidentsApi
      .list()
      .then((all) => setIncidents(all.filter((i) => i.status === "Open" || i.status === "Investigating").slice(0, 5)))
      .catch(() => setIncidents([]));
  }, []);
  const alertCount = incidents?.length ?? 0;

  function handleSearchSubmit(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) {
      navigate(`/attack-explorer?ip=${encodeURIComponent(query.trim())}`);
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 md:gap-4 px-3 md:px-6 py-3 md:py-4 bg-base-950/70 backdrop-blur-xl border-b border-white/[0.06]">
      <MobileNav />

      <div className="flex-1 max-w-md relative min-w-0">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchSubmit}
          placeholder="Search by source IP..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus-ring focus:border-neon-violet/50 transition-colors"
        />
      </div>

      <div ref={containerRef} className="flex items-center gap-2 md:gap-3 ml-auto shrink-0">
        <div className="relative">
          <button
            onClick={() => setOpenMenu((m) => (m === "notifications" ? null : "notifications"))}
            className="focus-ring relative w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/[0.08] text-slate-300 hover:text-white hover:border-white/[0.16] transition-colors"
          >
            <Bell className="w-4 h-4" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neon-pink text-[9px] font-semibold text-white flex items-center justify-center animate-pulse-glow">
                {alertCount}
              </span>
            )}
          </button>
          {openMenu === "notifications" && (
            <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-base-900 border border-white/[0.12] rounded-2xl shadow-panel p-3 text-sm z-50">
              <p className="text-slate-300 font-medium mb-2">Open Incidents</p>
              {incidents === null && <p className="text-xs text-slate-500 py-2">Loading...</p>}
              {incidents?.length === 0 && <p className="text-xs text-slate-500 py-2">No open incidents right now.</p>}
              {incidents?.map((inc) => (
                <button
                  key={inc.id}
                  onClick={() => {
                    setOpenMenu(null);
                    navigate("/incidents");
                  }}
                  className="focus-ring w-full flex items-start justify-between gap-2 text-left py-2 border-t border-white/[0.06] first:border-0 hover:bg-white/[0.03] rounded-lg px-1 -mx-1 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-slate-300 text-xs truncate">{inc.title}</p>
                    <p className="text-slate-500 text-[11px] font-mono">{inc.sourceIp}</p>
                  </div>
                  <SeverityBadge severity={inc.severity} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setOpenMenu((m) => (m === "profile" ? null : "profile"))}
            className="focus-ring flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.16] transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-grad-blue-violet flex items-center justify-center text-xs font-semibold text-white">
              {(user?.name ?? "AN").slice(0, 2).toUpperCase()}
            </div>
            <span className="text-sm text-slate-200 hidden sm:block">{user?.name ?? "Analyst"}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          </button>
          {openMenu === "profile" && (
            <div className="absolute right-0 mt-2 w-48 bg-base-900 border border-white/[0.12] rounded-2xl shadow-panel p-1.5 text-sm z-50">
              <button
                onClick={logout}
                className="focus-ring w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
