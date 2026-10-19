import { FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ruleDefinitionSchema } from "@sentinel/shared";
import { NeutralBadge, SeverityBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Form";
import { ConfirmDialog, Dialog } from "@/components/ui/Overlays";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatExact } from "@/lib/format";
import { useDatasets, useOrgMutation, useRules } from "@/lib/queries";
import type { Rule, RuleTestResult } from "@/lib/types";
import { describeRule } from "./describe";

const EDITABLE = ["name", "description", "window", "groupBy", "condition", "filter", "severity", "alertType"] as const;

function editableJson(rule: Rule): string {
  return JSON.stringify(Object.fromEntries(EDITABLE.map((k) => [k, rule[k]])), null, 2);
}

const NEW_RULE = JSON.stringify(
  {
    key: "R-CUSTOM-01",
    name: "My rule",
    description: "",
    type: "threshold",
    window: "60s",
    groupBy: ["sourceIp"],
    condition: { distinct: "destinationIp", gte: 50 },
    filter: { protocol: "TCP" },
    severity: "medium",
    alertType: "PortScan",
    enabled: true,
  },
  null,
  2,
);

function issues(err: unknown): string[] {
  if (err instanceof ApiError) return [err.message, ...(err.details ?? []).map((d) => `${d.path ? `${d.path}: ` : ""}${d.message}`)];
  return [errorMessage(err)];
}

/** JSON editor; the server validates again and its messages are shown verbatim. */
function RuleEditor({ rule, onClose }: { rule: Rule | "new"; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(rule === "new" ? NEW_RULE : editableJson(rule));
  const [errors, setErrors] = useState<string[]>([]);
  const save = useOrgMutation(
    (body: unknown) => (rule === "new" ? api<Rule>("/rules", { method: "POST", body }) : api<Rule>(`/rules/${rule.id}`, { method: "PATCH", body })),
    ["rules"],
  );
  const submit = () => {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (e) {
      return setErrors([`Not valid JSON: ${(e as Error).message}`]);
    }
    if (rule === "new") {
      const check = ruleDefinitionSchema.safeParse(body);
      if (!check.success) return setErrors(check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    }
    setErrors([]);
    save.mutate(body, {
      onSuccess: () => {
        toast.success(rule === "new" ? "Rule created" : "Rule updated; it applies to the next flows evaluated");
        onClose();
      },
      onError: (e) => setErrors(issues(e)),
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule === "new" ? "New rule" : `Edit ${rule.key}`}
      description="Threshold rule in JSON (docs/ML_AND_DETECTION.md §7). Changes are versioned and written to the audit log."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {rule === "new" ? "Create rule" : "Save changes"}
          </Button>
        </>
      }
    >
      <label htmlFor="rule-json" className="sr-only">
        Rule definition (JSON)
      </label>
      <Textarea id="rule-json" className="min-h-[320px] font-mono text-caption" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={errors.length > 0} />
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 list-disc space-y-0.5 rounded-md border border-sev-critical/40 bg-sev-critical/10 py-2 pl-7 pr-3 text-caption text-sevfg-critical">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function RuleTester({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const datasets = useDatasets();
  const [datasetId, setDatasetId] = useState("");
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<RuleTestResult>(`/rules/${rule.id}/test`, { method: "POST", body: datasetId ? { datasetId } : {} }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Test ${rule.key}`} description="Replays the rule over stored flows and lists would-be hits. No alert is created.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-caption text-fg-3">
          Flows
          <Select className="mt-1 w-64" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            <option value="">All flows in this organisation</option>
            {datasets.data?.items
              .filter((d) => d.status === "Processed")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </label>
        <Button variant="primary" loading={busy} onClick={() => void run()}>
          Run test
        </Button>
      </div>
      {error !== null && <ErrorState error={error} className="py-6" />}
      {result && (
        <div className="mt-4 space-y-2 text-small">
          <p className="text-fg-1">
            <span className="tnum font-semibold">{formatExact(result.hitCount)}</span> hit{result.hitCount === 1 ? "" : "s"} over <span className="tnum">{formatExact(result.flowsScanned)}</span> flows
            {result.truncated && " (stopped at the scan limit)"}.
          </p>
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {result.hits.map((h, i) => (
              <li key={i} className="rounded-sm bg-surface-1 px-2 py-1.5 font-mono text-caption text-fg-2">
                {Object.entries(h.group)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ")}{" "}
                · value {h.value} · {formatDateTime(h.windowStart)} → {formatDateTime(h.windowEnd)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

export function RulesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const rules = useRules();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [testing, setTesting] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const toggle = useOrgMutation(({ id, enabled }: { id: string; enabled: boolean }) => api<Rule>(`/rules/${id}`, { method: "PATCH", body: { enabled } }), ["rules"]);
  const del = useOrgMutation((id: string) => api(`/rules/${id}`, { method: "DELETE" }), ["rules"]);
  const manage = can("rules:manage");

  return (
    <>
      <PageHeader
        title="Detection rules"
        description="Threshold rules complement the model: they catch patterns it was not trained on and stay under your control. Starter thresholds are starting points; test them on your own traffic."
        actions={
          manage && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus aria-hidden className="h-4 w-4" /> New rule
            </Button>
          )
        }
      />
      {rules.isLoading ? (
        <Card>
          <SkeletonRows rows={5} cols={3} />
        </Card>
      ) : rules.isError ? (
        <Card>
          <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
        </Card>
      ) : !rules.data?.items.length ? (
        <Card>
          <EmptyState title="No rules" />
        </Card>
      ) : (
        <ul className="space-y-3">
          {rules.data.items.map((r) => (
            <li key={r.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-fg-1">
                      {r.name}
                      <span className="font-mono text-caption text-fg-3">
                        {r.key} v{r.version}
                      </span>
                      <SeverityBadge severity={r.severity} />
                      <NeutralBadge>alert: {r.alertType}</NeutralBadge>
                      {r.starter && <NeutralBadge>starter</NeutralBadge>}
                      {!r.enabled && <NeutralBadge className="bg-sev-medium/15 text-sevfg-medium">disabled</NeutralBadge>}
                    </p>
                    <p className="mt-1 text-small text-fg-2">{describeRule(r)}</p>
                    {r.description && <p className="mt-1 text-caption text-fg-3">{r.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {manage && (
                      <label className="flex items-center gap-2 text-small text-fg-2">
                        <input
                          type="checkbox"
                          role="switch"
                          className="h-4 w-4 accent-[rgb(var(--accent))]"
                          checked={r.enabled}
                          disabled={toggle.isPending}
                          onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked }, { onError: (err) => toast.error(errorMessage(err)) })}
                        />
                        Enabled
                      </label>
                    )}
                    {can("rules:test") && (
                      <Button size="sm" onClick={() => setTesting(r)}>
                        <FlaskConical aria-hidden className="h-4 w-4" /> Test
                      </Button>
                    )}
                    {manage && (
                      <Button size="sm" variant="ghost" aria-label={`Edit ${r.key}`} onClick={() => setEditing(r)}>
                        <Pencil aria-hidden className="h-4 w-4" />
                      </Button>
                    )}
                    {manage && !r.starter && (
                      <Button size="sm" variant="ghost" aria-label={`Delete ${r.key}`} onClick={() => setDeleting(r)}>
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-caption text-fg-3">Rules run over each imported dataset, and over every flow when you choose “Run detections” on the Alerts page. Existing alerts are not recomputed when a rule changes.</p>
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
      {testing && <RuleTester rule={testing} onClose={() => setTesting(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.key ?? "rule"}?`}
        consequence="The rule stops running. Alerts it already raised are kept. The audit log keeps the deleted definition."
        confirmLabel="Delete rule"
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.success("Rule deleted");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
