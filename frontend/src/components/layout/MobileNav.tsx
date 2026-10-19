import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, ShieldHalf, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_ITEMS } from "./navItems";

/** Hamburger trigger + slide-in drawer, visible only below the md breakpoint —
 * the desktop Sidebar is `hidden` there with no other way to navigate, so
 * this is what makes the app usable on a phone/tablet at all. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === "Admin");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="focus-ring md:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/[0.08] text-slate-300 hover:text-white shrink-0"
        aria-label="Open navigation menu"
      >
        <Menu className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="fixed top-0 left-0 h-screen w-72 bg-base-900 border-r border-white/[0.1] z-50 px-3 py-5 flex flex-col md:hidden"
            >
              <div className="flex items-center justify-between px-2 mb-8">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-grad-violet-pink flex items-center justify-center shadow-glow shrink-0">
                    <ShieldHalf className="w-5 h-5 text-white" />
                  </div>
                  <div className="leading-tight">
                    <p className="font-display font-bold text-white text-sm tracking-wide">SENTINEL</p>
                    <p className="text-[10px] text-slate-400 tracking-widest">SOC PLATFORM</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="focus-ring text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
                {visibleItems.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all focus-ring ${
                        isActive ? "text-white bg-white/[0.08] shadow-glow" : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
                      }`
                    }
                  >
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
