import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Overlays";
import { Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatExact } from "@/lib/format";
import { useOrgMutation, useReapplyStatus } from "@/lib/queries";
import type { ReapplyPlan } from "@/lib/types";

function Consequence({ plan }: { plan: ReapplyPlan }) {
  return (
    <span className="block space-y-2">
      <span className="block">
        Sentinel will delete and rebuild <strong>{formatExact(plan.alertsRebuilt)}</strong> alert(s) and <strong>{formatExact(plan.incidentsRebuilt)}</strong> automatically grouped incident(s) from the
        verdicts and rule hits already stored, using the saved minimum confidence, allowlist and rules.
      </span>
      <span className="block">
        Left exactly as they are: <strong>{formatExact(plan.alertsKept)}</strong> alert(s) and <strong>{formatExact(plan.incidentsKept)}</strong> incident(s) that someone triaged, assigned, commented on or created.
        Flows and their verdicts are not changed. Rebuilt alerts get new identifiers, so links to them from outside Sentinel will stop working. Do not import data while it runs. It is recorded in the audit log.
      </span>
    </span>
  );
}

/** Applies the saved noise settings to alerts that already exist (they otherwise only affect new evidence). */
export function ReapplyCard() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useReapplyStatus();
  const [confirm, setConfirm] = useState(false);
  const start = useOrgMutation(() => api<{ started: boolean; preview: ReapplyPlan }>("/detection/reapply", { method: "POST", body: {} }), ["reapplyStatus"]);
  const running = status.data?.running ?? false;
  const finishedAt = status.data?.last?.at ?? null;
  const seenFinish = useRef<string | null | undefined>(undefined);

  // Alerts, incidents and counters changed underneath every page: refetch them when a new run has finished
  // (the first value read on load is not a new run).
  useEffect(() => {
    if (status.data === undefined) return;
    if (seenFinish.current !== undefined && seenFinish.current !== finishedAt) void qc.invalidateQueries();
    seenFinish.current = finishedAt;
  }, [status.data, finishedAt, qc]);

  const editable = can("rules:manage");
  const last = status.data?.last;
  return (
    <Card>
      <CardHeader
        title="Apply these settings to existing alerts"
        subtitle="Saving settings only affects evidence processed afterwards. This rebuilds alerts and incidents nobody has worked on, so the list matches what the settings would produce."
      />
      <CardBody className="space-y-3 text-small">
        {status.isLoading ? (
          <Skeleton className="h-16" />
        ) : status.isError ? (
          <p className="text-sevfg-high" role="alert">
            {errorMessage(status.error)}
          </p>
        ) : (
          <>
            {status.data && (
              <p className="text-fg-2">
                Right now: {formatExact(status.data.preview.alertsRebuilt)} alert(s) and {formatExact(status.data.preview.incidentsRebuilt)} incident(s) would be rebuilt;{" "}
                {formatExact(status.data.preview.alertsKept)} alert(s) and {formatExact(status.data.preview.incidentsKept)} incident(s) with analyst work stay as they are.
              </p>
            )}
            {running && (
              <p role="status" className="font-medium text-fg-1">
                Rebuilding alerts in the background… this page updates when it finishes.
              </p>
            )}
            {!running && last?.status === "done" && last.after && (
              <p className="text-fg-2" role="status">
                Last run {formatDateTime(last.at)}: {formatExact(last.after.alerts)} alert(s) and {formatExact(last.after.incidents)} incident(s) after rebuilding;{" "}
                {formatExact(last.after.suppressedVerdicts.belowMinConfidence)} verdict(s) below the minimum and {formatExact(last.after.suppressedVerdicts.allowlisted)} allowlisted kept out of alerts.
              </p>
            )}
            {!running && last?.status === "failed" && (
              <p className="text-sevfg-high" role="alert">
                The last run ({formatDateTime(last.at)}) failed: {last.error ?? "unknown error"}. Nothing else changed; run it again.
              </p>
            )}
          </>
        )}
        {editable ? (
          <div>
            <Button variant="primary" disabled={running || status.isLoading || !status.data} loading={start.isPending} onClick={() => setConfirm(true)}>
              Rebuild alerts with the saved settings
            </Button>
          </div>
        ) : (
          <p className="text-fg-3">Only Owners and Admins can rebuild alerts.</p>
        )}
      </CardBody>
      {status.data && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Rebuild alerts with the saved settings?"
          consequence={<Consequence plan={status.data.preview} />}
          confirmLabel="Rebuild alerts"
          loading={start.isPending}
          onConfirm={() =>
            start.mutate(undefined, {
              onSuccess: () => {
                setConfirm(false);
                toast.success("Rebuild started");
              },
              onError: (e) => {
                setConfirm(false);
                toast.error(errorMessage(e));
              },
            })
          }
        />
      )}
    </Card>
  );
}
