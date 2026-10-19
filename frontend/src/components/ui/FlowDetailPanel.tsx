import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { SeverityBadge } from "./SeverityBadge";
import type { NetworkFlow } from "@/types";

/** Slide-in panel showing every field MongoDB has for one flow, including
 * the original CSV row (`raw`) — the full ~80-column CICIDS2017 record, not
 * just the handful of normalized fields the table shows. */
export function FlowDetailPanel({ flow, onClose }: { flow: NetworkFlow | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {flow && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            className="fixed top-0 right-0 h-screen w-full sm:w-[420px] bg-base-900 border-l border-white/[0.1] z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <p className="font-display font-semibold text-white">Flow Detail</p>
              <button onClick={onClose} className="focus-ring text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <SeverityBadge severity={flow.severity} />
                  <span className="text-sm font-medium text-slate-200">{flow.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Field label="Source IP" value={`${flow.sourceIp}:${flow.sourcePort}`} mono />
                  <Field label="Destination IP" value={`${flow.destinationIp}:${flow.destinationPort}`} mono />
                  <Field label="Protocol" value={flow.protocol} />
                  <Field label="Timestamp" value={new Date(flow.timestamp).toLocaleString("en-US")} />
                  <Field label="Flow Duration" value={`${flow.flowDurationMs} ms`} />
                  <Field label="Packet Length" value={`${flow.packetLength} bytes`} />
                  <Field label="Prediction" value={flow.prediction} />
                  <Field label="Is Attack" value={flow.isAttack ? "Yes" : "No"} />
                </div>
              </div>

              {flow.raw && Object.keys(flow.raw).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                    Original CSV columns ({Object.keys(flow.raw).length})
                  </p>
                  <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {Object.entries(flow.raw).map(([key, value], i) => (
                          <tr key={key} className={i % 2 === 0 ? "bg-white/[0.02]" : ""}>
                            <td className="px-2.5 py-1.5 text-slate-500 font-mono whitespace-nowrap align-top">{key}</td>
                            <td className="px-2.5 py-1.5 text-slate-300 font-mono break-all">{String(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">{label}</p>
      <p className={`text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
