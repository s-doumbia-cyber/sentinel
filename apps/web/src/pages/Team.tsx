import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { LoadingBlock, ErrorBlock } from "@/components/ui/AsyncStates";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/contexts/AuthContext";
import { usersApi } from "@/services/account";
import { Loader2, ShieldCheck, User as UserIcon } from "lucide-react";

const ROLES = ["Analyst", "Admin", "Viewer"] as const;

const ROLE_STYLE: Record<string, string> = {
  Admin: "text-neon-pink bg-neon-pink/10 border-neon-pink/25",
  Analyst: "text-neon-cyan bg-neon-cyan/10 border-neon-cyan/25",
  Viewer: "text-slate-400 bg-white/[0.05] border-white/[0.1]",
};

export default function Team() {
  const { user: me } = useAuth();
  const { data: users, loading, error, refetch } = useAsyncDataWithRefetch(() => usersApi.list(), []);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");

  if (me && me.role !== "Admin") {
    return (
      <div>
        <PageHeader title="Team" subtitle="Every account registered on this Sentinel instance" />
        <GlassCard hover={false}>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-slate-500 shrink-0" />
            <p className="text-sm text-slate-400">
              Team management is restricted to <span className="text-slate-200 font-medium">Admin</span> accounts.
              You're signed in as <span className="text-slate-200 font-medium">{me.role}</span>.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  async function handleRoleChange(id: string, role: string) {
    setSavingId(id);
    setSaveError("");
    try {
      await usersApi.updateRole(id, role);
      await refetch();
    } catch (err: any) {
      setSaveError(err?.response?.data?.message || "Failed to update role");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle="Every account registered on this Sentinel instance, with role-based access control"
      />

      <GlassCard hover={false} className="mb-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-neon-violetStrong shrink-0 mt-0.5" />
          <p className="text-xs text-slate-400 leading-relaxed">
            <span className="text-slate-200 font-medium">Admin</span> can manage datasets, incidents, and everyone's
            role. <span className="text-slate-200 font-medium">Analyst</span> can create/update incidents and import
            datasets. <span className="text-slate-200 font-medium">Viewer</span> has read-only access. Enforced
            server-side on every mutating request — not just hidden in the UI.
          </p>
        </div>
      </GlassCard>

      {loading && <LoadingBlock label="Loading accounts..." />}
      {error && <ErrorBlock message={error} />}
      {saveError && <p className="text-xs text-neon-pink mb-3">{saveError}</p>}

      {users && (
        <GlassCard hover={false} className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">User</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Role</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-grad-blue-violet flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
                        {u.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-slate-200">
                        {u.name} {u._id === me?.id && <span className="text-xs text-slate-500">(you)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={u.role}
                        disabled={savingId === u._id}
                        onChange={(e) => handleRoleChange(u._id, e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border bg-transparent focus-ring ${ROLE_STYLE[u.role]}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} className="bg-base-900 text-slate-200">
                            {r}
                          </option>
                        ))}
                      </select>
                      {savingId === u._id && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(u.createdAt).toLocaleDateString("en-US")}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                    <UserIcon className="w-5 h-5 mx-auto mb-2 text-slate-500" />
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </GlassCard>
      )}
    </div>
  );
}

function useAsyncDataWithRefetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [tick, setTick] = useState(0);
  const state = useAsyncData(fetcher, [...deps, tick]);
  return { ...state, refetch: async () => setTick((t) => t + 1) };
}
