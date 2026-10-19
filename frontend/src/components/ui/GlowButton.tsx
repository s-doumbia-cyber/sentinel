import type { ButtonHTMLAttributes, ReactNode } from "react";

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "ghost";
}

export function GlowButton({ children, variant = "primary", className = "", ...props }: GlowButtonProps) {
  const base =
    "focus-ring inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:brightness-100";
  const styles =
    variant === "primary"
      ? "bg-grad-violet-pink text-white hover:shadow-glow hover:brightness-110"
      : "bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-white/[0.18] hover:text-white";

  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}
