import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { allowlistEntryInputSchema, MAX_ALLOWLIST_ENTRIES } from "@sentinel/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Form";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatExact } from "@/lib/format";
import { useDetectionSettings, useOrgMutation } from "@/lib/queries";
import type { DetectionSettings } from "@/lib/types";

type Row = { cidr: string; note: string; addedBy?: string | null; addedAt?: string };

function Editor({ settings, editable }: { settings: DetectionSettings; editable: boolean }) {
  const toast = useToast();
  const [percent, setPercent] = useState(String(Math.round(settings.modelAlertMinConfidence * 100)));
  const [rows, setRows] = useState<Row[]>(settings.allowlist);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const save = useOrgMutation(
    (body: { modelAlertMinConfidence: number; allowlist: { cidr: string; note: string }[] }) => api<DetectionSettings>("/detection/settings", { method: "PATCH", body }),
    ["detectionSettings"],
  );

  const pct = Number(percent);
  const pctInvalid = percent.trim() === "" || !Number.isFinite(pct) || pct < 0 || pct > 100;
  const submit = () => {
    const found: Record<number, string> = {};
    rows.forEach((r, i) => {
      const res = allowlistEntryInputSchema.safeParse({ cidr: r.cidr, note: r.note });
      if (!res.success) found[i] = res.error.issues[0]?.message ?? "Invalid entry";
    });
    setErrors(found);
    if (pctInvalid || Object.keys(found).length) return;
    save.mutate(
      { modelAlertMinConfidence: pct / 100, allowlist: rows.map((r) => ({ cidr: r.cidr.trim(), note: r.note.trim() })) },
      {
        onSuccess: (saved) => {
          setRows(saved.allowlist);
          toast.success("Detection settings saved");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };
  const set = (i: number, k: "cidr" | "note", v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Minimum model confidence for alerts" subtitle="Model verdicts below this confidence stay on their flows (see Flows) but do not become alerts. Rules are not affected." />
        <CardBody className="space-y-3 text-small">
          <label className="flex flex-wrap items-center gap-2 text-fg-1">
            <span>Alert only when the model is at least</span>
            <Input type="number" min={0} max={100} step={5} value={percent} onChange={(e) => setPercent(e.target.value)} disabled={!editable} aria-invalid={pctInvalid} aria-label="Minimum confidence in percent" className="w-24" />
            <span>% confident (0 = every malicious verdict alerts).</span>
          </label>
          {pctInvalid && <p className="text-sevfg-critical">Enter a number between 0 and 100.</p>}
          <p className="text-fg-3">
            Separately, model-only alerts below {Math.round(settings.needsReviewThreshold * 100)} % are marked “needs review”. Verdicts kept out of alerts so far:{" "}
            {formatExact(settings.suppressedVerdicts.belowMinConfidence)} below the minimum, {formatExact(settings.suppressedVerdicts.allowlisted)} allowlisted.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Allowlist"
          subtitle="Addresses or networks you trust (your vulnerability scanner, a CDN). Flows involving them on either side raise no alert from the model or from rules. Each entry needs a reason."
        />
        <CardBody className="space-y-3 text-small">
          {rows.length === 0 && <p className="text-fg-3">No trusted address yet.</p>}
          <ul className="space-y-3">
            {rows.map((r, i) => (
              <li key={i} className="rounded-md border border-subtle p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Input value={r.cidr} onChange={(e) => set(i, "cidr", e.target.value)} disabled={!editable} placeholder="203.0.113.0/24" aria-label={`Address or network ${i + 1}`} aria-invalid={Boolean(errors[i])} className="w-52 font-mono" />
                  <Input value={r.note} onChange={(e) => set(i, "note", e.target.value)} disabled={!editable} placeholder="Why it is trusted" aria-label={`Reason ${i + 1}`} className="min-w-0 flex-1" maxLength={200} />
                  {editable && (
                    <Button size="sm" variant="ghost" aria-label={`Remove ${r.cidr || `entry ${i + 1}`}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {errors[i] && <p className="mt-1 text-caption text-sevfg-critical">{errors[i]}</p>}
                {r.addedAt && <p className="mt-1 text-caption text-fg-3">Added by {r.addedBy ?? "a former member"} on {formatDateTime(r.addedAt)}</p>}
              </li>
            ))}
          </ul>
          {editable && rows.length < MAX_ALLOWLIST_ENTRIES && (
            <Button size="sm" onClick={() => setRows((rs) => [...rs, { cidr: "", note: "" }])}>
              <Plus aria-hidden className="h-4 w-4" /> Add an address or network
            </Button>
          )}
          <p className="text-fg-3">
            Trusting an address hides real attacks that involve it, too. Changes apply to evidence processed after saving; existing alerts are not changed. Every change is recorded in the{" "}
            <Link to="/audit" className="text-accent-fg underline underline-offset-2">
              audit log
            </Link>
            .
          </p>
        </CardBody>
      </Card>

      {editable ? (
        <div className="flex justify-end">
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save detection settings
          </Button>
        </div>
      ) : (
        <p className="text-small text-fg-3">Only Owners and Admins can change these settings.</p>
      )}
    </div>
  );
}

/** Alert noise controls: minimum model confidence and trusted addresses. */
export function DetectionTuning() {
  const { can } = useAuth();
  const q = useDetectionSettings();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  // Keyed on the saved values so a refetch resets the form to what the server holds.
  return <Editor key={JSON.stringify(q.data.allowlist) + q.data.modelAlertMinConfidence} settings={q.data} editable={can("rules:manage")} />;
}
