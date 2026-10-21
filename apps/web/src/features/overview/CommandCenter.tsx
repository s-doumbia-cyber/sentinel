import { CheckCircle2, Circle, FlaskConical, Upload } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const steps = [
    { done: hasDataset, title: t("overview.stepFlowsTitle"), body: t("overview.stepFlowsBody"), to: "/datasets", cta: t("overview.stepFlowsCta"), icon: Upload },
    { done: hasActiveModel, title: t("overview.stepModelTitle"), body: t("overview.stepModelBody"), to: "/models", cta: t("overview.stepModelCta"), icon: FlaskConical },
  ];
  return (
    <Card>
      <CardHeader title={t("overview.getStarted")} subtitle={t("overview.getStartedSubtitle")} />
      <CardBody>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-wrap items-start gap-4 rounded-md border border-subtle p-4">
              {s.done ? <CheckCircle2 aria-label={t("common.done")} className="h-5 w-5 text-sevfg-ok" /> : <Circle aria-label={t("common.toDo")} className="h-5 w-5 text-fg-3" />}
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
  const { t } = useTranslation();
  const models = useModels();
  const scoring = useScoringStatus();
  const schema = scoring.data?.schemas.find((s) => s.schema === "cicids2017-v1");
  const active = models.data?.items.find((m) => m.active);
  return (
    <Card>
      <CardHeader
        title={t("overview.modelHealth")}
        subtitle={t("overview.modelHealthSubtitle")}
        actions={
          <Link to="/models" className="text-small text-accent-fg hover:underline">
            {t("overview.models")}
          </Link>
        }
      />
      <CardBody className="space-y-3 text-small">
        {models.isLoading ? (
          <Skeleton className="h-16" />
        ) : models.isError ? (
          <p className="text-fg-2">{t("overview.mlUnreachable")}</p>
        ) : active ? (
          <>
            <p className="font-mono text-fg-1">{active.version}</p>
            <p className="text-fg-2">
              <Trans
                i18nKey="overview.testMacroF1"
                values={{ f1: formatScore(active.metrics.macroF1), rows: active.metrics.testRows, kind: active.kind }}
                components={{ strong: <span className="tnum font-medium text-fg-1" /> }}
              />
            </p>
            {active.versionWarnings.length > 0 && <p className="text-sevfg-high">{t("overview.versionMismatch", { warnings: active.versionWarnings.join("; ") })}</p>}
          </>
        ) : (
          <p className="text-fg-2">{t("overview.noActiveModel")}</p>
        )}
        {schema && (
          <p className="text-fg-3">
            {t("overview.scoringCounts", { pending: schema.pending, scored: schema.scored, errors: schema.error })} {scoring.data?.running && t("overview.scoringRunning")}
          </p>
        )}
        <p className="text-caption text-fg-3">{t("overview.driftHint")}</p>
      </CardBody>
    </Card>
  );
}

export function CommandCenter() {
  const { t } = useTranslation();
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
        title={t("overview.title")}
        description={
          o?.dataRange ? (
            <span className="flex flex-wrap items-center gap-2">
              {t("overview.dataRange", { from: formatDateTime(o.dataRange.from), to: formatDateTime(o.dataRange.to) })}
              {Object.entries(o.bySourceKind).map(([k, n]) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <SourceKindBadge kind={k as SourceKind} />
                  <span className="tnum text-caption text-fg-3">{n}</span>
                </span>
              ))}
            </span>
          ) : (
            t("overview.description")
          )
        }
      />
      {empty ? (
        <Onboarding hasDataset={Boolean(datasets.data?.items.length)} hasActiveModel={Boolean(models.data?.items.some((m) => m.active))} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard label={t("overview.kpiFlows")} value={o?.totalFlows} loading={!o} to="/flows" />
            <KpiCard
              label={t("overview.kpiActiveAlerts")}
              value={activeAlerts}
              loading={alertSummary.isLoading}
              hint={alertSummary.data?.activeBySeverity.critical ? t("overview.kpiCritical", { count: alertSummary.data.activeBySeverity.critical }) : undefined} to="/alerts" tone="alert" />
            <KpiCard label={t("overview.kpiMalicious")} value={o?.maliciousFlows} loading={!o} to="/flows?verdict=malicious" />
            <KpiCard label={t("overview.kpiSources")} value={o?.maliciousSourceIps} loading={!o} to="/flows?verdict=malicious" />
            <KpiCard label={t("overview.kpiNeedsReview")} value={o?.needsReviewFlows} loading={!o} hint={t("overview.kpiNeedsReviewHint")} to="/flows?needsReview=true" />
            <KpiCard label={t("overview.kpiNotScored")} value={o?.pendingFlows} loading={!o} to="/flows?verdict=unscored" />
          </div>
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardHeader title={t("overview.flowVolume")} subtitle={series.data ? t("overview.flowVolumeSubtitle", { interval: t(`overview.interval.${series.data.interval}`) }) : "UTC"} />
              <CardBody>
                {series.isLoading ? (
                  <Skeleton className="h-64" />
                ) : series.isError ? (
                  <ErrorState error={series.error} onRetry={() => void series.refetch()} />
                ) : series.data && series.data.buckets.length ? (
                  <FlowVolumeChart data={series.data} />
                ) : (
                  <EmptyState title={t("overview.noFlowsInRange")} />
                )}
              </CardBody>
            </Card>
            <div className="lg:col-span-4">
              <ModelHealth />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title={t("overview.verdictMix")} subtitle={t("overview.verdictMixSubtitle")} />
              <CardBody>
                {verdicts.isLoading ? (
                  <Skeleton className="h-40" />
                ) : verdicts.isError ? (
                  <ErrorState error={verdicts.error} />
                ) : (
                  <BarList items={(verdicts.data?.items ?? []).map((v) => ({ key: v.key ?? "unknown", count: v.count, href: `/flows?verdict=${v.key}` }))} emptyText={t("overview.noScored")} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("overview.topSources")} subtitle={t("overview.byMalicious")} />
              <CardBody>
                {attackers.isLoading ? (
                  <Skeleton className="h-40" />
                ) : attackers.isError ? (
                  <ErrorState error={attackers.error} />
                ) : (
                  <BarList
                    items={(attackers.data?.items ?? []).map((a) => ({ key: a.key, count: a.count, href: `/flows?verdict=malicious&sourceIp=${encodeURIComponent(a.key)}` }))}
                    render={(k) => <EntityChip value={k} />}
                    emptyText={t("overview.noMalicious")}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("overview.topPorts")} subtitle={t("overview.byMalicious")} />
              <CardBody>
                {ports.isLoading ? (
                  <Skeleton className="h-40" />
                ) : ports.isError ? (
                  <ErrorState error={ports.error} />
                ) : (
                  <BarList
                    items={(ports.data?.items ?? []).map((p) => ({ key: p.key, count: p.count, href: `/flows?verdict=malicious&port=${p.key}` }))}
                    render={(k) => <span className="font-mono">{k}</span>}
                    emptyText={t("overview.noMalicious")}
                  />
                )}
              </CardBody>
            </Card>
          </div>
          <p className="text-caption text-fg-3">
            <NeutralBadge>{t("common.note")}</NeutralBadge> {t("overview.footnote")}
          </p>
        </div>
      )}
    </>
  );
}
