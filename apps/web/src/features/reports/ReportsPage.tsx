import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, PageHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { apiDownload, errorMessage, saveBlob } from "@/lib/api";
import { useOverview } from "@/lib/queries";
import { ExecutivePreview } from "./ExecutivePreview";
import { useExecutiveReport } from "./queries";
import { lastDays, rangeError, readRange, toIsoRange, writeRange, type DayRange } from "./range";

/** Executive report: pick a period (kept in the URL), read it here, download the same content as a PDF. */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const range = readRange(params);
  const error = rangeError(range);
  const iso = toIsoRange(range);
  const report = useExecutiveReport(iso, !error);
  const overview = useOverview();
  const [downloading, setDownloading] = useState(false);
  const set = (r: DayRange) => setParams(writeRange(params, r), { replace: true });
  const span = overview.data?.dataRange ? { from: overview.data.dataRange.from.slice(0, 10), to: overview.data.dataRange.to.slice(0, 10) } : null;

  const download = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await apiDownload("/reports/executive/pdf", { query: iso });
      saveBlob(blob, filename);
      toast.success(`Saved ${filename}`);
    } catch (e) {
      toast.error(`Could not generate the PDF: ${errorMessage(e)}`);
    } finally {
      setDownloading(false);
    }
  };

  const r = report.data;
  const nothing = r && r.flows.totalFlows === 0 && r.alerts.total === 0 && r.incidents.total === 0;

  return (
    <>
      <PageHeader
        title="Reports"
        description="The numbers on the Command Center, for a period you choose, with where they come from and what they cannot tell you. The PDF carries exactly what you see here."
        actions={
          <Button variant="primary" loading={downloading} disabled={Boolean(error) || !r} onClick={() => void download()}>
            <Download aria-hidden className="h-4 w-4" /> Download PDF
          </Button>
        }
      />
      <Card className="mb-6">
        <CardBody>
          <form className="flex flex-wrap items-end gap-4" aria-label="Report period" onSubmit={(e) => e.preventDefault()}>
            <label className="text-caption text-fg-3">
              From (UTC day)
              <Input type="date" className="mt-1 w-44" value={range.from ?? ""} max={range.to ?? undefined} onChange={(e) => set({ ...range, from: e.target.value || null })} />
            </label>
            <label className="text-caption text-fg-3">
              To (UTC day, included)
              <Input type="date" className="mt-1 w-44" value={range.to ?? ""} min={range.from ?? undefined} onChange={(e) => set({ ...range, to: e.target.value || null })} />
            </label>
            <div role="group" aria-label="Quick periods" className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => set({ from: null, to: null })}>
                All stored data
              </Button>
              <Button size="sm" onClick={() => set(lastDays(7))}>
                Last 7 days
              </Button>
              <Button size="sm" onClick={() => set(lastDays(30))}>
                Last 30 days
              </Button>
              <Button size="sm" disabled={!span} onClick={() => span && set(span)} title={span ? `Flows from ${span.from} to ${span.to}` : "No flows stored yet"}>
                Span of stored flows
              </Button>
            </div>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-small text-sevfg-high">
              {error}
            </p>
          )}
        </CardBody>
      </Card>
      {error ? null : report.isLoading ? (
        <div role="status" aria-label="Loading report" className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      ) : report.isError ? (
        <Card>
          <ErrorState error={report.error} title="Couldn’t build the report" onRetry={() => void report.refetch()} />
        </Card>
      ) : nothing ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-7 w-7" strokeWidth={1.75} />}
            title="No flows, alerts or incidents in this period"
            description="Flows are placed by when the traffic happened, so an imported capture from another year needs its own period. Try “Span of stored flows”."
          />
        </Card>
      ) : r ? (
        <ExecutivePreview report={r} />
      ) : null}
    </>
  );
}
