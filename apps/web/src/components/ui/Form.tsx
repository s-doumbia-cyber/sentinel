import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/format";

const control =
  "w-full rounded-sm border bg-surface-2 px-3 text-body text-fg-1 placeholder:text-fg-3 transition-colors duration-fast " +
  "hover:border-strong focus-visible:border-accent disabled:opacity-50 aria-[invalid=true]:border-sev-critical/70";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-[88px] py-2", className)} {...rest} />;
});

/** Native select: keyboard and screen-reader behaviour come from the platform. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label + control + hint + error, wired with aria-describedby. */
export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-small font-medium text-fg-2">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-caption text-fg-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-caption text-sevfg-critical" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
