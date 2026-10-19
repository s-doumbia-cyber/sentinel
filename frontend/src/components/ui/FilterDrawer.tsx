import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";

export function FilterDrawer({ children, badge }: { children: ReactNode; badge?: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="focus-ring relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-white/[0.18] hover:text-white transition-colors"
      >
        <SlidersHorizontal className="w-4 h-4" /> Filters
        {badge ? (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-grad-violet-pink text-[10px] font-bold text-white flex items-center justify-center">
            {badge}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="fixed top-0 right-0 h-screen w-[320px] bg-base-900 border-l border-white/[0.08] z-50 p-5 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <p className="font-display font-semibold text-white">Filters</p>
                <button onClick={() => setOpen(false)} className="focus-ring text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

export const selectClass =
  "w-full bg-white/[0.03] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 focus-ring focus:border-neon-violet/50";
