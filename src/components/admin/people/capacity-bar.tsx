import { cn } from "@/lib/utils";

export function CapacityBar({ value, max, className, label }: { value: number; max: number; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  const tone = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand";
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        {label && <span className="text-muted-foreground">{label}</span>}
        <span className="ml-auto font-medium tabular">
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
