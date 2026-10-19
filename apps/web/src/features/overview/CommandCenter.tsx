import { CheckCircle2, Circle, FlaskConical, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { BarList, FlowVolumeChart } from "@/components/charts/Charts";
import { NeutralBadge, SourceKindBadge } from "@/components/ui/Badges";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { EntityChip, KpiCard } from "@/components/ui/Data";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { formatDateTime, formatScore } from "@/lib/format";
import { useAlertSummary, useBreakdown, useDatasets, useModels, useOverview, useScoringStatus, useTimeseries, useTop } from "@/lib/queries";
import type { SourceKind } from "@sentinel/shared";

function Onboarding({ hasDataset, hasActiveModel }: { hasDataset: boolean; hasActiveModel: boolean }) {
  const steps = [
    { done: hasDataset, title: "Bring in network flows", body: "Import a CICIDS2017-style CSV. Live collection arrives with the collector (roadmap Phase 2).", to: "/datasets", cta: "Import a dataset", icon: Upload },
    { done: hasActiveModel, title: "Activate a detection model", body: "Pick a trained model and read its model card first. Flows stay unscored until you do.", to: "/models", cta: "Open models", icon: FlaskConical },
  ];
  return (
    <Card>
      <CardHeader title="Get started" subtitle="This organisation has no flows yet, so there is nothing to summarise." />
      <CardBody>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-wrap items-start gap-4 rounded-md border border-subtle p-4">
              {s.done ? <CheckCircle2 aria-label="Done" className="h-5 w-5 text-sevfg-ok" /> : <Circle aria-label="To do" className="h-5 w-5 text-fg-3" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg-1">
                  {i + 1}. {s.title}
                </p>
                <p className="text-small text-fg-2">{s.body}</p>
              </div>
              {!s.done && (
                <Link to={s.to} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-solid px-3 text-small font-medium text-accent-contrast">
                  <s.icon aria-hidden className="h-4 w-4" /> {s.cta}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function ModelHealth() {
  const models = useModels();
  const scoring = useScoringStatus();
  const schema = scoring.data?.schemas.find((s) => s.schema === "cicids2017-v1");
  const active = models.data?.items.find((m) => m.active);
  return (
    <Card>
      <CardHeader title="Model health" subtitle="Benchmark schema cicids2017-v1" actions={<Link to="/models" className="text-small text-accent-fg hover:underline">Models</Link>} />
      <CardBody className="space-y-3 text-small">
        {models.isLoading ? (
          <Skeleton className="h-16" />
        ) : models.isError ? (
          <p className="text-fg-2">ML service unreachable: models cannot be listed. Flows keep being stored unscored.</p>
        ) : active ? (
          <>
            <p className="font-mono text-fg-1">{active.version}</p>
            <p className="text-fg-2">
              Test macro-F1 <span className="tnum font-medium text-fg-1">{formatScore(active.metrics.macroF1)}</span> on {active.metrics.testRows} rows ({active.kind})
            </p>
            {active.versionWarnings.length > 0 && <p className="text-sevfg-high">Library version mismatch: {active.versionWarnings.join("; ")}</p>}
          </>
        ) : (
          <p className="text-fg-2">No active model. Flows are stored but not scored.</p>
        )}
        {schema && (
          <p className="text-fg-3">
            {schema.pending} pending · {schema.scored} scored · {schema.error} errors {scoring.data?.running && "· scoring in progress"}
          </p>
        )}
        <p className="text-caption text-fg-3">No drift monitoring yet (roadmap 1.9).</p>
      </CardBody>
    </Card>
  );
}

export function CommandCenter() {
  const overview = useOverview();
  const datasets = useDatasets();
  const models = useModels();
  const series = useTimeseries();
  const verdicts = useBreakdown("verdict");
  const attackers = useTop("attackers");
  const ports = useTop("ports");
  const alertSummary = useAlertSummary();
  const activeAlerts = alertSummary.data ? Object.values(alertSummary.data.activeBySeverity).reduce((a, b) => a + (b ?? 0), 0) : undefined;

  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  const empty = o && o.totalFlows === 0;

  return (
    <>
      <PageHeader
        title="Command Center"
        description={
          o?.dataRange ? (
            <span className="flex flex-wrap items-center gap-2">
              Data from {formatDateTime(o.dataRange.from)} to {formatDateTime(o.dataRange.to)}
              {Object.entries(o.bySourceKind).map(([k, n]) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <SourceKindBadge kind={k as SourceKind} />
                  <span className="tnum text-caption text-fg-3">{n}</span>
                </span>
              ))}
            </span>
          ) : (
            "What the detection models found in your network flows."
          )
        }
      />
      {empty ? (
        <Onboarding hasDataset={Boolean(datasets.data?.items.length)} hasActiveModel={Boolean(models.data?.items.some((m) => m.active))} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Flows" value={o?.totalFlows} loading={!o} to="/flows" />
            <KpiCard label="Active alerts" value={activeAlerts} loading={alertSummary.isLoading} hint={alertSummary.data?.activeBySeverity.critical ? `${alertSummary.data.activeBySeverity.critical} critical` : undefined} to="/alerts" tone="alert" />
            <KpiCard label="Malicious verdicts" value={o?.maliciousFlows} loading={!o} to="/flows?verdict=malicious" />
            <KpiCard label="Malicious sources" value={o?.maliciousSourceIps} loading={!o} to="/flows?verdict=malicious" />
            <KpiCard label="Needs review" value={o?.needsReviewFlows} loading={!o} hint="Below confidence threshold" to="/flows?needsReview=true" />
            <KpiCard label="Not scored" value={o?.pendingFlows} loading={!o} to="/flows?verdict=unscored" />
          </div>
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardHeader title="Flow volume" subtitle={series.data ? `Per ${series.data.interval}, UTC · malicious = model verdict` : "UTC"} />
              <CardBody>
                {series.isLoading ? (
                  <Skeleton className="h-64" />
                ) : series.isError ? (
                  <ErrorState error={series.error} onRetry={() => void series.refetch()} />
                ) : series.data && series.data.buckets.length ? (
                  <FlowVolumeChart data={series.data} />
                ) : (
                  <EmptyState title="No flows in this range" />
                )}
              </CardBody>
            </Card>
            <div className="lg:col-span-4">
              <ModelHealth />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Verdict mix" subtitle="Model verdicts on scored flows" />
              <CardBody>
                {verdicts.isLoading ? (
                  <Skeleton className="h-40" />
                ) : verdicts.isError ? (
                  <ErrorState error={verdicts.error} />
                ) : (
                  <BarList items={(verdicts.data?.items ?? []).map((v) => ({ key: v.key ?? "unknown", count: v.count, href: `/flows?verdict=${v.key}` }))} emptyText="No scored flows yet." />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top attacking sources" subtitle="By malicious verdicts" />
              <CardBody>
                {attackers.isLoading ? (
                  <Skeleton className="h-40" />
                ) : attackers.isError ? (
                  <ErrorState error={attackers.error} />
                ) : (
                  <BarList
                    items={(attackers.data?.items ?? []).map((a) => ({ key: a.key, count: a.count, href: `/flows?verdict=malicious&sourceIp=${encodeURIComponent(a.key)}` }))}
                    render={(k) => <EntityChip value={k} />}
                    emptyText="No malicious verdicts."
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top targeted ports" subtitle="By malicious verdicts" />
              <CardBody>
                {ports.isLoading ? (
                  <Skeleton className="h-40" />
                ) : ports.isError ? (
                  <ErrorState error={ports.error} />
                ) : (
                  <BarList
                    items={(ports.data?.items ?? []).map((p) => ({ key: p.key, count: p.count, href: `/flows?verdict=malicious&port=${p.key}` }))}
                    render={(k) => <span className="font-mono">{k}</span>}
                    emptyText="No malicious verdicts."
                  />
                )}
              </CardBody>
            </Card>
          </div>
          <p className="text-caption text-fg-3">
            <NeutralBadge>Note</NeutralBadge> Every number here comes from model verdicts. Dataset labels are only used on the Models page to evaluate those verdicts.
          </p>
        </div>
      )}
    </>
  );
}
