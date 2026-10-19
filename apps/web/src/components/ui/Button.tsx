import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent-solid text-accent-contrast hover:brightness-110 active:brightness-95 shadow-e1",
  secondary: "bg-surface-2 text-fg-1 border border hover:bg-surface-3 hover:border-strong",
  ghost: "text-fg-2 hover:text-fg-1 hover:bg-surface-3",
  danger: "bg-sev-critical/15 text-sevfg-critical border border-sev-critical/40 hover:bg-sev-critical/25",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-small gap-1.5",
  md: "h-9 px-4 text-body gap-2",
  lg: "h-11 px-5 text-body gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-fast ease-enter",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {/* The spinner overlays the label so the button keeps its width while loading. */}
      <span className={cn("inline-flex items-center gap-[inherit]", loading && "invisible")}>{children}</span>
      {loading && <Loader2 aria-hidden className="absolute h-4 w-4 animate-spin" />}
    </button>
  );
});
