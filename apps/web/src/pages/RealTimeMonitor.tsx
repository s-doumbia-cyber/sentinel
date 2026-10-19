import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { ErrorBlock } from "@/components/ui/AsyncStates";
import { SkeletonChartCard } from "@/components/ui/Skeleton";
import { flowsApi } from "@/services/flows";
import type { NetworkFlow } from "@/types";
import { History, Pause, Play, Radio, ShieldAlert, Volume2, VolumeX } from "lucide-react";

const SPEEDS = [1, 2, 5] as const;
const BASE_INTERVAL_MS = 1500;
const SEVERITIES = ["all", "critical", "high", "medium", "low", "info", "safe"] as const;

export default function RealTimeMonitor() {
  const [pool, setPool] = useState<NetworkFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feed, setFeed] = useState<NetworkFlow[]>([]);
  const [toast, setToast] = useState<NetworkFlow | null>(null);
  const cursor = useRef(0);

  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [severityFilter, setSeverityFilter] = useState<(typeof SEVERITIES)[number]>("all");
  const [soundOn, setSoundOn] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Pull a real batch from MongoDB once, then replay it at a fixed cadence below —
  // this is a *replay* of genuinely captured traffic, not a live network tap
  // (a browser dashboard can't sniff packets; see docs/01-architecture.md).
  useEffect(() => {
    flowsApi
      .list({ page: 1, limit: 200, sortBy: "timestamp", sortDir: "asc" })
      .then((res) => setPool(res.rows))
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }, []);

  function playCriticalBeep() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Web Audio can fail/be blocked in some browsers before user interaction — non-critical, just skip the beep.
    }
  }

  useEffect(() => {
    if (pool.length === 0 || paused) return;
    const filtered = severityFilter === "all" ? pool : pool.filter((f) => f.severity === severityFilter);
    if (filtered.length === 0) return;

    const interval = setInterval(() => {
      const flow = filtered[cursor.current % filtered.length];
      cursor.current += 1;
      setFeed((f) => [flow, ...f].slice(0, 25));
      if (flow.isAttack && (flow.severity === "critical" || flow.severity === "high")) {
        setToast(flow);
        if (soundOn && flow.severity === "critical") playCriticalBeep();
        setTimeout(() => setToast(null), 3500);
      }
    }, BASE_INTERVAL_MS / speed);
    return () => clearInterval(interval);
  }, [pool, paused, speed, severityFilter, soundOn]);

  return (
    <div>
      <PageHeader
        title="Real-Time Monitor"
        subtitle="Replaying real captured flows from the imported dataset, in original order"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPaused((p) => !p)}
              className="focus-ring flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-white/[0.18] hover:text-white transition-colors"
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? "Resume" : "Pause"}
            </button>

            <div className="flex items-center rounded-full bg-white/[0.04] border border-white/[0.08] p-0.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`focus-ring text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    speed === s ? "bg-grad-violet-pink text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  x{s}
                </button>
              ))}
            </div>

            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as (typeof SEVERITIES)[number])}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/[0.04] text-slate-300 border border-white/[0.08] focus-ring"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s} className="bg-base-900">
                  {s === "all" ? "All severities" : s}
                </option>
              ))}
            </select>

            <button
              onClick={() => setSoundOn((s) => !s)}
              title={soundOn ? "Mute critical alert sound" : "Unmute critical alert sound"}
              className="focus-ring w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:text-white transition-colors"
            >
              {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>

            <span className="flex items-center gap-2 text-xs font-semibold text-neon-cyan px-3 py-1.5 rounded-full bg-neon-cyan/10 border border-neon-cyan/20">
              <History className="w-3.5 h-3.5" /> Replay mode
            </span>
          </div>
        }
      />

      {loading && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SkeletonChartCard height={80} />
            <SkeletonChartCard height={80} />
            <SkeletonChartCard height={80} />
          </div>
          <SkeletonChartCard height={300} />
        </div>
      )}
      {error && <ErrorBlock message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <GlassCard>
              <div className="flex items-center gap-2 mb-1">
                <Radio className={`w-4 h-4 text-neon-cyan ${paused ? "" : "animate-pulse"}`} />
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Flows Replayed</p>
              </div>
              <p className="text-3xl font-display font-bold text-white tabular-nums">{feed.length}</p>
            </GlassCard>
            <GlassCard delay={0.05}>
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-4 h-4 text-neon-pink" />
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Attacks in Batch</p>
              </div>
              <p className="text-3xl font-display font-bold text-white tabular-nums">{feed.filter((f) => f.isAttack).length}</p>
            </GlassCard>
            <GlassCard delay={0.1}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full bg-neon-violetStrong ${paused ? "" : "animate-pulse-glow"}`} />
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  {paused ? "Paused" : `Playing at x${speed}`}
                </p>
              </div>
              <p className="text-3xl font-display font-bold text-white tabular-nums">{pool.length}</p>
            </GlassCard>
          </div>

          <GlassCard className="mt-5" hover={false}>
            <p className="text-sm font-semibold text-slate-200 mb-3">Replayed Flow Feed</p>
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {feed.map((f, i) => (
                  <motion.div
                    key={`${f.id}-${i}`}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={`flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-white/[0.02] border transition-colors ${
                      f.severity === "critical" ? "border-neon-pink/30" : "border-white/[0.05]"
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <span className={`w-1.5 h-1.5 rounded-full ${f.isAttack ? "bg-neon-pink" : "bg-emerald-400"}`} />
                      <p className="text-xs font-mono text-slate-400 truncate">
                        {f.sourceIp} → {f.destinationIp}:{f.destinationPort}
                      </p>
                    </div>
                    <SeverityBadge severity={f.severity} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {feed.length === 0 && (
                <p className="text-sm text-slate-500 py-6 text-center">
                  {paused ? "Paused." : "Starting replay..."}
                </p>
              )}
            </div>
          </GlassCard>
        </>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-50 glass-panel p-4 w-80 shadow-glowPink ${
              toast.severity === "critical" ? "border-neon-pink/60 animate-pulse-glow" : "border-neon-pink/30"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="w-4 h-4 text-neon-pink" />
              <p className="text-sm font-semibold text-white">{toast.label} detected</p>
            </div>
            <p className="text-xs text-slate-400 font-mono">{toast.sourceIp} → {toast.destinationIp}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
