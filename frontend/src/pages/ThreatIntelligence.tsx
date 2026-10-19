import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { TopPortsBar } from "@/components/charts/TopPortsBar";
import { AttackTypeDonut } from "@/components/charts/AttackTypeDonut";
import { LoadingBlock, ErrorBlock } from "@/components/ui/AsyncStates";
import { useAsyncData } from "@/hooks/useAsyncData";
import { flowsApi } from "@/services/flows";
import { Network, ShieldAlert } from "lucide-react";

export default function ThreatIntelligence() {
  const { data, loading, error } = useAsyncData(async () => {
    const [attackers, subnets, topPorts, severity] = await Promise.all([
      flowsApi.topAttackers(),
      flowsApi.topSubnets(),
      flowsApi.topPorts(),
      flowsApi.severityBreakdown(),
    ]);
    return {
      attackers,
      subnets,
      topPorts: topPorts.map((p) => ({ port: String(p.port), value: p.value })),
      severity,
    };
  }, [], "threat-intelligence");

  const maxAttacks = data ? Math.max(...data.attackers.map((s) => s.attacks), 1) : 1;
  const maxSubnetAttacks = data ? Math.max(...data.subnets.map((s) => s.attacks), 1) : 1;

  return (
    <div>
      <PageHeader title="Threat Intelligence" subtitle="Attribution and severity signals from the imported dataset" />

      {loading && <LoadingBlock label="Aggregating threat data..." />}
      {error && <ErrorBlock message={error} />}

      {data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
            <GlassCard className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-4 h-4 text-neon-violetStrong" />
                <p className="text-sm font-semibold text-slate-200">Most Active Attacking Hosts</p>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Real internal source IPs ranked by attack volume — CICIDS2017 uses a private-IP testbed, so hosts
                (not countries) are the meaningful attribution here.
              </p>

              {data.attackers.length > 0 ? (
                <div className="space-y-3">
                  {data.attackers.map((s) => (
                    <div key={s.sourceIp} className="flex items-center gap-3">
                      <span className="w-32 text-sm text-slate-300 font-mono shrink-0">{s.sourceIp}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-grad-violet-pink"
                          style={{ width: `${(s.attacks / maxAttacks) * 100}%` }}
                        />
                      </div>
                      <span className="w-14 text-right text-xs font-mono text-slate-400">{s.attacks}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-10 text-center">No attacks in the current dataset.</p>
              )}
            </GlassCard>

            <GlassCard delay={0.05}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Severity Distribution</p>
              <p className="text-xs text-slate-500 mb-2">Detected attacks by severity tier</p>
              {data.severity.length > 0 ? (
                <AttackTypeDonut data={data.severity} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No attacks in this dataset.</p>
              )}
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard delay={0.1}>
              <div className="flex items-center gap-2 mb-1">
                <Network className="w-4 h-4 text-neon-cyan" />
                <p className="text-sm font-semibold text-slate-200">Top Attacking Subnets</p>
              </div>
              <p className="text-xs text-slate-500 mb-4">Grouped by first IP octet — surfaces a misbehaving segment even when individual hosts within it look modest alone.</p>
              {data.subnets.length > 0 ? (
                <div className="space-y-3">
                  {data.subnets.map((s) => (
                    <div key={s.subnet} className="flex items-center gap-3">
                      <span className="w-20 text-sm text-slate-300 font-mono shrink-0">{s.subnet}.x.x.x</span>
                      <div className="flex-1 h-2.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-grad-blue-violet"
                          style={{ width: `${(s.attacks / maxSubnetAttacks) * 100}%` }}
                        />
                      </div>
                      <span className="w-14 text-right text-xs font-mono text-slate-400">{s.attacks}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-10 text-center">No attacks in the current dataset.</p>
              )}
            </GlassCard>

            <GlassCard delay={0.15}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Top Target Ports</p>
              <TopPortsBar data={data.topPorts} />
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
