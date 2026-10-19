import type { Severity } from "@/types";

const STYLES: Record<Severity, string> = {
  critical: "bg-neon-pink/15 text-neon-pink border-neon-pink/30",
  high: "bg-rose-400/15 text-rose-300 border-rose-400/30",
  medium: "bg-neon-violetStrong/15 text-neon-violetStrong border-neon-violetStrong/30",
  low: "bg-neon-cyan/15 text-neon-cyan border-neon-cyan/30",
  info: "bg-neon-blue/15 text-blue-300 border-neon-blue/30",
  safe: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide border ${STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}
