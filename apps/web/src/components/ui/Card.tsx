import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-lg border bg-surface-1 shadow-e1", className)} {...rest} />;
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
  as: Heading = "h2",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-subtle px-5 py-4", className)}>
      <div className="min-w-0">
        <Heading className="text-h3 font-semibold text-fg-1">{title}</Heading>
        {subtitle && <p className="mt-0.5 text-small text-fg-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...rest} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-h1 font-semibold tracking-[-0.01em] text-fg-1">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-body text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
