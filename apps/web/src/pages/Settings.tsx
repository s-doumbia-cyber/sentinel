import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlowButton } from "@/components/ui/GlowButton";
import { LoadingBlock, ErrorBlock } from "@/components/ui/AsyncStates";
import { useAuth } from "@/contexts/AuthContext";
import { useAsyncData } from "@/hooks/useAsyncData";
import { sessionsApi, accountApi, type SessionResponse } from "@/services/account";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Check, Download, Laptop, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      className={`focus-ring w-14 h-7 rounded-full transition-colors duration-200 relative border ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      } ${checked ? "bg-grad-violet-pink border-transparent" : "bg-white/[0.06] border-white/[0.12]"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? "translate-x-7" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function SavedIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "saving") return <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />;
  if (status === "saved") return <Check className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "error") return <span className="text-xs text-neon-pink">Failed to save</span>;
  return null;
}

const ACCENT_OPTIONS: { id: "violet" | "cyan" | "pink"; label: string; swatch: string }[] = [
  { id: "violet", label: "Violet", swatch: "linear-gradient(135deg, #8B5CF6, #EC4899)" },
  { id: "cyan", label: "Cyan", swatch: "linear-gradient(135deg, #22D3EE, #8B5CF6)" },
  { id: "pink", label: "Pink", swatch: "linear-gradient(135deg, #EC4899, #F0399B)" },
];

const ROLE_EXPLANATION: Record<string, string> = {
  Admin: "Full access: manage datasets, incidents, and everyone's role.",
  Analyst: "Can create/update incidents and import datasets. Can't manage other users.",
  Viewer: "Read-only access across the dashboard.",
};

export default function Settings() {
  const { user, updateProfile, changePassword, logout, logoutAll, deleteAccount } = useAuth();
  const navigate = useNavigate();

  // Profile
  const [name, setName] = useState(user?.name ?? "");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileStatus, setProfileStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Preferences (notifications/language/accent)
  const [prefStatus, setPrefStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Security
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pwMessage, setPwMessage] = useState("");
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  // Account
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    data: sessions,
    loading: sessionsLoading,
    error: sessionsError,
  } = useAsyncData(() => sessionsApi.list(), [], "sessions");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [localSessions, setLocalSessions] = useState<SessionResponse[] | null>(null);
  const displayedSessions = localSessions ?? sessions;

  async function savePreferences(patch: Partial<{ emailAlerts: boolean; pushAlerts: boolean; language: string; accentColor: string }>) {
    setPrefStatus("saving");
    try {
      await updateProfile({ preferences: patch as any });
      setPrefStatus("saved");
      setTimeout(() => setPrefStatus("idle"), 1500);
    } catch {
      setPrefStatus("error");
    }
  }

  async function saveProfile() {
    setProfileStatus("saving");
    try {
      await updateProfile({ name });
      setProfileStatus("saved");
      setEditingProfile(false);
      setTimeout(() => setProfileStatus("idle"), 1500);
    } catch {
      setProfileStatus("error");
    }
  }

  async function handleChangePassword() {
    setPwStatus("saving");
    setPwMessage("");
    try {
      const message = await changePassword(currentPw, newPw);
      setPwStatus("saved");
      setPwMessage(message);
      setCurrentPw("");
      setNewPw("");
    } catch (err: any) {
      setPwStatus("error");
      setPwMessage(err?.response?.data?.message || "Failed to change password");
    }
  }

  async function handleRevokeSession(id: string) {
    setRevokingId(id);
    try {
      await sessionsApi.revoke(id);
      setLocalSessions((displayedSessions || []).filter((s) => s.id !== id));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleLogoutAll() {
    setLoggingOutAll(true);
    await logoutAll();
    navigate("/login");
  }

  async function handleExportData() {
    const data = await accountApi.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sentinel-my-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    await deleteAccount();
    navigate("/login");
  }

  const prefs = user?.preferences;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Profile, security, notifications and language — saved to your account in MongoDB" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard>
          <p className="text-sm font-semibold text-slate-200 mb-4">Profile</p>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-grad-blue-violet flex items-center justify-center text-sm font-semibold text-white shrink-0">
              {(user?.name ?? "AN").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              {editingProfile ? (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-1.5 px-2 text-sm text-slate-200 focus-ring focus:border-neon-violet/50"
                  autoFocus
                />
              ) : (
                <p className="text-sm font-medium text-slate-200">{user?.name}</p>
              )}
              <p className="text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingProfile ? (
              <>
                <GlowButton onClick={saveProfile} disabled={profileStatus === "saving"}>
                  {profileStatus === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                </GlowButton>
                <GlowButton
                  variant="ghost"
                  onClick={() => {
                    setEditingProfile(false);
                    setName(user?.name ?? "");
                  }}
                >
                  Cancel
                </GlowButton>
              </>
            ) : (
              <GlowButton variant="ghost" onClick={() => setEditingProfile(true)}>
                Edit profile
              </GlowButton>
            )}
            <SavedIndicator status={profileStatus} />
          </div>
        </GlassCard>

        <GlassCard delay={0.03}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-slate-200">Account & Role</p>
            <SavedIndicator status={prefStatus} />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-neon-violetStrong shrink-0" />
            <span className="text-sm text-slate-200 font-medium">{user?.role}</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">{user?.role ? ROLE_EXPLANATION[user.role] : ""}</p>
          <div className="flex flex-wrap gap-2">
            <GlowButton variant="ghost" onClick={handleExportData}>
              <Download className="w-4 h-4" /> Export my data
            </GlowButton>
          </div>
        </GlassCard>

        <GlassCard delay={0.05}>
          <p className="text-sm font-semibold text-slate-200 mb-4">Appearance</p>
          <p className="text-xs text-slate-500 mb-3">Accent color — changes buttons, active nav, and highlights across the whole app.</p>
          <div className="flex gap-3">
            {ACCENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => savePreferences({ accentColor: opt.id })}
                className={`focus-ring w-12 h-12 rounded-xl border-2 transition-all ${
                  prefs?.accentColor === opt.id ? "border-white scale-105" : "border-transparent opacity-70 hover:opacity-100"
                }`}
                style={{ background: opt.swatch }}
                title={opt.label}
                aria-label={opt.label}
              />
            ))}
          </div>
        </GlassCard>

        <GlassCard delay={0.07}>
          <p className="text-sm font-semibold text-slate-200 mb-4">Language</p>
          <select
            value={prefs?.language ?? "English"}
            onChange={(e) => savePreferences({ language: e.target.value })}
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 focus-ring focus:border-neon-violet/50"
          >
            <option>English</option>
            <option>Français</option>
            <option>हिन्दी (Hindi)</option>
          </select>
          <p className="text-xs text-slate-500 mt-2">Saved to your account — actual UI translation isn&apos;t wired up yet.</p>
        </GlassCard>

        <GlassCard delay={0.09} className="lg:col-span-2">
          <p className="text-sm font-semibold text-slate-200 mb-4">Notifications</p>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-300">Email alerts</span>
            <Toggle checked={prefs?.emailAlerts ?? true} onChange={(v) => savePreferences({ emailAlerts: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Push alerts</span>
            <Toggle checked={prefs?.pushAlerts ?? true} onChange={(v) => savePreferences({ pushAlerts: v })} />
          </div>
        </GlassCard>

        <GlassCard delay={0.12} className="lg:col-span-2">
          <p className="text-sm font-semibold text-slate-200 mb-4">Change Password</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <input
              type="password"
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 focus-ring focus:border-neon-violet/50"
            />
            <input
              type="password"
              placeholder="New password (min 8 characters)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 focus-ring focus:border-neon-violet/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <GlowButton onClick={handleChangePassword} disabled={pwStatus === "saving" || !currentPw || newPw.length < 8}>
              {pwStatus === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
            </GlowButton>
          </div>
          {pwMessage && (
            <p className={`text-xs mt-2 ${pwStatus === "error" ? "text-neon-pink" : "text-emerald-400"}`}>{pwMessage}</p>
          )}
        </GlassCard>

        <GlassCard delay={0.15} className="lg:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-slate-200">Active Sessions</p>
            <GlowButton variant="ghost" onClick={handleLogoutAll} disabled={loggingOutAll}>
              {loggingOutAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Sign out everywhere
            </GlowButton>
          </div>
          <p className="text-xs text-slate-500 mb-4">Every device currently signed in to your account, tracked server-side.</p>

          {sessionsLoading && <LoadingBlock label="Loading sessions..." />}
          {sessionsError && <ErrorBlock message={sessionsError} />}

          {displayedSessions && (
            <div className="space-y-2">
              {displayedSessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-white/[0.02] border border-white/[0.05]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Laptop className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300 truncate max-w-md">{s.userAgent || "Unknown device"}</p>
                      <p className="text-[11px] text-slate-500">
                        {s.ip && <>{s.ip} · </>}Last active {new Date(s.lastSeenAt).toLocaleString("en-US")}
                        {s.current && <span className="text-neon-cyan ml-1">(this device)</span>}
                      </p>
                    </div>
                  </div>
                  {!s.current && (
                    <button
                      onClick={() => handleRevokeSession(s.id)}
                      disabled={revokingId === s.id}
                      className="focus-ring text-xs text-slate-500 hover:text-neon-pink transition-colors shrink-0"
                    >
                      {revokingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Revoke"}
                    </button>
                  )}
                </div>
              ))}
              {displayedSessions.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No active sessions.</p>}
            </div>
          )}
        </GlassCard>

        <GlassCard delay={0.2} className="lg:col-span-2">
          <p className="text-sm font-semibold text-slate-200 mb-4">API Configuration</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">API Base URL</label>
              <input
                readOnly
                value="https://api.sentinel-soc.local/v1"
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-400 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">API Key</label>
              <input
                readOnly
                value="sk_live_••••••••••••4f2a"
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-400 font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">Placeholder — this project doesn&apos;t expose a public API key system yet.</p>
        </GlassCard>

        <GlassCard delay={0.25} className="lg:col-span-2 border-neon-pink/20">
          <p className="text-sm font-semibold text-neon-pink mb-2">Danger Zone</p>
          <p className="text-xs text-slate-500 mb-4">Permanently deletes your account and all its sessions. This can&apos;t be undone.</p>
          {!deleteConfirm ? (
            <GlowButton variant="ghost" onClick={() => setDeleteConfirm(true)}>
              <Trash2 className="w-4 h-4" /> Delete my account
            </GlowButton>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300">Are you sure? This is permanent.</span>
              <GlowButton onClick={handleDeleteAccount} disabled={deleting} style={{ backgroundImage: "none", backgroundColor: "#F0399B" }}>
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Yes, delete permanently"}
              </GlowButton>
              <GlowButton variant="ghost" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </GlowButton>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
