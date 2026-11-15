import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "brand" | "warning" | "danger" | "success";
}) {
  const toneClass = {
    default: "bg-muted text-foreground",
    brand: "bg-brand-soft text-brand",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  }[tone];
  const body = (
    <div className="group relative flex h-full flex-col gap-4 rounded-2xl border bg-card p-4 shadow-soft transition-all hover:border-foreground/15 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={cn("inline-flex size-9 items-center justify-center rounded-xl", toneClass)}>
          <Icon className="size-[1.1rem]" />
        </span>
        {href && <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight tabular">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground/80">{hint}</div>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
