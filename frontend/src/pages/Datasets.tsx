import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlowButton } from "@/components/ui/GlowButton";
import { LoadingBlock, ErrorBlock } from "@/components/ui/AsyncStates";
import { useAsyncData } from "@/hooks/useAsyncData";
import { datasetsApi } from "@/services/flows";
import { Database, Info, Loader2, UploadCloud } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  Processed: "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
  Processing: "text-neon-cyan bg-neon-cyan/10 border-neon-cyan/25",
  Failed: "text-neon-pink bg-neon-pink/10 border-neon-pink/25",
};

export default function Datasets() {
  const { data, loading, error, refetch } = useAsyncDataWithRefetch(() => datasetsApi.list(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setUploadError("");
    try {
      await datasetsApi.upload(file, "CICIDS2017", setProgress);
      await refetch();
    } catch (err: any) {
      setUploadError(err?.response?.data?.message || err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <PageHeader
        title="Datasets"
        subtitle="Every dataset imported into MongoDB, via the CLI script or upload below"
        actions={
          <>
            <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={handleFileSelected} />
            <GlowButton disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {uploading ? `Uploading ${progress}%...` : "Upload dataset"}
            </GlowButton>
          </>
        }
      />

      {uploadError && (
        <div className="mb-4">
          <ErrorBlock message={uploadError} />
        </div>
      )}

      {uploading && (
        <GlassCard hover={false} className="mb-5">
          <p className="text-xs text-slate-400 mb-2">
            Uploading and importing — large CICIDS2017 files (100–280MB) can take a few minutes. Don&apos;t close this tab.
          </p>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full bg-grad-violet-pink transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </GlassCard>
      )}

      {loading && <LoadingBlock label="Fetching dataset records..." />}
      {error && <ErrorBlock message={error} />}

      {data && data.length === 0 && (
        <GlassCard hover={false}>
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-neon-cyan shrink-0 mt-0.5" />
            <div className="text-sm text-slate-400 leading-relaxed">
              <p className="text-slate-200 font-medium mb-1">No dataset imported yet</p>
              Click <span className="text-slate-200">Upload dataset</span> above, or run from a terminal:
              <pre className="mt-2 bg-black/40 border border-white/[0.06] rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">
{`cd backend
npm run import -- "C:\\path\\to\\Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv"`}
              </pre>
            </div>
          </div>
        </GlassCard>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {data.map((d, i) => (
            <GlassCard key={d._id} delay={i * 0.05}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-grad-blue-violet flex items-center justify-center shrink-0">
                    <Database className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-sm font-medium text-slate-200 truncate">{d.name}</p>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border shrink-0 ${STATUS_STYLE[d.status]}`}>
                  {d.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-lg font-display font-bold text-white">{d.rows.toLocaleString("en-US")}</p>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Rows</p>
                </div>
                <div>
                  <p className="text-lg font-display font-bold text-white">{d.columns}</p>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Columns</p>
                </div>
                <div>
                  <p className="text-lg font-display font-bold text-white">{d.attackTypesFound.length}</p>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Attack Types</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Source: {d.sourceType} · Imported {new Date(d.createdAt).toLocaleDateString("en-US")}
              </p>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// Small local variant of useAsyncData that also exposes a manual refetch,
// used here so a successful upload can refresh the list without a full reload.
function useAsyncDataWithRefetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [tick, setTick] = useState(0);
  const state = useAsyncData(fetcher, [...deps, tick]);
  return { ...state, refetch: async () => setTick((t) => t + 1) };
}
