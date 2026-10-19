import { AlertTriangle, Loader2 } from "lucide-react";

export function LoadingBlock({ label = "Loading data..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <AlertTriangle className="w-6 h-6 text-neon-pink" />
      <p className="text-sm text-slate-300 font-medium">Couldn&apos;t load data from the API</p>
      <p className="text-xs text-slate-500 max-w-sm">{message}</p>
      <p className="text-xs text-slate-500 mt-1">
        Make sure the backend is running (<code className="text-slate-400">npm run dev</code> in{" "}
        <code className="text-slate-400">backend/</code>) and MongoDB has data (<code className="text-slate-400">npm run import</code>).
      </p>
    </div>
  );
}
