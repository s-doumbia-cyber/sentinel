import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlowButton } from "@/components/ui/GlowButton";
import { AttackTrendChart } from "@/components/charts/AttackTrendChart";
import { AttackTypeDonut } from "@/components/charts/AttackTypeDonut";
import { LoadingBlock, ErrorBlock } from "@/components/ui/AsyncStates";
import { useAsyncData } from "@/hooks/useAsyncData";
import { flowsApi, transformTimeline, type KpiResponse } from "@/services/flows";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function downloadCsv(kpis: KpiResponse, breakdown: { name: string; value: number }[]) {
  const lines = [
    "metric,value",
    `Total Flows,${kpis.totalFlows}`,
    `Total Attacks,${kpis.totalAttacks}`,
    `Normal Traffic,${kpis.normalTraffic}`,
    `Attack Percentage,${kpis.attackPercentage}%`,
    `Unique Source IPs,${kpis.uniqueSourceIps}`,
    `Unique Destination IPs,${kpis.uniqueDestinationIps}`,
    `Avg Packet Size,${kpis.avgPacketSize}`,
    `Avg Flow Duration,${kpis.avgFlowDuration}`,
    "",
    "attack_type,count",
    ...breakdown.map((b) => `${b.name},${b.value}`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sentinel-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadExcel(kpis: KpiResponse, breakdown: { name: string; value: number }[]) {
  const kpiSheet = XLSX.utils.json_to_sheet([
    { metric: "Total Flows", value: kpis.totalFlows },
    { metric: "Total Attacks", value: kpis.totalAttacks },
    { metric: "Normal Traffic", value: kpis.normalTraffic },
    { metric: "Attack Percentage (%)", value: kpis.attackPercentage },
    { metric: "Unique Source IPs", value: kpis.uniqueSourceIps },
    { metric: "Unique Destination IPs", value: kpis.uniqueDestinationIps },
    { metric: "Avg Packet Size (bytes)", value: kpis.avgPacketSize },
    { metric: "Avg Flow Duration (ms)", value: kpis.avgFlowDuration },
  ]);
  const breakdownSheet = XLSX.utils.json_to_sheet(breakdown.map((b) => ({ attack_type: b.name, count: b.value })));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, kpiSheet, "KPIs");
  XLSX.utils.book_append_sheet(workbook, breakdownSheet, "Attack Breakdown");
  XLSX.writeFile(workbook, "sentinel-report.xlsx");
}

function downloadPdf(kpis: KpiResponse, breakdown: { name: string; value: number }[]) {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text("Sentinel — Threat Report", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString("en-US")}`, 14, 25);

  doc.setFontSize(11);
  doc.setTextColor(30);
  const summary = `Observed ${kpis.totalFlows.toLocaleString("en-US")} total flows, ${kpis.totalAttacks.toLocaleString(
    "en-US"
  )} (${kpis.attackPercentage}%) classified as attacks. ${kpis.uniqueSourceIps.toLocaleString(
    "en-US"
  )} unique source IPs observed.`;
  doc.text(doc.splitTextToSize(summary, 180), 14, 36);

  autoTable(doc, {
    startY: 52,
    head: [["Metric", "Value"]],
    body: [
      ["Total Flows", kpis.totalFlows.toLocaleString("en-US")],
      ["Total Attacks", kpis.totalAttacks.toLocaleString("en-US")],
      ["Normal Traffic", kpis.normalTraffic.toLocaleString("en-US")],
      ["Attack Percentage", `${kpis.attackPercentage}%`],
      ["Unique Source IPs", kpis.uniqueSourceIps.toLocaleString("en-US")],
      ["Unique Destination IPs", kpis.uniqueDestinationIps.toLocaleString("en-US")],
      ["Avg Packet Size", `${kpis.avgPacketSize} bytes`],
      ["Avg Flow Duration", `${kpis.avgFlowDuration} ms`],
    ],
    theme: "striped",
    headStyles: { fillColor: [139, 92, 246] },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 100;
  autoTable(doc, {
    startY: finalY + 12,
    head: [["Attack Type", "Count"]],
    body: breakdown.map((b) => [b.name, b.value.toLocaleString("en-US")]),
    theme: "striped",
    headStyles: { fillColor: [236, 72, 153] },
  });

  doc.save("sentinel-report.pdf");
}

export default function Reports() {
  const { data, loading, error } = useAsyncData(async () => {
    const [kpis, timelineRaw, breakdown] = await Promise.all([
      flowsApi.kpis(),
      flowsApi.timeline(),
      flowsApi.attackBreakdown(),
    ]);
    return { kpis, timeline: transformTimeline(timelineRaw), breakdown: breakdown.slice(0, 6) };
  }, [], "reports");

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Executive summary generated live from the current MongoDB dataset"
        actions={
          <>
            <GlowButton variant="ghost" disabled={!data} onClick={() => data && downloadExcel(data.kpis, data.breakdown)}>
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </GlowButton>
            <GlowButton variant="ghost" disabled={!data} onClick={() => data && downloadCsv(data.kpis, data.breakdown)}>
              <FileText className="w-4 h-4" /> CSV
            </GlowButton>
            <GlowButton disabled={!data} onClick={() => data && downloadPdf(data.kpis, data.breakdown)}>
              <FileDown className="w-4 h-4" /> Export PDF
            </GlowButton>
          </>
        }
      />

      {loading && <LoadingBlock label="Computing report from live data..." />}
      {error && <ErrorBlock message={error} />}

      {data && (
        <>
          <GlassCard hover={false} className="mb-5">
            <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">Executive Summary</p>
            <h2 className="text-lg font-display font-semibold text-white mb-3">Threat Report</h2>
            <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
              Across the monitored window, the platform observed {data.kpis.totalFlows.toLocaleString("en-US")} total
              network flows, of which {data.kpis.totalAttacks.toLocaleString("en-US")} (
              {data.kpis.attackPercentage}%) were classified as malicious activity.{" "}
              {data.breakdown[0] && (
                <>
                  The dominant attack category was{" "}
                  <span className="text-slate-200 font-medium">{data.breakdown[0].name}</span>
                  {data.breakdown[1] && (
                    <>
                      {" "}
                      ({data.breakdown[0].value.toLocaleString("en-US")} flows), followed by{" "}
                      <span className="text-slate-200 font-medium">{data.breakdown[1].name}</span> (
                      {data.breakdown[1].value.toLocaleString("en-US")} flows)
                    </>
                  )}
                  .
                </>
              )}{" "}
              Average packet size across observed traffic was {data.kpis.avgPacketSize} bytes, with an average flow
              duration of {data.kpis.avgFlowDuration} ms across {data.kpis.uniqueSourceIps.toLocaleString("en-US")}{" "}
              unique source addresses.
            </p>
          </GlassCard>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <GlassCard className="lg:col-span-2">
              <p className="text-sm font-semibold text-slate-200 mb-1">Traffic Timeline</p>
              {data.timeline.length > 0 ? (
                <AttackTrendChart data={data.timeline} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No timestamped data yet.</p>
              )}
            </GlassCard>
            <GlassCard delay={0.05}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Attack Categories</p>
              {data.breakdown.length > 0 ? (
                <AttackTypeDonut data={data.breakdown} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No attacks yet.</p>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
