import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronsLeft, ShieldHalf } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_ITEMS } from "./navItems";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === "Admin");

  return (
    <motion.aside
      animate={{ width: collapsed ? 84 : 260 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="relative hidden md:flex flex-col shrink-0 h-screen sticky top-0 bg-base-900/60 backdrop-blur-xl border-r border-white/[0.06] px-3 py-5 z-20"
    >
      <div className="flex items-center gap-2 px-2 mb-8">
        <div className="w-9 h-9 rounded-xl bg-grad-violet-pink flex items-center justify-center shadow-glow shrink-0">
          <ShieldHalf className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <p className="font-display font-bold text-white text-sm tracking-wide">SENTINEL</p>
            <p className="text-[10px] text-slate-400 tracking-widest">SOC PLATFORM</p>
          </div>
        )}
      </div>

      <nav className="flex-1 flex flex-col gap-1">
        {visibleItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all focus-ring ${
                isActive
                  ? "text-white bg-white/[0.06] shadow-glow"
                  : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="active-nav-pill"
                    className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-grad-violet-pink"
                  />
                )}
                <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-neon-violetStrong" : ""}`} />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        className="focus-ring mt-4 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.03] text-xs transition-colors"
      >
        <ChevronsLeft className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        {!collapsed && "Collapse"}
      </button>
    </motion.aside>
  );
}
