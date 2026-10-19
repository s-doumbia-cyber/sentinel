import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  hover?: boolean;
}

/** The single source of truth for the "glass panel" look used across every card in the app. */
export function GlassCard({ children, className = "", delay = 0, hover = true }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
      className={`glass-panel ${hover ? "glass-panel-hover" : ""} p-5 ${className}`}
    >
      {children}
    </motion.div>
  );
}
